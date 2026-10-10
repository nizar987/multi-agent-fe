/**
 * Run watchdog — the "heartbeat" that keeps unfinished work going.
 *
 * Every minute (and shortly after the app starts) it looks for:
 *   1. Agent runs that died before finishing — still `running` in the DB but
 *      not alive in this process (app closed / crashed / restarted).
 *   2. Runs that ended `failed` on a transient AI error (overload, 5xx…) or
 *      `incomplete` (checklist items left after the in-run nudges gave up).
 *   3. Manager tasks stuck in a working status that no process is driving.
 * …and resumes them: the agent gets its conversation back plus a note that it
 * was interrupted, and continues until the work is done. Each run is resumed
 * at most MAX_RESUMES times, so a task that keeps failing does not loop
 * forever. The user can turn this off in Settings (stored in app_meta).
 */
import { getDb, getMeta, setMeta } from "./db";
import { getTodos } from "./progress-db";
import { logger } from "./logger";
import type { AiMessage } from "./ai";
import {
  RunRow, startRun, markRun, hasActiveRun, isRunActive,
} from "./run-registry";

const META_KEY = "auto_resume";
const FIRST_TICK_MS = 15_000;
const TICK_MS = 60_000;
export const MAX_RESUMES = 3;
/** Wait after a failure before retrying, so a provider outage can clear. */
const RETRY_AFTER_SEC = 120;
/** Runs older than this are left alone. */
const MAX_AGE_HOURS = 24;
const MAX_CONCURRENT_RESUMES = 3;
const MANAGER_WORKING = ["planning", "in_progress", "reviewing", "revising", "reporting"];

let resuming = 0;
let ticking = false;

export function autoResumeEnabled(): boolean {
  try {
    return getMeta(META_KEY) !== "off";
  } catch {
    return false;
  }
}

export function setAutoResume(enabled: boolean): void {
  setMeta(META_KEY, enabled ? "on" : "off");
}

/** Start the periodic watchdog once per process. */
export function startWatchdog(): void {
  const g = globalThis as { __runWatchdog?: boolean };
  if (g.__runWatchdog) return;
  g.__runWatchdog = true;
  const first = setTimeout(() => void tick(), FIRST_TICK_MS);
  const every = setInterval(() => void tick(), TICK_MS);
  (first as { unref?: () => void }).unref?.();
  (every as { unref?: () => void }).unref?.();
  logger.info("Run watchdog started (auto-resume of interrupted work).");
}

export async function tick(): Promise<void> {
  if (ticking) return;
  ticking = true;
  try {
    markOrphans();
    if (!autoResumeEnabled()) return;
    resumeAgentRuns();
    await resumeManagerTasks();
  } catch (e) {
    logger.error(`Run watchdog tick failed: ${e instanceof Error ? e.message : e}`);
  } finally {
    ticking = false;
  }
}

/* ---------- agent runs ---------- */

/** `running` rows no live run in this process owns → `interrupted`. */
function markOrphans(): void {
  const rows = getDb().prepare("SELECT id FROM agent_runs WHERE status='running'").all() as { id: number }[];
  for (const r of rows) {
    if (!isRunActive(r.id)) {
      markRun(r.id, "interrupted", "the run stopped unexpectedly (app closed, restarted or crashed)");
      logger.warn(`Run watchdog: run #${r.id} was interrupted.`);
    }
  }
}

function resumeCandidates(): RunRow[] {
  return getDb()
    .prepare(`SELECT * FROM agent_runs
      WHERE status IN ('interrupted','failed','incomplete')
        AND resume_count < ?
        AND started_at > datetime('now', ?)
        AND (status = 'interrupted' OR ended_at <= datetime('now', ?))
      ORDER BY id`)
    .all(MAX_RESUMES, `-${MAX_AGE_HOURS} hours`, `-${RETRY_AFTER_SEC} seconds`) as RunRow[];
}

function loadHistory(conversationId: number): AiMessage[] {
  const rows = getDb()
    .prepare("SELECT role, content, meta FROM messages WHERE conversation_id=? AND role IN ('user','assistant') ORDER BY id")
    .all(conversationId) as { role: "user" | "assistant"; content: string; meta: string | null }[];
  return rows.map((m) => {
    if (m.meta) {
      try {
        const parsed = JSON.parse(m.meta);
        if (parsed?.contentBlocks) return { role: m.role, content: parsed.contentBlocks };
      } catch { /* plain text */ }
    }
    return { role: m.role, content: m.content };
  });
}

/** Is there still work to do in this conversation? */
function hasUnfinishedWork(run: RunRow, history: AiMessage[]): boolean {
  if (run.status === "failed" || run.status === "incomplete") return true;
  const open = getTodos(run.conversation_id).some((t) => t.status !== "done");
  const unanswered = history.length > 0 && history[history.length - 1].role === "user";
  return open || unanswered;
}

function resumeNote(run: RunRow): string {
  const why =
    run.status === "failed" ? `it failed with an AI error (${(run.error ?? "").slice(0, 200)})`
    : run.status === "incomplete" ? "it stopped while checklist items were still open"
    : "it was interrupted (the app closed, restarted or crashed)";
  return (
    `[system] Your previous run on this conversation did not finish — ${why}. ` +
    "Review the conversation and your progress checklist, then continue the remaining work until it is fully complete. " +
    "Do not redo steps that are already done. When everything is finished, give the final result."
  );
}

function resumeAgentRuns(): void {
  const db = getDb();
  for (const run of resumeCandidates()) {
    if (resuming >= MAX_CONCURRENT_RESUMES) return;
    if (hasActiveRun(run.conversation_id)) continue; // someone is already working on it

    const conv = db.prepare("SELECT id FROM conversations WHERE id=?").get(run.conversation_id);
    const agent = db.prepare("SELECT id FROM agents WHERE id=?").get(run.agent_id);
    if (!conv || !agent) {
      markRun(run.id, "error", "conversation or agent no longer exists");
      continue;
    }
    const history = loadHistory(run.conversation_id);
    if (!hasUnfinishedWork(run, history)) {
      markRun(run.id, "done");
      continue;
    }
    markRun(run.id, "resumed");
    void resumeRun(run, history);
  }
}

async function resumeRun(prev: RunRow, history: AiMessage[]): Promise<void> {
  resuming++;
  const attempt = prev.resume_count + 1;
  const run = startRun({
    agentId: prev.agent_id,
    conversationId: prev.conversation_id,
    surface: prev.surface,
    mode: prev.mode,
    workingDir: prev.working_dir ?? undefined,
    boardKey: prev.board_key ?? undefined,
    modelOverride: prev.model_override ?? undefined,
    resumeOf: prev.id,
    resumeCount: attempt,
  });
  logger.info(`Run watchdog: resuming run #${prev.id} (${prev.status}) as #${run.id} — attempt ${attempt}/${MAX_RESUMES}.`);
  const db = getDb();
  const save = (text: string) =>
    db.prepare("INSERT INTO messages(conversation_id,role,content) VALUES(?,?,?)").run(prev.conversation_id, "assistant", text);
  try {
    // Imported lazily: agent-runtime pulls in every tool module.
    const { runAgent } = await import("./agent-runtime");
    const finalText = await runAgent(
      prev.agent_id,
      [...history, { role: "user", content: resumeNote(prev) }],
      () => { /* no live client — the answer is saved to the conversation */ },
      0,
      prev.mode,
      {
        // Nobody is watching the chat: no ask_user / schedule tools that would block.
        interactive: false,
        conversationId: prev.conversation_id,
        usageSource: "resume",
        heartbeat: run.beat,
        ...(prev.working_dir ? { workingDir: prev.working_dir } : {}),
        ...(prev.board_key ? { boardKey: prev.board_key } : {}),
        ...(prev.model_override ? { modelOverride: prev.model_override } : {}),
      }
    );
    save(`↻ *Resumed automatically after the previous run stopped (attempt ${attempt}/${MAX_RESUMES}).*\n\n${finalText || "(no answer)"}`);
    const status = run.complete();
    logger.info(`Run watchdog: resumed run #${run.id} finished — ${status}.`);
  } catch (e) {
    const status = run.fail(e);
    save(`↻ Automatic resume failed (attempt ${attempt}/${MAX_RESUMES}): ${e instanceof Error ? e.message : String(e)}`);
    logger.error(`Run watchdog: resumed run #${run.id} failed — ${status}: ${e instanceof Error ? e.message : e}`);
  } finally {
    resuming--;
  }
}

/* ---------- manager tasks ---------- */

async function resumeManagerTasks(): Promise<void> {
  const db = getDb();
  const qs = MANAGER_WORKING.map(() => "?").join(",");
  const tasks = db
    .prepare(`SELECT id FROM manager_tasks WHERE status IN (${qs}) AND updated_at > datetime('now', ?)`)
    .all(...MANAGER_WORKING, `-${MAX_AGE_HOURS} hours`) as { id: number }[];
  if (tasks.length === 0) return;

  const { isManagerTaskRunning, runManager } = await import("./manager");
  const { taskEventsRepo } = await import("./manager-db");
  for (const t of tasks) {
    if (isManagerTaskRunning(t.id)) continue;
    const resumes = (db.prepare("SELECT COUNT(*) c FROM task_events WHERE task_id=? AND event_type='auto_resumed'")
      .get(t.id) as { c: number }).c;
    if (resumes >= MAX_RESUMES) continue;
    taskEventsRepo.logEvent(t.id, "auto_resumed", `attempt ${resumes + 1}/${MAX_RESUMES} — the task was interrupted`);
    logger.info(`Run watchdog: resuming manager task ${t.id} (attempt ${resumes + 1}/${MAX_RESUMES}).`);
    void runManager(t.id);
  }
}
