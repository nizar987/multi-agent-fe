/**
 * Offline pause registry — when an AI call fails with a NETWORK error (no
 * internet, DNS, connection refused/reset), the run does not fail: it pauses
 * here and waits until the user presses Retry (or Cancel) on the global
 * notification card. Same pattern as the approval registry in lib/shell.ts.
 */

export type PauseAction = "retry" | "cancel";

export interface PausedRun {
  id: string;
  agentName: string;
  /** Human-readable cause (e.g. "fetch failed (ENOTFOUND api.anthropic.com)"). */
  reason: string;
  createdAt: number; // epoch ms
}

type Pending = { resolve: (action: PauseAction) => void; meta: PausedRun };
const paused: Map<string, Pending> =
  (globalThis as any).__netPauses ?? new Map();
(globalThis as any).__netPauses = paused;

let seq = 0;

/** Park a run until the user decides. No timeout — offline can last long. */
export function awaitNetworkRetry(agentName: string, reason: string): { id: string; decision: Promise<PauseAction> } {
  const id = `net_${Date.now()}_${++seq}`;
  const decision = new Promise<PauseAction>((resolve) => {
    paused.set(id, {
      resolve,
      meta: { id, agentName, reason: reason.slice(0, 300), createdAt: Date.now() },
    });
  });
  return { id, decision };
}

/** Called by POST /api/runs/retry — wakes the paused run up. */
export function resolveNetworkPause(id: string, action: PauseAction): boolean {
  const p = paused.get(id);
  if (!p) return false;
  paused.delete(id);
  p.resolve(action);
  return true;
}

/** All runs currently paused on a network error (oldest first). */
export function listPausedRuns(): PausedRun[] {
  return [...paused.values()].map((p) => p.meta).sort((a, b) => a.createdAt - b.createdAt);
}

/**
 * True when the error looks like a CONNECTIVITY problem (offline, DNS,
 * refused/reset/timeout) rather than an API error (4xx/5xx body, bad key…).
 * Walks the `cause` chain — undici wraps the real error in "fetch failed".
 */
export function isNetworkError(err: unknown): boolean {
  const CODES = new Set([
    "ENOTFOUND", "EAI_AGAIN", "ECONNREFUSED", "ECONNRESET", "ETIMEDOUT",
    "ENETUNREACH", "ENETDOWN", "EHOSTUNREACH", "EPIPE",
    "UND_ERR_CONNECT_TIMEOUT", "UND_ERR_SOCKET",
  ]);
  // Phrases that only occur when the request never completed. Deliberately
  // narrow: a bare word like "network" or "terminated" also shows up in ordinary
  // provider error messages, and a false positive here parks the run forever on
  // a Retry card instead of reporting the real error.
  const TRANSPORT =
    /\b(fetch failed|socket hang up|other side closed|connection (?:reset|refused|closed|timed out)|network is unreachable|dns lookup failed|getaddrinfo)\b/i;

  let e: any = err;
  for (let depth = 0; e && depth < 5; depth++) {
    // The server answered (any HTTP status) → an API error, not connectivity.
    if (typeof e.status === "number" || typeof e.statusCode === "number") return false;
    if (typeof e.code === "string" && CODES.has(e.code)) return true;
    const msg = String(e.message ?? "");
    if (/HTTP \d{3}/.test(msg)) return false;
    if (TRANSPORT.test(msg)) return true;
    e = e.cause;
  }
  return false;
}
