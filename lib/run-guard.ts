/**
 * In-run persistence rules: decide when an agent that stopped should be told
 * to keep going, and which AI errors are worth retrying instead of ending the
 * run. Used by the agent runtime loop; the cross-run watchdog (resuming runs
 * that died) lives in lib/run-watchdog.ts.
 */

/** Nudges in a row without the agent doing anything (no tool call) before we give up. */
export const MAX_IDLE_NUDGES = 3;
/** Hard cap on nudges per run so a confused model cannot loop forever. */
export const MAX_TOTAL_NUDGES = 12;
/** Waits before re-sending an AI call that failed with a transient error. */
export const TRANSIENT_RETRY_DELAYS_MS = [5_000, 15_000, 45_000, 90_000];

/**
 * The reply announces work it did not do ("Next I'll create the files…",
 * "Sekarang saya akan…") — the classic "stopped mid-task" ending.
 * Only the last few lines are checked, so a summary that mentions plans earlier
 * on does not trigger it.
 */
export function looksUnfinished(text: string): boolean {
  const tail = text.trim().split("\n").slice(-3).join(" ").toLowerCase();
  if (!tail) return false;
  // A question to the user is a legitimate stop.
  if (/\?\s*$/.test(tail)) return false;
  // Polite closings and offers ("let me know…", "if you want, I'll…") are not unfinished work.
  if (/let me know|if you (want|like|need|prefer)|would you like|kalau (mau|perlu|ingin)|jika (mau|perlu|ingin)|apakah (mau|ingin|perlu)|kabari/.test(tail)) {
    return false;
  }
  const promise =
    /\b(i('| a)?ll|i will|i am going to|i'm going to|let me|next,? i|now i('| wi)ll|proceeding to|continuing with)\b/;
  const promiseId =
    /\b(saya akan|aku akan|selanjutnya saya|sekarang saya|berikutnya saya|mari (saya|kita)|saya lanjut(kan)?|lanjut ke)\b/;
  const trailing = /(:|…|\.\.\.)\s*$/;
  return promise.test(tail) || promiseId.test(tail) || trailing.test(tail);
}

/**
 * AI errors that usually go away on their own: rate limits, overload, 5xx,
 * stalled streams, timeouts. Config errors (bad key, unknown model, payment)
 * are NOT transient — retrying them only burns time.
 */
export function isTransientAiError(e: unknown): boolean {
  const msg = e instanceof Error ? e.message : String(e);
  return (
    /rate limit|overloaded|stream stalled|timed? ?out|timeout|socket hang up|ECONNRESET|terminated/i.test(msg) ||
    /Request failed \((5\d\d|408|409|425|429)\)/.test(msg)
  );
}

export function nudgeMessage(reason: "checklist" | "unfinished" | "empty", detail = ""): string {
  if (reason === "checklist") {
    return (
      `[system] Your progress checklist still has unfinished item(s):\n${detail}\n` +
      "The task is NOT complete. Continue working on these items NOW using your tools. " +
      "If an item is actually finished or no longer applies, update it via progress_update. " +
      "Only give your final answer when every item is done, or after asking the user via ask_user when you are truly blocked."
    );
  }
  if (reason === "unfinished") {
    return (
      "[system] Your last reply announced more work but you stopped without doing it. " +
      "Continue NOW with your tools and finish the task. If it is actually complete, reply with the final result only. " +
      "If you are blocked on a decision, ask the user (ask_user) instead of stopping."
    );
  }
  return "[system] Your last reply was empty. Continue the task where you left off, or give the final answer if it is done.";
}
