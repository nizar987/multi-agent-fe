/**
 * Validation shared by everything that creates or edits agents: the agents API
 * routes and the agents' own catalog tools (lib/tools-catalog.ts).
 */

/** Tool groups an agent may enable (see assembleTools in lib/agent-runtime.ts). */
export const KNOWN_AGENT_TOOLS = new Set([
  "github", "gitlab", "filesystem", "memory", "delegate", "shell",
  "database", "redis", "env", "monitoring", "tavily", "tavily_mcp",
  "vision", "video",
]);

export const MAX_AGENT_TEXT = 100_000; // system prompt can be long
export const MAX_AGENT_SHORT = 500;
export const DEFAULT_AGENT_COLOR = "#c15f3c";

export function clampStr(v: unknown, max = MAX_AGENT_SHORT): string {
  if (typeof v !== "string") return "";
  return v.replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, "").slice(0, max);
}

/** Only known tool names, max 20. */
export function sanitizeTools(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  return (raw as unknown[])
    .filter((t): t is string => typeof t === "string" && KNOWN_AGENT_TOOLS.has(t))
    .slice(0, 20);
}

/** Positive integer ids, max 50. */
export function sanitizeSkillIds(raw: unknown): number[] {
  if (!Array.isArray(raw)) return [];
  return (raw as unknown[])
    .map(Number)
    .filter((n) => Number.isInteger(n) && n > 0)
    .slice(0, 50);
}

export function sanitizeColor(v: unknown): string {
  return /^#[0-9a-fA-F]{6}$/.test(String(v ?? "")) ? String(v) : DEFAULT_AGENT_COLOR;
}
