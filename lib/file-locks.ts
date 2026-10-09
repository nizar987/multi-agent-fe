/**
 * File locks between agents running in parallel.
 *
 * The first time a run writes a file (fs_write_file / fs_edit_file /
 * fs_move_file), it CLAIMS that path for the rest of the run. Another run that
 * tries to write the same path is refused with the holder's name, so two
 * agents never silently overwrite each other's work. Claims are leases
 * (renewed on every write) and are released when the run ends; a crashed run's
 * claims simply expire.
 *
 * The owner is the ROOT run: sub-agents reached through delegate_to_agent share
 * their parent's owner id, so a parent and its helpers can edit the same files.
 *
 * Backed by the cache store's "locks" space — in-memory, or Redis (atomic
 * claim via Lua) when Redis is selected, which also coordinates other processes.
 *
 * Limitation: files changed through run_shell cannot be detected and are not locked.
 */
import crypto from "crypto";
import path from "path";
import { withStore } from "./cache-store";
import { logger } from "./logger";

const LEASE_SEC = 10 * 60;
const KEY_PREFIX = "file:";

/** fs write tools → the input fields holding the paths they modify. */
const WRITE_PATH_FIELDS: Record<string, string[]> = {
  fs_write_file: ["path"],
  fs_edit_file: ["path"],
  fs_move_file: ["source", "destination"],
};

export interface LockOwner {
  /** Root-run id shared by delegated sub-agents. */
  id: string;
  /** Agent name shown to other agents when they are blocked. */
  agentName: string;
}

export interface FileLock {
  path: string;
  agentName: string;
}

/** Paths in this run claimed so far (per owner id), for release at the end. */
const claimedByOwner = new Map<string, Set<string>>();

export function newLockOwnerId(): string {
  return `run_${crypto.randomBytes(6).toString("hex")}`;
}

/** Absolute paths a write tool call will modify ([] = not a guarded write). */
export function writeTargets(tool: string, rawInput: unknown): string[] {
  const fields = WRITE_PATH_FIELDS[tool];
  if (!fields) return [];
  const input = (rawInput && typeof rawInput === "object" ? rawInput : {}) as Record<string, unknown>;
  return fields
    .map((f) => input[f])
    .filter((p): p is string => typeof p === "string" && path.isAbsolute(p))
    .map((p) => path.resolve(p));
}

function holderName(value: string): string {
  const tab = value.indexOf("\t");
  return tab >= 0 ? value.slice(tab + 1) : value;
}

/**
 * Claim every target of a write. Returns null when the write may proceed, or
 * a message for the model naming who holds the file.
 */
export async function claimForWrite(owner: LockOwner, tool: string, input: unknown): Promise<string | null> {
  const targets = writeTargets(tool, input);
  for (const p of targets) {
    let holder: string | null;
    try {
      holder = await withStore((s) => s.claim(KEY_PREFIX + p, owner.id, owner.agentName, LEASE_SEC), "locks");
    } catch (e) {
      // A lock-store failure must not block work — log and let the write through.
      logger.warn(`File lock unavailable for ${p}: ${e instanceof Error ? e.message : e}`);
      continue;
    }
    if (holder !== null) {
      const who = holderName(holder);
      logger.info(`File lock: "${owner.agentName}" blocked on ${p} (held by "${who}")`);
      return (
        `File is locked: ${p} is being edited by agent "${who}" in a parallel run. ` +
        "It was NOT modified. Do not overwrite another agent's work — work on other files, " +
        "coordinate on the team board (board_post) if available, or retry later."
      );
    }
    const set = claimedByOwner.get(owner.id) ?? new Set<string>();
    claimedByOwner.set(owner.id, set.add(p));
  }
  return null;
}

/** Release every claim of a finished run. */
export async function releaseFileLocks(ownerId: string): Promise<void> {
  const paths = claimedByOwner.get(ownerId);
  claimedByOwner.delete(ownerId);
  if (!paths) return;
  for (const p of paths) {
    await withStore((s) => s.release(KEY_PREFIX + p, ownerId), "locks").catch((e) =>
      logger.warn(`File lock release failed for ${p}: ${e instanceof Error ? e.message : e}`)
    );
  }
}

/** Files currently claimed by any run. */
export async function listFileLocks(): Promise<FileLock[]> {
  try {
    const rows = await withStore((s) => s.entries(KEY_PREFIX), "locks");
    return rows.map(([k, v]) => ({ path: k.slice(KEY_PREFIX.length), agentName: holderName(v) }));
  } catch {
    return [];
  }
}
