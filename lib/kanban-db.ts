/**
 * Data access layer for Kanban tickets.
 * Uses the same SQLite db as the rest of the app.
 * Table is created via migrate() which is called from db.ts on first getDb().
 */
import { getDb } from "./db";

export type TicketStatus = "todo" | "in_progress" | "done";

export interface KanbanTicket {
  id: number;
  title: string;
  description: string | null;
  status: TicketStatus;
  priority: "low" | "medium" | "high";
  assigned_agent_id: number | null;
  assigned_agent_name: string | null;
  manager_agent_id: number | null;
  manager_agent_name: string | null;
  created_at: string;
  updated_at: string;
}

/** Ensure the kanban_tickets table exists (idempotent). */
export function ensureKanbanTable() {
  getDb().exec(`
    CREATE TABLE IF NOT EXISTS kanban_tickets (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      title TEXT NOT NULL,
      description TEXT DEFAULT NULL,
      status TEXT NOT NULL DEFAULT 'todo'
        CHECK (status IN ('todo', 'in_progress', 'done')),
      priority TEXT NOT NULL DEFAULT 'medium'
        CHECK (priority IN ('low', 'medium', 'high')),
      assigned_agent_id INTEGER DEFAULT NULL,
      assigned_agent_name TEXT DEFAULT NULL,
      manager_agent_id INTEGER DEFAULT NULL,
      manager_agent_name TEXT DEFAULT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
  `);
}

export const kanbanRepo = {
  list(): KanbanTicket[] {
    ensureKanbanTable();
    return getDb()
      .prepare("SELECT * FROM kanban_tickets ORDER BY id DESC")
      .all() as KanbanTicket[];
  },

  get(id: number): KanbanTicket | null {
    ensureKanbanTable();
    return (
      (getDb()
        .prepare("SELECT * FROM kanban_tickets WHERE id=?")
        .get(id) as KanbanTicket) ?? null
    );
  },

  create(input: {
    title: string;
    description?: string | null;
    status?: TicketStatus;
    priority?: "low" | "medium" | "high";
    assigned_agent_id?: number | null;
    assigned_agent_name?: string | null;
    manager_agent_id?: number | null;
    manager_agent_name?: string | null;
  }): number {
    ensureKanbanTable();
    const r = getDb()
      .prepare(
        `INSERT INTO kanban_tickets
          (title, description, status, priority, assigned_agent_id, assigned_agent_name, manager_agent_id, manager_agent_name)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        input.title.trim(),
        input.description?.trim() ?? null,
        input.status ?? "todo",
        input.priority ?? "medium",
        input.assigned_agent_id ?? null,
        input.assigned_agent_name ?? null,
        input.manager_agent_id ?? null,
        input.manager_agent_name ?? null
      );
    return Number(r.lastInsertRowid);
  },

  update(
    id: number,
    patch: Partial<Omit<KanbanTicket, "id" | "created_at" | "updated_at">>
  ): void {
    ensureKanbanTable();
    const keys = Object.keys(patch);
    if (keys.length === 0) return;
    const set = keys.map((k) => `${k}=?`).join(", ");
    const values = keys.map((k) => (patch as Record<string, unknown>)[k]);
    getDb()
      .prepare(
        `UPDATE kanban_tickets SET ${set}, updated_at=datetime('now') WHERE id=?`
      )
      .run(...values, id);
  },

  delete(id: number): void {
    ensureKanbanTable();
    getDb().prepare("DELETE FROM kanban_tickets WHERE id=?").run(id);
  },

  /** Bulk-create tickets from CSV import. Returns count inserted. */
  bulkCreate(
    rows: Array<{
      title: string;
      description?: string;
      status?: string;
      priority?: string;
    }>
  ): number {
    ensureKanbanTable();
    const stmt = getDb().prepare(
      `INSERT INTO kanban_tickets (title, description, status, priority)
       VALUES (?, ?, ?, ?)`
    );
    const validStatuses = new Set(["todo", "in_progress", "done"]);
    const validPriorities = new Set(["low", "medium", "high"]);

    let count = 0;
    const tx = getDb().transaction(() => {
      for (const row of rows) {
        const title = (row.title ?? "").trim();
        if (!title) continue;
        const status = validStatuses.has(row.status ?? "") ? row.status! : "todo";
        const priority = validPriorities.has(row.priority ?? "")
          ? row.priority!
          : "medium";
        stmt.run(title, row.description?.trim() ?? null, status, priority);
        count++;
      }
    });
    tx();
    return count;
  },
};
