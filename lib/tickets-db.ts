/**
 * Tickets — lightweight work items created on the Tasks page. "Execute" bundles
 * the open tickets into ONE Agent Manager task (lib/manager.ts); the manager
 * plans, splits the work across agents and reports back. Each executed ticket
 * keeps a link to its manager task so its status follows the run.
 */
import { getDb } from "./db";

export type TicketPriority = "low" | "medium" | "high";
export type TicketStatus = "open" | "executing" | "done" | "failed";

export interface Ticket {
  id: number;
  title: string;
  description: string;
  priority: TicketPriority;
  status: TicketStatus;
  manager_task_id: number | null;
  created_at: string;
  /** Status of the linked manager task (joined in list()), null when none. */
  task_status: string | null;
}

const PRIORITIES: TicketPriority[] = ["low", "medium", "high"];

export function createTicket(title: string, description: string, priority: string): number {
  const p: TicketPriority = PRIORITIES.includes(priority as TicketPriority)
    ? (priority as TicketPriority)
    : "medium";
  const r = getDb()
    .prepare("INSERT INTO tickets(title,description,priority) VALUES(?,?,?)")
    .run(title.trim(), description.trim(), p);
  return Number(r.lastInsertRowid);
}

/**
 * All tickets, newest first, with the linked manager-task status. Executing
 * tickets whose manager task has finished are settled to done/failed first,
 * so the list always reflects reality without a background job.
 */
export function listTickets(): Ticket[] {
  const db = getDb();
  db.prepare(
    `UPDATE tickets SET status='done'
     WHERE status='executing' AND manager_task_id IN (SELECT id FROM manager_tasks WHERE status='done')`
  ).run();
  db.prepare(
    `UPDATE tickets SET status='failed'
     WHERE status='executing' AND (
       manager_task_id IN (SELECT id FROM manager_tasks WHERE status='failed')
       OR (manager_task_id IS NOT NULL AND manager_task_id NOT IN (SELECT id FROM manager_tasks))
     )`
  ).run();

  return db
    .prepare(
      `SELECT t.*, m.status AS task_status
       FROM tickets t LEFT JOIN manager_tasks m ON m.id = t.manager_task_id
       ORDER BY t.status='open' DESC, t.id DESC`
    )
    .all() as Ticket[];
}

export function updateTicket(
  id: number,
  patch: Partial<Pick<Ticket, "title" | "description" | "priority" | "status">>
): boolean {
  const cur = getDb().prepare("SELECT * FROM tickets WHERE id=?").get(id) as Ticket | undefined;
  if (!cur) return false;
  const title = typeof patch.title === "string" && patch.title.trim() ? patch.title.trim() : cur.title;
  const description = typeof patch.description === "string" ? patch.description.trim() : cur.description;
  const priority = PRIORITIES.includes(patch.priority as TicketPriority) ? patch.priority : cur.priority;
  const status = ["open", "executing", "done", "failed"].includes(patch.status as string)
    ? patch.status
    : cur.status;
  getDb()
    .prepare("UPDATE tickets SET title=?, description=?, priority=?, status=? WHERE id=?")
    .run(title, description, priority, status, id);
  return true;
}

export function deleteTicket(id: number): void {
  getDb().prepare("DELETE FROM tickets WHERE id=?").run(id);
}

/**
 * Minimal CSV parser (quotes, escaped quotes, commas & newlines in quoted
 * fields). Returns rows of string cells — no external dependency needed for
 * the three-column ticket template.
 */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let inQuotes = false;
  const src = text.replace(/^﻿/, ""); // strip BOM
  for (let i = 0; i < src.length; i++) {
    const ch = src[i];
    if (inQuotes) {
      if (ch === '"') {
        if (src[i + 1] === '"') { cell += '"'; i++; }
        else inQuotes = false;
      } else cell += ch;
    } else if (ch === '"') {
      inQuotes = true;
    } else if (ch === ",") {
      row.push(cell); cell = "";
    } else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && src[i + 1] === "\n") i++;
      row.push(cell); cell = "";
      rows.push(row); row = [];
    } else {
      cell += ch;
    }
  }
  if (cell.length > 0 || row.length > 0) { row.push(cell); rows.push(row); }
  // Drop fully-empty rows (trailing newlines etc.)
  return rows.filter((r) => r.some((c) => c.trim() !== ""));
}

/**
 * Import tickets from CSV text (columns: title, description, priority — a
 * header row is detected and skipped). Returns created count + skipped rows.
 */
export function importTicketsCsv(text: string): { created: number; skipped: number } {
  const rows = parseCsv(text);
  if (rows.length === 0) return { created: 0, skipped: 0 };
  const start = rows[0][0]?.trim().toLowerCase() === "title" ? 1 : 0;
  let created = 0;
  let skipped = 0;
  for (const r of rows.slice(start)) {
    const title = (r[0] ?? "").trim();
    if (!title) { skipped++; continue; }
    createTicket(title, (r[1] ?? "").trim(), (r[2] ?? "").trim().toLowerCase());
    created++;
  }
  return { created, skipped };
}

/** Fetch specific open tickets (or ALL open tickets when ids is empty). */
export function getOpenTickets(ids: number[]): Ticket[] {
  const db = getDb();
  if (ids.length === 0) {
    return db
      .prepare("SELECT *, NULL AS task_status FROM tickets WHERE status='open' ORDER BY priority='high' DESC, priority='medium' DESC, id")
      .all() as Ticket[];
  }
  const marks = ids.map(() => "?").join(",");
  return db
    .prepare(`SELECT *, NULL AS task_status FROM tickets WHERE status='open' AND id IN (${marks}) ORDER BY priority='high' DESC, priority='medium' DESC, id`)
    .all(...ids) as Ticket[];
}

/** Mark tickets as executing and link them to the manager task. */
export function linkTicketsToTask(ids: number[], taskId: number): void {
  if (ids.length === 0) return;
  const marks = ids.map(() => "?").join(",");
  getDb()
    .prepare(`UPDATE tickets SET status='executing', manager_task_id=? WHERE id IN (${marks})`)
    .run(taskId, ...ids);
}
