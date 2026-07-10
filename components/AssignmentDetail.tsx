"use client";
/**
 * AssignmentDetail — expandable card that shows live progress of a single
 * manager task assignment. Polls while the assignment is active and stops
 * once it reaches a terminal state (approved | failed).
 *
 * Shows:
 *  - Plan drafted by the agent (plan mode)
 *  - Live event log (dispatched, completion_check_failed, revision_requested, etc.)
 *  - Final result (act mode) once available
 *  - Review notes when rejected / needs revision
 */
import { useEffect, useRef, useState } from "react";

interface AssignmentEvent {
  id: number;
  event_type: string;
  content: string | null;
  created_at: string;
}

interface AssignmentFull {
  id: number;
  task_id: number;
  agent_id: number;
  agent_name: string;
  subtask_description: string;
  status: string;
  attempt_count: number;
  revision_count: number;
  last_plan: string | null;
  last_result: string | null;
  last_review_notes: string | null;
  updated_at: string;
}

interface Props {
  taskId: number;
  assignmentId: number;
  /** If true, the panel starts expanded */
  defaultOpen?: boolean;
}

const TERMINAL = new Set(["approved", "failed"]);
const ACTIVE_ASSIGNMENT = new Set(["in_progress", "submitted", "needs_revision"]);

const EVENT_LABEL: Record<string, string> = {
  dispatched: "🚀 Dispatched",
  submitted: "📨 Submitted",
  completion_check_failed: "🔄 Not complete yet",
  review_passed: "✅ Review passed",
  review_failed: "❌ Review failed",
  revision_requested: "🔁 Revision requested",
  assignment_approved: "✅ Approved",
  task_failed: "❌ Failed",
};

function eventLabel(type: string): string {
  return EVENT_LABEL[type] ?? type.replace(/_/g, " ");
}

export default function AssignmentDetail({ taskId, assignmentId, defaultOpen = false }: Props) {
  const [open, setOpen] = useState(defaultOpen);
  const [assignment, setAssignment] = useState<AssignmentFull | null>(null);
  const [events, setEvents] = useState<AssignmentEvent[]>([]);
  const logRef = useRef<HTMLDivElement>(null);

  const load = async () => {
    const res = await fetch(
      `/api/manager/tasks/${taskId}/assignments/${assignmentId}`
    );
    if (!res.ok) return;
    const data = await res.json();
    setAssignment(data.assignment);
    setEvents(data.events ?? []);
  };

  useEffect(() => {
    load();
  }, [taskId, assignmentId]);

  // Poll while the assignment is still active
  useEffect(() => {
    if (!open) return;
    const iv = setInterval(() => {
      setAssignment((cur) => {
        if (!cur || TERMINAL.has(cur.status)) {
          clearInterval(iv);
          return cur;
        }
        load();
        return cur;
      });
    }, 2000);
    return () => clearInterval(iv);
  }, [open, taskId, assignmentId]);

  // Auto-scroll event log to bottom when new events arrive
  useEffect(() => {
    if (open && logRef.current) {
      logRef.current.scrollTop = logRef.current.scrollHeight;
    }
  }, [events, open]);

  const isActive = assignment ? ACTIVE_ASSIGNMENT.has(assignment.status) : false;

  return (
    <div className="assignment-detail">
      {/* Header / toggle */}
      <button
        className="assignment-detail-toggle"
        onClick={() => {
          setOpen((o) => {
            if (!o) load(); // refresh on open
            return !o;
          });
        }}
        aria-expanded={open}
      >
        <span className="assignment-detail-chevron">{open ? "▾" : "▸"}</span>
        <span className="assignment-detail-label">
          {open ? "Hide detail" : "Show detail"}
        </span>
        {isActive && (
          <span className="dot dot-blue pulse-dot" style={{ marginLeft: 6 }} />
        )}
      </button>

      {open && (
        <div className="assignment-detail-body">
          {!assignment ? (
            <div className="skeleton" style={{ height: 40 }} />
          ) : (
            <>
              {/* Plan */}
              {assignment.last_plan && (
                <div className="assignment-section">
                  <div className="assignment-section-title">📋 Plan (plan mode)</div>
                  <pre className="assignment-pre">{assignment.last_plan}</pre>
                </div>
              )}

              {/* Live event log */}
              {events.length > 0 && (
                <div className="assignment-section">
                  <div className="assignment-section-title">
                    🗂 Event log
                    {isActive && (
                      <span className="muted small" style={{ marginLeft: 6 }}>
                        · live
                      </span>
                    )}
                  </div>
                  <div className="assignment-event-log" ref={logRef}>
                    {events.map((e) => (
                      <div key={e.id} className="assignment-event">
                        <span className="assignment-event-type">
                          {eventLabel(e.event_type)}
                        </span>
                        {e.content && (
                          <span className="assignment-event-content">
                            {e.content.length > 300
                              ? e.content.slice(0, 300) + "…"
                              : e.content}
                          </span>
                        )}
                        <span className="assignment-event-time muted small">
                          {new Date(e.created_at).toLocaleTimeString()}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Working indicator when no result yet */}
              {isActive && !assignment.last_result && (
                <div className="row muted small" style={{ marginTop: 8 }}>
                  <span className="dot dot-blue pulse-dot" />
                  Agent is working…
                </div>
              )}

              {/* Result */}
              {assignment.last_result && (
                <div className="assignment-section">
                  <div className="assignment-section-title">
                    📄 Result (act mode)
                    {assignment.attempt_count > 1 && (
                      <span className="muted small" style={{ marginLeft: 6 }}>
                        · attempt {assignment.attempt_count}
                      </span>
                    )}
                  </div>
                  <pre className="assignment-pre">{assignment.last_result}</pre>
                </div>
              )}

              {/* Review notes */}
              {assignment.last_review_notes && (
                <div className="assignment-section">
                  <div className="assignment-section-title">🔍 Review notes</div>
                  <div className="review-note" style={{ marginTop: 4 }}>
                    {assignment.last_review_notes}
                  </div>
                </div>
              )}
            </>
          )}
        </div>
      )}
    </div>
  );
}
