"use client";
/**
 * Progress panel — the AI-maintained checklist, shown on the right of chat &
 * workspace. The agent updates it via the progress_update tool; after a
 * disconnect both the user AND the agent can see what is done and what's left.
 */

export interface Todo {
  id: number;
  content: string;
  status: "pending" | "in_progress" | "done";
}

const ICON: Record<Todo["status"], string> = {
  done: "✓",
  in_progress: "◐",
  pending: "○",
};

export function TodoList({ todos }: { todos: Todo[] }) {
  const done = todos.filter((t) => t.status === "done").length;
  return (
    <div className="progress-list">
      <div className="progress-meter" title={`${done}/${todos.length} done`}>
        <div className="progress-meter-fill" style={{ width: todos.length ? `${(done / todos.length) * 100}%` : 0 }} />
      </div>
      {todos.map((t) => (
        <div key={t.id} className={`progress-item progress-item--${t.status}`}>
          <span className="progress-item-icon">{ICON[t.status]}</span>
          <span>{t.content}</span>
        </div>
      ))}
    </div>
  );
}

interface ProgressPanelProps {
  /** Single conversation (chat page). */
  todos?: Todo[];
  /** Per-agent lists (workspace): [agentName, todos][] — empty lists are skipped. */
  byAgent?: Array<[string, Todo[]]>;
  /** Extra section rendered under the checklists (workspace: team board). */
  extra?: React.ReactNode;
  onClose?: () => void;
}

export default function ProgressPanel({ todos, byAgent, extra, onClose }: ProgressPanelProps) {
  const groups: Array<[string | null, Todo[]]> = byAgent
    ? byAgent.filter(([, list]) => list.length > 0)
    : todos && todos.length > 0
      ? [[null, todos]]
      : [];

  return (
    <aside className="progress-panel">
      <div className="progress-panel-head">
        <strong>Progress</strong>
        <span className="muted small">AI checklist — survives disconnects</span>
        {onClose && <button className="btn btn-icon" onClick={onClose} title="Hide panel">×</button>}
      </div>
      {groups.length === 0 && !extra ? (
        <div className="muted small" style={{ padding: "10px 2px" }}>
          No checklist yet — the agent creates one when it starts a multi-step task.
        </div>
      ) : (
        groups.map(([name, list], i) => (
          <div key={name ?? i} className="progress-group">
            {name && <div className="progress-group-name">{name}</div>}
            <TodoList todos={list} />
          </div>
        ))
      )}
      {extra}
    </aside>
  );
}
