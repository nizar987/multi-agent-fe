/**
 * ask_user answer registry — mirrors the shell-approval registry: the agent
 * loop waits here for the user's answer, resolved by POST /api/ask/answer.
 */

export interface AskOption {
  label: string;
  description?: string;
  /** true = recommended, false = not recommended, undefined = neutral */
  recommended?: boolean;
}

type PendingAnswer = { resolve: (answer: string | null) => void; timer: ReturnType<typeof setTimeout> };

const pending: Map<string, PendingAnswer> =
  (globalThis as any).__askAnswers ?? new Map();
(globalThis as any).__askAnswers = pending;

/** Called by the runtime: waits for the user's answer for this tool_use_id. */
export function awaitAnswer(id: string, timeoutMs = 600_000): Promise<string | null> {
  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      pending.delete(id);
      resolve(null);
    }, timeoutMs);
    pending.set(id, { resolve, timer });
  });
}

/** Called by the answer endpoint: resolves the user's answer. */
export function resolveAnswer(id: string, answer: string): boolean {
  const p = pending.get(id);
  if (!p) return false;
  clearTimeout(p.timer);
  pending.delete(id);
  p.resolve(answer);
  return true;
}
