/**
 * Prompt caching — lets the provider reuse the unchanged prefix of a request
 * (tools → system → earlier messages) instead of re-processing it on every
 * call. An agent run makes many calls in a row (one per tool-loop iteration),
 * each repeating the same tools, system prompt and growing history, so this
 * is where most input tokens go.
 *
 * - anthropic : explicit `cache_control` breakpoints (built here). Cache reads
 *               cost ~10% of normal input; writes ~125%; TTL 5 min, refreshed
 *               on every hit.
 * - openai    : automatic prefix caching (no request change) — we only keep
 *               the prompt prefix stable (static system text first).
 * - gemini    : implicit caching on recent models — same as openai.
 *
 * Some Anthropic-compatible gateways reject `cache_control` or array-form
 * `system`. On such a rejection the caller disables caching for that base URL
 * (for the lifetime of the process) and retries without it.
 */
import { logger } from "./logger";
import type { AiMessage, AiTool } from "./ai";

const EPHEMERAL = { type: "ephemeral" } as const;
/** Block types that may carry a cache breakpoint. */
const CACHEABLE_BLOCKS = new Set(["text", "image", "document", "tool_use", "tool_result"]);

type CacheControl = typeof EPHEMERAL;
export type SystemBlock = { type: "text"; text: string; cache_control?: CacheControl };

const disabledBases = new Set<string>();

function baseKey(baseUrl: string): string {
  return baseUrl.trim().replace(/\/+$/, "").toLowerCase();
}

export function promptCacheEnabled(baseUrl: string): boolean {
  return !disabledBases.has(baseKey(baseUrl));
}

export function disablePromptCache(baseUrl: string, reason: string): void {
  disabledBases.add(baseKey(baseUrl));
  logger.warn(`Prompt caching disabled for ${baseUrl} — the endpoint rejected it: ${reason.slice(0, 200)}`);
}

/** Does this error response look like the endpoint rejecting cache_control / array-form system? */
export function isCacheRejection(status: number, detail: string): boolean {
  if (status !== 400 && status !== 422) return false;
  if (/cache_control|cache control|ephemeral/i.test(detail)) return true;
  return /\bsystem\b/i.test(detail) && /\b(type|string|array|list|str)\b/i.test(detail);
}

/** Static + dynamic system text joined — for providers without explicit breakpoints. */
export function joinSystem(stable?: string, dynamic?: string): string | undefined {
  const parts = [stable, dynamic].filter((s): s is string => !!s && s.length > 0);
  return parts.length ? parts.join("\n\n") : undefined;
}

/**
 * Anthropic `system`: the stable part carries a breakpoint (so tools + stable
 * system are cached together); the per-run dynamic part follows uncached.
 */
export function anthropicSystem(stable?: string, dynamic?: string): SystemBlock[] | undefined {
  const blocks: SystemBlock[] = [];
  if (stable) blocks.push({ type: "text", text: stable, cache_control: EPHEMERAL });
  if (dynamic) blocks.push({ type: "text", text: dynamic });
  return blocks.length ? blocks : undefined;
}

/** Copy of `tools` with a breakpoint on the last definition (caches the whole tool list). */
export function withToolCache(tools: AiTool[]): Array<AiTool & { cache_control?: CacheControl }> {
  if (tools.length === 0) return tools;
  return tools.map((t, i) => (i === tools.length - 1 ? { ...t, cache_control: EPHEMERAL } : t));
}

/**
 * Copy of `messages` with a breakpoint on the last cacheable block of the
 * final message. On the next tool-loop iteration the whole history up to here
 * is read from cache and only the new turn is processed. Never mutates input.
 */
export function withMessageCache(messages: AiMessage[]): AiMessage[] {
  if (messages.length === 0) return messages;
  const lastIdx = messages.length - 1;
  const last = messages[lastIdx];

  let content: unknown;
  if (typeof last.content === "string") {
    if (!last.content) return messages;
    content = [{ type: "text", text: last.content, cache_control: EPHEMERAL }];
  } else if (Array.isArray(last.content)) {
    const blocks = last.content as Array<Record<string, unknown>>;
    let target = -1;
    for (let i = blocks.length - 1; i >= 0; i--) {
      const b = blocks[i];
      const emptyText = b?.type === "text" && !b.text;
      if (b && CACHEABLE_BLOCKS.has(String(b.type)) && !emptyText) { target = i; break; }
    }
    if (target < 0) return messages;
    content = blocks.map((b, i) => (i === target ? { ...b, cache_control: EPHEMERAL } : b));
  } else {
    return messages;
  }

  return [...messages.slice(0, lastIdx), { ...last, content }];
}
