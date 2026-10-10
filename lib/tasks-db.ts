import { getDb } from "./db";
import { logger } from "./logger";

export interface Task {
  id: number;
  title: string;
  description: string;
  project: string;
  priority: "low" | "medium" | "high";
  due_date: string | null; // ISO date (YYYY-MM-DD)
  calendar_event_id: string | null; // EventKit identifier
  completed: boolean;
  created_at: string;
  updated_at: string;
}

export interface CreateTaskInput {
  title: string;
  description?: string;
  project: string;
  priority: "low" | "medium" | "high";
  due_date?: string | null;
  calendar_event_id?: string | null;
}

/**
 * Initialize tasks table
 */
export function initTasksTable() {
  const db = getDb();
  db.exec(`
    CREATE TABLE IF NOT EXISTS tasks (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      title TEXT NOT NULL,
      description TEXT DEFAULT '',
      project TEXT NOT NULL,
      priority TEXT NOT NULL CHECK(priority IN ('low', 'medium', 'high')),
      due_date TEXT DEFAULT NULL,
      calendar_event_id TEXT DEFAULT NULL,
      completed INTEGER DEFAULT 0,
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now'))
    );
    
    CREATE INDEX IF NOT EXISTS idx_tasks_due_date ON tasks(due_date);
    CREATE INDEX IF NOT EXISTS idx_tasks_project ON tasks(project);
    CREATE INDEX IF NOT EXISTS idx_tasks_priority ON tasks(priority);
    CREATE INDEX IF NOT EXISTS idx_tasks_completed ON tasks(completed);
  `);
  logger.info(`tasks-db: ${ "Tasks table initialized" }`);
}

/**
 * Create a new task
 */
export function createTask(input: CreateTaskInput): Task {
  const db = getDb();
  const stmt = db.prepare(`
    INSERT INTO tasks (title, description, project, priority, due_date, calendar_event_id)
    VALUES (?, ?, ?, ?, ?, ?)
  `);
  
  const result = stmt.run(
    input.title.trim(),
    (input.description || "").trim(),
    input.project.trim(),
    input.priority,
    input.due_date || null,
    input.calendar_event_id || null
  );
  
  const task = getTaskById(Number(result.lastInsertRowid));
  if (!task) throw new Error("Failed to create task");
  
  logger.info(`tasks-db: ${ `Task created: ${task.id} - ${task.title}` }`);
  return task;
}

/**
 * Get task by ID
 */
export function getTaskById(id: number): Task | null {
  const db = getDb();
  const stmt = db.prepare(`
    SELECT id, title, description, project, priority, due_date, calendar_event_id, completed, created_at, updated_at
    FROM tasks WHERE id = ?
  `);
  const row = stmt.get(id) as any;
  return row ? normalizeTask(row) : null;
}

/**
 * Get all tasks or filter by date range / project
 */
export function getTasks(filters?: {
  project?: string;
  priority?: string;
  completed?: boolean;
  dueDateFrom?: string;
  dueDateTo?: string;
}): Task[] {
  const db = getDb();
  
  let query = `
    SELECT id, title, description, project, priority, due_date, calendar_event_id, completed, created_at, updated_at
    FROM tasks
    WHERE 1=1
  `;
  const params: any[] = [];
  
  if (filters?.project) {
    query += ` AND project = ?`;
    params.push(filters.project);
  }
  if (filters?.priority) {
    query += ` AND priority = ?`;
    params.push(filters.priority);
  }
  if (filters?.completed !== undefined) {
    query += ` AND completed = ?`;
    params.push(filters.completed ? 1 : 0);
  }
  if (filters?.dueDateFrom) {
    query += ` AND due_date >= ?`;
    params.push(filters.dueDateFrom);
  }
  if (filters?.dueDateTo) {
    query += ` AND due_date <= ?`;
    params.push(filters.dueDateTo);
  }
  
  query += ` ORDER BY due_date ASC, priority DESC`;
  
  const stmt = db.prepare(query);
  const rows = stmt.all(...params) as any[];
  return rows.map(normalizeTask);
}

/**
 * Update task
 */
export function updateTask(id: number, updates: Partial<CreateTaskInput>): Task {
  const db = getDb();
  
  const allowedFields = ["title", "description", "project", "priority", "due_date", "calendar_event_id"];
  const updateParts: string[] = [];
  const values: any[] = [];
  
  for (const [key, value] of Object.entries(updates)) {
    if (!allowedFields.includes(key)) continue;
    updateParts.push(`${key} = ?`);
    values.push(key === "description" || key === "project" ? String(value).trim() : value);
  }
  
  if (updateParts.length === 0) {
    const task = getTaskById(id);
    if (!task) throw new Error(`Task ${id} not found`);
    return task;
  }
  
  updateParts.push(`updated_at = datetime('now')`);
  const query = `UPDATE tasks SET ${updateParts.join(", ")} WHERE id = ?`;
  values.push(id);
  
  const stmt = db.prepare(query);
  stmt.run(...values);
  
  const task = getTaskById(id);
  if (!task) throw new Error(`Task ${id} not found after update`);
  
  logger.info(`tasks-db: ${ `Task updated: ${id}` }`);
  return task;
}

/**
 * Toggle task completion
 */
export function toggleTaskCompletion(id: number): Task {
  const db = getDb();
  const task = getTaskById(id);
  if (!task) throw new Error(`Task ${id} not found`);
  
  const stmt = db.prepare(`
    UPDATE tasks SET completed = ?, updated_at = datetime('now') WHERE id = ?
  `);
  stmt.run(task.completed ? 0 : 1, id);
  
  const updated = getTaskById(id);
  if (!updated) throw new Error(`Task ${id} not found after toggle`);
  
  logger.info(`tasks-db: ${ `Task toggled: ${id} (completed=${updated.completed})` }`);
  return updated;
}

/**
 * Delete task
 */
export function deleteTask(id: number): void {
  const db = getDb();
  const stmt = db.prepare(`DELETE FROM tasks WHERE id = ?`);
  stmt.run(id);
  logger.info(`tasks-db: ${ `Task deleted: ${id}` }`);
}

/**
 * Get tasks for today
 */
export function getTodayTasks(): Task[] {
  const today = new Date().toISOString().split("T")[0]; // YYYY-MM-DD
  return getTasks({
    dueDateFrom: today,
    dueDateTo: today,
    completed: false,
  });
}

/**
 * Get tasks for this week
 */
export function getWeekTasks(): Task[] {
  const today = new Date();
  const from = today.toISOString().split("T")[0];
  const to = new Date(today.getTime() + 7 * 24 * 60 * 60 * 1000).toISOString().split("T")[0];
  return getTasks({
    dueDateFrom: from,
    dueDateTo: to,
    completed: false,
  });
}

/**
 * Get distinct projects
 */
export function getProjects(): string[] {
  const db = getDb();
  const stmt = db.prepare(`SELECT DISTINCT project FROM tasks ORDER BY project ASC`);
  const rows = stmt.all() as any[];
  return rows.map((r) => r.project);
}

// Helpers
function normalizeTask(row: any): Task {
  return {
    id: row.id,
    title: row.title,
    description: row.description || "",
    project: row.project,
    priority: row.priority,
    due_date: row.due_date,
    calendar_event_id: row.calendar_event_id,
    completed: Boolean(row.completed),
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}
