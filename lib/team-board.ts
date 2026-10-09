/**
 * Team board — a shared notes channel for agents working in parallel on the
 * same Workspace session (board key `ws:<sessionId>`) or Manager task
 * (`task:<taskId>`).
 *
 * Agents post plans, claims ("I'm doing the API, you take the UI"), findings
 * and hand-offs with board_post and read them with board_read. Notes posted by
 * OTHER agents while a run is in progress are pushed into that run after its
 * next tool step (see runtime), so parallel agents actually see each other.
 * Stored in SQLite, so the board survives restarts and is visible in the UI.
 */
import { getDb } from "./db";
import { AiTool } from "./ai";
import { listFileLocks } from "./file-locks";

const MAX_NOTE = 2_000;
const MAX_NOTES_PER_BOARD = 500;
const READ_LIMIT = 50;
const PROMPT_LIMIT = 20;

export interface BoardNote {
  id: number;
  agent_id: number | null;
  agent_name: string;
  note: string;
  created_at: string;
}

export const boardToolDefs: AiTool[] = [
  {
    name: "board_post",
    description:
      "Post a short note on the TEAM BOARD shared with the other agents working on this session/task in parallel. " +
      "Use it to announce your plan or which files/parts you are taking, report findings others need, " +
      "and hand off results. Keep notes short and concrete.",
    input_schema: {
      type: "object",
      properties: { note: { type: "string", description: `the note (max ${MAX_NOTE} chars)` } },
      required: ["note"],
    },
  },
  {
    name: "board_read",
    description: "Read the latest team-board notes from all agents, plus the files currently locked by running agents.",
    input_schema: { type: "object", properties: {} },
  },
];

export const BOARD_PROMPT =
  "\n\n# Team board\n" +
  "Other agents may be working on this same session/task IN PARALLEL with you. Coordinate through the team board: " +
  "at the start, read it (board_read) and post what you are going to do (board_post) so work is not duplicated; " +
  "post important findings and when you finish a part. New notes from other agents are shown to you automatically " +
  "as [Team board] messages. Files another agent is editing are locked — if a write is refused because of a lock, " +
  "do not work around it; pick other work or coordinate on the board.";

function clean(v: unknown): string {
  return typeof v === "string" ? v.replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, "").trim().slice(0, MAX_NOTE) : "";
}

export function boardPost(boardKey: string, agentId: number | null, agentName: string, rawNote: unknown): BoardNote {
  const note = clean(rawNote);
  if (!note) throw new Error("'note' is required.");
  const d = getDb();
  const r = d
    .prepare("INSERT INTO board_notes(board_key, agent_id, agent_name, note) VALUES(?,?,?,?)")
    .run(boardKey, agentId, agentName, note);
  // Keep each board bounded.
  d.prepare(
    `DELETE FROM board_notes WHERE board_key=? AND id <= (
       SELECT id FROM board_notes WHERE board_key=? ORDER BY id DESC LIMIT 1 OFFSET ?)`
  ).run(boardKey, boardKey, MAX_NOTES_PER_BOARD);
  return d.prepare("SELECT id, agent_id, agent_name, note, created_at FROM board_notes WHERE id=?")
    .get(Number(r.lastInsertRowid)) as BoardNote;
}

/** Latest notes, oldest first. */
export function boardNotes(boardKey: string, limit = READ_LIMIT): BoardNote[] {
  const rows = getDb()
    .prepare("SELECT id, agent_id, agent_name, note, created_at FROM board_notes WHERE board_key=? ORDER BY id DESC LIMIT ?")
    .all(boardKey, limit) as BoardNote[];
  return rows.reverse();
}

/** Notes newer than `afterId` written by agents other than `agentId`. */
export function boardNotesSince(boardKey: string, afterId: number, agentId: number): BoardNote[] {
  return getDb()
    .prepare(`SELECT id, agent_id, agent_name, note, created_at FROM board_notes
      WHERE board_key=? AND id > ? AND (agent_id IS NULL OR agent_id != ?) ORDER BY id LIMIT ?`)
    .all(boardKey, afterId, agentId, READ_LIMIT) as BoardNote[];
}

export function boardLastId(boardKey: string): number {
  const row = getDb().prepare("SELECT MAX(id) AS m FROM board_notes WHERE board_key=?").get(boardKey) as { m: number | null };
  return row?.m ?? 0;
}

export function clearBoard(boardKey: string): void {
  getDb().prepare("DELETE FROM board_notes WHERE board_key=?").run(boardKey);
}

export function formatNotes(notes: BoardNote[]): string {
  return notes.map((n) => `- [${n.created_at.slice(11, 16)}] ${n.agent_name}: ${n.note}`).join("\n");
}

/** board_read result: notes + live file locks. */
export async function boardReadText(boardKey: string): Promise<string> {
  const notes = boardNotes(boardKey);
  const locks = await listFileLocks();
  const parts = [notes.length ? `Team board:\n${formatNotes(notes)}` : "Team board: (no notes yet)"];
  if (locks.length) parts.push(`Files locked by running agents:\n${locks.map((l) => `- ${l.path} — ${l.agentName}`).join("\n")}`);
  return parts.join("\n\n");
}

/** Dynamic system-prompt section: the board as it is when the run starts. */
export function boardPromptNotes(boardKey: string): string {
  const notes = boardNotes(boardKey, PROMPT_LIMIT);
  return notes.length ? `\n\n# Team board (latest notes)\n${formatNotes(notes)}` : "";
}
