/**
 * Run registry — every chat / workspace agent run is recorded in `agent_runs`
 * with a heartbeat, so the watchdog (lib/run-watchdog.ts) can tell which runs
 * died before finishing their work and resume them.
 *
 * A run is "alive" only while it is in this process's in-memory `active` set:
 * a row still marked `running` that is not in the set belongs to a process
 * that exited or crashed (app closed, restart) — an orphan.
 *
 * Final statuses:
 *   done        — finished, nothing left on its checklist
 *   incomplete  — ended with unfinished checklist items (agent gave up)
 *   failed      — transient AI error (overload, rate limit, 5xx) → retryable
 *   error       — permanent error (bad key, unknown model…) → not retried
 *   interrupted — orphan detected by the watchdog
 *   resumed     — a newer run continued this one
 *   superseded  — the user sent a new message in the conversation meanwhile
 */
import { getDb } from "./db";
import { getTodos } from "./progress-db";
import { isTransientAiError } from "./run-guard";
import type { RunMode } from "./agent-runtime";

export type RunSurface = "chat" | "workspace";
export type RunStatus =
  | "running" | "done" | "incomplete" | "failed" | "error" | "interrupted" | "resumed" | "superseded";

export interface RunSpec {
  agentId: number;
  conversationId: number;
  surface: RunSurface;
  mode: RunMode;
  workingDir?: string;
  boardKey?: string;
  modelOverride?: string;
  resumeOf?: number;
  resumeCount?: number;
}

export interface RunRow {
  id: number;
  agent_id: number;
  conversation_id: number;
  surface: RunSurface;
  mode: RunMode;
  working_dir: string | null;
  board_key: string | null;
  model_override: string | null;
  status: RunStatus;
  resume_of: number | null;
  resume_count: number;
  error: string | null;
  started_at: string;
  last_beat_at: string;
  ended_at: string | null;
}

export interface RunHandle {
  id: number;
  /** Mark activity — written to last_beat_at by the heartbeat timer. */
  beat: () => void;
  /** Run finished normally: `done`, or `incomplete` when its checklist still has open items. */
  complete: () => RunStatus;
  /** Run threw: `failed` (transient, retryable) or `error`. */
  fail: (e: unknown) => RunStatus;
}

const HEARTBEAT_MS = 15_000;
const active = new Set<number>();

export function isRunActive(id: number): boolean {
  return active.has(id);
}

export function hasActiveRun(conversationId: number): boolean {
  if (active.size === 0) return false;
  const rows = getDb()
    .prepare("SELECT id FROM agent_runs WHERE conversation_id=? AND status='running'")
    .all(conversationId) as { id: number }[];
  return rows.some((r) => active.has(r.id));
}

export function startRun(spec: RunSpec): RunHandle {
  const d = getDb();
  // A new run in this conversation replaces any older unfinished one — the
  // watchdog must not resume a run the user has already moved past.
  if (!spec.resumeOf) {
    const stale = d.prepare(`SELECT id FROM agent_runs
      WHERE conversation_id=? AND status IN ('running','incomplete','failed','interrupted')`)
      .all(spec.conversationId) as { id: number }[];
    const supersede = d.prepare("UPDATE agent_runs SET status='superseded', ended_at=datetime('now') WHERE id=?");
    for (const r of stale) if (!active.has(r.id)) supersede.run(r.id); // never touch a live run
  }
  const id = Number(d.prepare(
    `INSERT INTO agent_runs(agent_id, conversation_id, surface, mode, working_dir, board_key, model_override, resume_of, resume_count)
     VALUES(?,?,?,?,?,?,?,?,?)`
  ).run(
    spec.agentId, spec.conversationId, spec.surface, spec.mode,
    spec.workingDir ?? null, spec.boardKey ?? null, spec.modelOverride ?? null,
    spec.resumeOf ?? null, spec.resumeCount ?? 0
  ).lastInsertRowid);
  active.add(id);

  let dirty = false;
  const timer = setInterval(() => {
    if (!dirty) return;
    dirty = false;
    try { getDb().prepare("UPDATE agent_runs SET last_beat_at=datetime('now') WHERE id=?").run(id); } catch { /* best-effort */ }
  }, HEARTBEAT_MS);
  (timer as { unref?: () => void }).unref?.();

  const end = (status: RunStatus, error: string | null): RunStatus => {
    clearInterval(timer);
    active.delete(id);
    getDb()
      .prepare("UPDATE agent_runs SET status=?, error=?, ended_at=datetime('now'), last_beat_at=datetime('now') WHERE id=? AND status='running'")
      .run(status, error, id);
    return status;
  };

  return {
    id,
    beat: () => { dirty = true; },
    complete: () => {
      const open = getTodos(spec.conversationId).filter((t) => t.status !== "done").length;
      return end(open > 0 ? "incomplete" : "done", open > 0 ? `${open} checklist item(s) left` : null);
    },
    fail: (e) => {
      const msg = (e instanceof Error ? e.message : String(e)).slice(0, 500);
      return end(isTransientAiError(e) ? "failed" : "error", msg);
    },
  };
}

export function markRun(id: number, status: RunStatus, error?: string): void {
  getDb()
    .prepare("UPDATE agent_runs SET status=?, error=COALESCE(?, error), ended_at=COALESCE(ended_at, datetime('now')) WHERE id=?")
    .run(status, error ?? null, id);
}

export function recentRuns(limit = 20): Array<RunRow & { agent_name: string | null }> {
  return getDb()
    .prepare(`SELECT r.*, a.name AS agent_name FROM agent_runs r LEFT JOIN agents a ON a.id = r.agent_id
      ORDER BY r.id DESC LIMIT ?`)
    .all(limit) as Array<RunRow & { agent_name: string | null }>;
}
