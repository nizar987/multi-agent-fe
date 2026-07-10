/**
 * Optional context cap. When enabled in Settings (config.context.limitEnabled),
 * the oldest messages are dropped so the estimated token count sent to the model
 * stays under config.context.maxTokens. The most recent turns — the ones that
 * matter — are always kept.
 *
 * Trimming only ever removes from the FRONT and always resumes at a "clean" user
 * message (a plain prompt, not a tool_result), so the trimmed history stays a
 * valid provider request: it starts with a user turn and never orphans a
 * tool_result from its tool_use.
 */
import type { AiMessage } from "./ai";
import { getConfig } from "./config";

/** Rough token estimate (~4 chars/token) for a chunk of message content. */
function estimateTokens(value: unknown): number {
  const text = typeof value === "string" ? value : JSON.stringify(value ?? "");
  return Math.ceil(text.length / 4);
}

function totalTokens(system: string, messages: AiMessage[]): number {
  let n = estimateTokens(system);
  for (const m of messages) n += estimateTokens(m.content);
  return n;
}

/** A message safe to start a request with: a user turn that isn't a tool_result. */
function isCleanUserStart(m: AiMessage): boolean {
  if (m.role !== "user") return false;
  if (typeof m.content === "string") return true;
  const blocks = Array.isArray(m.content) ? m.content : [];
  return !blocks.some((b: any) => b?.type === "tool_result");
}

export interface TrimResult {
  messages: AiMessage[];
  trimmed: number; // how many leading messages were dropped
}

/**
 * Trim `messages` to fit config.context.maxTokens when the limit is enabled.
 * Returns the original array (untouched) when the limit is off or already fits.
 */
export function applyContextLimit(system: string, messages: AiMessage[]): TrimResult {
  const cfg = getConfig().context;
  if (!cfg.limitEnabled || cfg.maxTokens <= 0) return { messages, trimmed: 0 };
  if (messages.length <= 2) return { messages, trimmed: 0 };

  let kept = messages;
  // Drop from the front until we fit, but never drop the final 2 turns.
  while (totalTokens(system, kept) > cfg.maxTokens && kept.length > 2) {
    kept = kept.slice(1);
    // Skip forward to the next clean user start so the sequence stays valid.
    while (kept.length > 2 && !isCleanUserStart(kept[0])) kept = kept.slice(1);
  }

  const trimmed = messages.length - kept.length;
  return { messages: kept, trimmed };
}
