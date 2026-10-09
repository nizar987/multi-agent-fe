/**
 * Run progress + work journal — the agent's "don't forget" layer.
 *
 * - run_todos: an AI-maintained checklist per conversation. The agent updates
 *   it with the progress_update tool; the full list is injected into the
 *   system prompt at the start of every run, so after a disconnect the agent
 *   sees exactly what is done and what is still open. The UI shows the same
 *   list in the right-hand Progress panel.
 * - work_journal: every user assignment is auto-recorded (request + working
 *   folder) per agent; the most recent entries are injected into the system
 *   prompt so the agent remembers what it worked on and in which folder.
 */
import { getDb } from "./db";

export type TodoStatus = "pending" | "in_progress" | "done";

export interface RunTodo {
  id: number;
  conversation_id: number;
  content: string;
  status: TodoStatus;
  position: number;
  updated_at: string;
}

export interface TodoInput {
  content: string;
  status: TodoStatus;
}

const VALID_STATUS: TodoStatus[] = ["pending", "in_progress", "done"];

/** Replace the whole checklist of a conversation (the tool sends the full list). */
export function setTodos(conversationId: number, items: TodoInput[]): RunTodo[] {
  const db = getDb();
  const clean = items
    .map((t) => ({
      content: String(t?.content ?? "").trim().slice(0, 500),
      status: VALID_STATUS.includes(t?.status) ? t.status : "pending",
    }))
    .filter((t) => t.content)
    .slice(0, 50);
  const tx = db.transaction(() => {
    db.prepare("DELETE FROM run_todos WHERE conversation_id=?").run(conversationId);
    const ins = db.prepare(
      "INSERT INTO run_todos(conversation_id,content,status,position) VALUES(?,?,?,?)"
    );
    clean.forEach((t, i) => ins.run(conversationId, t.content, t.status, i));
  });
  tx();
  return getTodos(conversationId);
}

export function getTodos(conversationId: number): RunTodo[] {
  return getDb()
    .prepare("SELECT * FROM run_todos WHERE conversation_id=? ORDER BY position, id")
    .all(conversationId) as RunTodo[];
}

/** Todos for every agent of a workspace session, keyed by agent id. */
export function getSessionTodos(sessionId: number): Record<number, RunTodo[]> {
  const rows = getDb()
    .prepare(
      `SELECT t.*, wsa.agent_id AS agent_id
       FROM workspace_session_agents wsa
       JOIN run_todos t ON t.conversation_id = wsa.conversation_id
       WHERE wsa.session_id=?
       ORDER BY t.position, t.id`
    )
    .all(sessionId) as Array<RunTodo & { agent_id: number }>;
  const out: Record<number, RunTodo[]> = {};
  for (const r of rows) (out[r.agent_id] ??= []).push(r);
  return out;
}

/** Render the checklist for the system prompt (empty string when none). */
export function todosPrompt(conversationId: number): string {
  const todos = getTodos(conversationId);
  if (todos.length === 0) return "";
  const mark = (s: TodoStatus) => (s === "done" ? "[x]" : s === "in_progress" ? "[~]" : "[ ]");
  return todos.map((t, i) => `${i + 1}. ${mark(t.status)} ${t.content}`).join("\n");
}

/* ---------------- work journal ---------------- */

export interface JournalEntry {
  id: number;
  agent_id: number;
  conversation_id: number | null;
  request: string;
  working_dir: string;
  at: string;
}

const JOURNAL_KEEP = 30; // per agent

/** Record an assignment; consecutive duplicates are collapsed. */
export function logAssignment(
  agentId: number,
  request: string,
  workingDir: string,
  conversationId?: number
): void {
  const db = getDb();
  const req = request.trim().slice(0, 400);
  if (!req) return;
  const last = db
    .prepare("SELECT request, working_dir FROM work_journal WHERE agent_id=? ORDER BY id DESC LIMIT 1")
    .get(agentId) as { request: string; working_dir: string } | undefined;
  if (last && last.request === req && last.working_dir === workingDir) return;
  db.prepare(
    "INSERT INTO work_journal(agent_id,conversation_id,request,working_dir) VALUES(?,?,?,?)"
  ).run(agentId, conversationId ?? null, req, workingDir);
  db.prepare(
    `DELETE FROM work_journal WHERE agent_id=? AND id NOT IN
     (SELECT id FROM work_journal WHERE agent_id=? ORDER BY id DESC LIMIT ?)`
  ).run(agentId, agentId, JOURNAL_KEEP);
}

/** Recent assignments for the system prompt (empty string when none). */
export function journalPrompt(agentId: number, limit = 5): string {
  const rows = getDb()
    .prepare("SELECT request, working_dir, at FROM work_journal WHERE agent_id=? ORDER BY id DESC LIMIT ?")
    .all(agentId, limit) as Array<{ request: string; working_dir: string; at: string }>;
  if (rows.length === 0) return "";
  return rows
    .map((r) => `- [${r.at.slice(0, 16)}] ${r.request}${r.working_dir ? ` (folder: ${r.working_dir})` : ""}`)
    .join("\n");
}
