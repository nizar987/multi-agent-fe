/**
 * Data access for the Agent Manager (supervisor).
 *
 * The manager keeps *live* state in SQLite (unlike synchronous delegation): a
 * task moves through statuses, spawns per-agent assignments, and every step is
 * appended to an audit trail (`task_events`) used for the final report and for
 * debugging. Logic never reads events back to decide flow — state lives on the
 * rows themselves.
 */
import { getDb } from "./db";

export type TaskStatus =
  | "clarifying"
  | "planning"
  | "in_progress"
  | "reviewing"
  | "revising"
  | "reporting"
  | "done"
  | "failed";

export type AssignmentStatus =
  | "pending"
  | "in_progress"
  | "submitted"
  | "needs_revision"
  | "approved"
  | "failed";

/** Event types written to `task_events`. */
export type TaskEventType =
  | "clarification_asked"
  | "clarification_answered"
  | "assigned"
  | "dispatched"
  | "submitted"
  | "completion_check_failed"
  | "review_passed"
  | "review_failed"
  | "revision_requested"
  | "assignment_approved"
  | "task_completed"
  | "task_failed";

export interface ManagerTask {
  id: number;
  title: string;
  original_request: string;
  agent_ids: string; // JSON array of agent ids the manager may assign to ([] = all)
  model: string | null; // forced model for manager + workers (null = each agent's default)
  status: TaskStatus;
  clarification_question: string | null;
  clarification_options: string | null; // JSON array of 2 suggested answers
  clarification_rounds: number;
  assumptions: string | null;
  report: string | null;
  created_at: string;
  updated_at: string;
}

export interface TaskAssignment {
  id: number;
  task_id: number;
  agent_id: number;
  agent_name: string;
  subtask_description: string;
  position: number;
  status: AssignmentStatus;
  attempt_count: number;
  revision_count: number;
  last_plan: string | null;
  last_result: string | null;
  last_review_notes: string | null;
  created_at: string;
  updated_at: string;
}

export interface TaskEvent {
  id: number;
  task_id: number;
  assignment_id: number | null;
  event_type: TaskEventType;
  content: string | null;
  created_at: string;
}

/* -------------------------------------------------------------------------- */
/* tasksRepo                                                                   */
/* -------------------------------------------------------------------------- */

export const tasksRepo = {
  create(title: string, originalRequest: string, agentIds: number[] = [], model: string | null = null): number {
    const r = getDb()
      .prepare(
        "INSERT INTO manager_tasks(title,original_request,agent_ids,model,status) VALUES(?,?,?,?,'planning')"
      )
      .run(title, originalRequest, JSON.stringify(agentIds), model);
    return Number(r.lastInsertRowid);
  },

  get(id: number): ManagerTask | null {
    return (
      (getDb().prepare("SELECT * FROM manager_tasks WHERE id=?").get(id) as ManagerTask) ?? null
    );
  },

  list(): ManagerTask[] {
    return getDb()
      .prepare("SELECT * FROM manager_tasks ORDER BY id DESC")
      .all() as ManagerTask[];
  },

  update(id: number, patch: Partial<Omit<ManagerTask, "id">>): void {
    const keys = Object.keys(patch);
    if (keys.length === 0) return;
    const set = keys.map((k) => `${k}=?`).join(", ");
    const values = keys.map((k) => (patch as Record<string, unknown>)[k]);
    getDb()
      .prepare(`UPDATE manager_tasks SET ${set}, updated_at=datetime('now') WHERE id=?`)
      .run(...values, id);
  },
};

/* -------------------------------------------------------------------------- */
/* assignmentsRepo                                                             */
/* -------------------------------------------------------------------------- */

export const assignmentsRepo = {
  create(input: {
    task_id: number;
    agent_id: number;
    agent_name: string;
    subtask_description: string;
    position: number;
  }): number {
    const r = getDb()
      .prepare(
        `INSERT INTO task_assignments(task_id,agent_id,agent_name,subtask_description,position,status)
         VALUES(?,?,?,?,?,'pending')`
      )
      .run(
        input.task_id,
        input.agent_id,
        input.agent_name,
        input.subtask_description,
        input.position
      );
    return Number(r.lastInsertRowid);
  },

  get(id: number): TaskAssignment | null {
    return (
      (getDb().prepare("SELECT * FROM task_assignments WHERE id=?").get(id) as TaskAssignment) ??
      null
    );
  },

  listByTask(taskId: number): TaskAssignment[] {
    return getDb()
      .prepare("SELECT * FROM task_assignments WHERE task_id=? ORDER BY position, id")
      .all(taskId) as TaskAssignment[];
  },

  update(id: number, patch: Partial<Omit<TaskAssignment, "id">>): void {
    const keys = Object.keys(patch);
    if (keys.length === 0) return;
    const set = keys.map((k) => `${k}=?`).join(", ");
    const values = keys.map((k) => (patch as Record<string, unknown>)[k]);
    getDb()
      .prepare(`UPDATE task_assignments SET ${set}, updated_at=datetime('now') WHERE id=?`)
      .run(...values, id);
  },
};

/* -------------------------------------------------------------------------- */
/* taskEventsRepo                                                              */
/* -------------------------------------------------------------------------- */

export const taskEventsRepo = {
  logEvent(
    taskId: number,
    eventType: TaskEventType,
    content?: string | null,
    assignmentId?: number | null
  ): void {
    getDb()
      .prepare(
        "INSERT INTO task_events(task_id,assignment_id,event_type,content) VALUES(?,?,?,?)"
      )
      .run(taskId, assignmentId ?? null, eventType, content ?? null);
  },

  listByTask(taskId: number): TaskEvent[] {
    return getDb()
      .prepare("SELECT * FROM task_events WHERE task_id=? ORDER BY id")
      .all(taskId) as TaskEvent[];
  },
};
