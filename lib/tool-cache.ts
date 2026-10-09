/**
 * Shared tool-result cache + per-run de-duplication.
 *
 * 1. Shared cache (all agents, all runs): results of READ-ONLY tools — web
 *    search/extract, GitHub/GitLab reads, filesystem reads — are stored in the
 *    cache store (memory or Redis, see lib/cache-store.ts). When another agent
 *    (or a later run) makes the same call, the result is served from the cache
 *    instead of hitting the API/disk again. Identical calls made at the same
 *    moment by parallel agents are executed once (single-flight).
 *    Filesystem keys include each file's mtime+size, so an edited file is never
 *    served stale; tools that write invalidate their namespace.
 *
 * 2. Per-run de-dup (saves tokens): when an agent repeats a call and gets the
 *    exact same result that is still in its context, the model receives a short
 *    note pointing at the earlier result instead of the full content again.
 */
import crypto from "crypto";
import fs from "fs";
import path from "path";
import { withStore, MAX_VALUE_BYTES } from "./cache-store";
import { logger } from "./logger";

type Policy = {
  /** Namespace — writes invalidate a whole namespace. */
  ns: "web" | "github" | "gitlab" | "fs";
  ttlSec: number;
  /** For fs reads: absolute paths whose mtime+size go into the key. */
  paths?: string[];
};

/** Results shorter than this are not worth replacing with a de-dup note. */
const DEDUP_MIN_CHARS = 600;

const FS_READS = new Set([
  "fs_read_file", "fs_read_text_file", "fs_read_multiple_files", "fs_get_file_info",
  "fs_list_directory", "fs_list_directory_with_sizes",
]);
/** Recursive listings: the root's mtime does not reflect deep changes → short TTL. */
const FS_DEEP_READS = new Set(["fs_directory_tree", "fs_search_files"]);
const FS_WRITES = new Set(["fs_write_file", "fs_edit_file", "fs_create_directory", "fs_move_file"]);
/** Tools outside the fs namespace that can change files on disk. */
const isDiskWriter = (tool: string) => tool === "run_shell" || (tool.startsWith("video_") && tool !== "video_probe");

const WEB_TTL = 15 * 60;
const REPO_TTL = 5 * 60;
const FS_TTL = 10 * 60;
const FS_DEEP_TTL = 30;

function inputPaths(input: Record<string, unknown>): string[] | null {
  const raw: unknown[] = Array.isArray(input.paths) ? input.paths : input.path !== undefined ? [input.path] : [];
  if (raw.length === 0) return null;
  const out: string[] = [];
  for (const p of raw) {
    // Relative paths resolve against the MCP server's cwd, not ours — skip them.
    if (typeof p !== "string" || !path.isAbsolute(p)) return null;
    out.push(p);
  }
  return out;
}

/** Which cache rule applies to this tool call (null = never cached). */
export function cachePolicy(tool: string, rawInput: unknown): Policy | null {
  const input = (rawInput && typeof rawInput === "object" ? rawInput : {}) as Record<string, unknown>;

  if (/^tavily_(search|extract|crawl|map)$/.test(tool)) return { ns: "web", ttlSec: WEB_TTL };
  if (/^tvmcp_.*(search|extract|crawl|map)/.test(tool)) return { ns: "web", ttlSec: WEB_TTL };
  if (tool === "github_list_issues") return { ns: "github", ttlSec: 2 * 60 };
  if (/^github_(get|search|list)_/.test(tool)) return { ns: "github", ttlSec: REPO_TTL };
  if (/^gitlab_(get|search|list)_/.test(tool)) return { ns: "gitlab", ttlSec: REPO_TTL };
  if (tool === "fs_list_allowed_directories") return { ns: "fs", ttlSec: FS_TTL };
  if (FS_READS.has(tool) || FS_DEEP_READS.has(tool)) {
    const paths = inputPaths(input);
    if (!paths) return null;
    return { ns: "fs", ttlSec: FS_DEEP_READS.has(tool) ? FS_DEEP_TTL : FS_TTL, paths };
  }
  return null;
}

/** Namespaces a (successful) call of `tool` makes stale. */
function invalidatedBy(tool: string): Policy["ns"][] {
  if (FS_WRITES.has(tool) || isDiskWriter(tool)) return ["fs"];
  if (tool.startsWith("github_") && !cachePolicy(tool, {})) return ["github"];
  if (tool.startsWith("gitlab_") && !/^gitlab_(get|search|list)_/.test(tool)) return ["gitlab"];
  return [];
}

/* ---------- keys ---------- */

function stableStringify(v: unknown): string {
  if (Array.isArray(v)) return `[${v.map(stableStringify).join(",")}]`;
  if (v && typeof v === "object") {
    const o = v as Record<string, unknown>;
    return `{${Object.keys(o).sort().map((k) => `${JSON.stringify(k)}:${stableStringify(o[k])}`).join(",")}}`;
  }
  return JSON.stringify(v) ?? "null";
}

function sha1(s: string): string {
  return crypto.createHash("sha1").update(s).digest("hex");
}

/** mtime+size of every path, or null when one is missing (then: don't cache). */
function fingerprint(paths: string[]): string | null {
  try {
    return paths.map((p) => { const st = fs.statSync(p); return `${st.mtimeMs}:${st.size}`; }).join("|");
  } catch {
    return null;
  }
}

export function cacheKey(tool: string, input: unknown, policy: Policy): string | null {
  let fp = "";
  if (policy.paths) {
    const f = fingerprint(policy.paths);
    if (f === null) return null;
    fp = `:${sha1(f)}`;
  }
  return `${policy.ns}:${tool}:${sha1(stableStringify(input ?? {}))}${fp}`;
}

/* ---------- stats ---------- */

const stats = { hits: 0, misses: 0, shared: 0, dedupChars: 0 };

export function toolCacheStats() {
  return { ...stats, dedupTokensSaved: Math.round(stats.dedupChars / 4) };
}

/* ---------- shared cache ---------- */

const inflight = new Map<string, Promise<string>>();

export interface CachedResult {
  result: string;
  /** Cache key (null when the call is not cacheable). */
  key: string | null;
  /** Where the result came from. */
  source: "live" | "cache" | "shared";
}

function cacheable(result: string): boolean {
  return result.length > 0 && result.length <= MAX_VALUE_BYTES && !/^\s*(error|failed)\b/i.test(result);
}

/**
 * Run `exec` through the shared cache when the tool is cacheable; otherwise
 * just run it. Errors propagate unchanged and are never cached.
 */
export async function withToolCache(tool: string, input: unknown, exec: () => Promise<string>): Promise<CachedResult> {
  const policy = cachePolicy(tool, input);
  const key = policy ? cacheKey(tool, input, policy) : null;
  if (!policy || !key) return { result: await exec(), key: null, source: "live" };

  try {
    const hit = await withStore((s) => s.get(key));
    if (hit !== null) {
      stats.hits++;
      return { result: hit, key, source: "cache" };
    }
  } catch (e) {
    logger.warn(`Tool cache read failed (${tool}): ${e instanceof Error ? e.message : e}`);
  }

  // Single-flight: parallel agents asking the same thing share one execution.
  const running = inflight.get(key);
  if (running) {
    stats.shared++;
    return { result: await running, key, source: "shared" };
  }

  stats.misses++;
  const p = exec();
  inflight.set(key, p);
  try {
    const result = await p;
    if (cacheable(result)) {
      await withStore((s) => s.set(key, result, policy.ttlSec)).catch((e) =>
        logger.warn(`Tool cache write failed (${tool}): ${e instanceof Error ? e.message : e}`)
      );
    }
    return { result, key, source: "live" };
  } finally {
    inflight.delete(key);
  }
}

/** Drop cached results a successful call of `tool` may have made stale. */
export async function invalidateAfter(tool: string): Promise<void> {
  for (const ns of invalidatedBy(tool)) {
    await withStore((s) => s.delPrefix(`${ns}:`)).catch((e) =>
      logger.warn(`Tool cache invalidation failed (${ns}): ${e instanceof Error ? e.message : e}`)
    );
  }
}

export async function clearToolCache(): Promise<number> {
  return withStore((s) => s.delPrefix(""));
}

/* ---------- per-run de-dup ---------- */

/**
 * Remembers, for one agent run, which tool_use already delivered which result.
 * `isInContext(toolUseId)` must say whether that earlier result is still part
 * of what the model is being sent (it may have been trimmed by the context limit).
 */
export class RunToolMemo {
  private seen = new Map<string, { toolUseId: string; hash: string }>();

  constructor(private readonly isInContext: (toolUseId: string) => boolean) {}

  /** Returns the text to send to the model for this result. */
  dedupe(tool: string, key: string | null, toolUseId: string, result: string): string {
    if (!key || result.length < DEDUP_MIN_CHARS) return result;
    const hash = sha1(result);
    const prev = this.seen.get(key);
    if (prev && prev.hash === hash && this.isInContext(prev.toolUseId)) {
      stats.dedupChars += result.length;
      return (
        `[Unchanged: identical to the result of your earlier ${tool} call (tool_use_id ${prev.toolUseId}) ` +
        "earlier in this conversation — the content was omitted to save tokens. Use that earlier result.]"
      );
    }
    this.seen.set(key, { toolUseId, hash });
    return result;
  }
}
