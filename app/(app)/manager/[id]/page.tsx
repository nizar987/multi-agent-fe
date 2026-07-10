"use client";
import Link from "next/link";
import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import { statusBadge, assignmentBadge, eventLabel } from "../status";

interface Assignment {
  id: number;
  agent_name: string;
  subtask_description: string;
  status: string;
  attempt_count: number;
  revision_count: number;
  last_plan: string | null;
  last_result: string | null;
  last_review_notes: string | null;
}

interface TaskEvent {
  id: number;
  assignment_id: number | null;
  event_type: string;
  content: string | null;
  created_at: string;
}

interface TaskDetail {
  task: {
    id: number;
    title: string;
    original_request: string;
    status: string;
    clarification_question: string | null;
    assumptions: string | null;
    report: string | null;
  };
  assignments: Assignment[];
  events: TaskEvent[];
}

const ACTIVE = ["planning", "in_progress", "reviewing", "revising", "reporting"];

export default function ManagerTaskPage() {
  const { id } = useParams<{ id: string }>();
  const [data, setData] = useState<TaskDetail | null>(null);
  const [answer, setAnswer] = useState("");
  const [sending, setSending] = useState(false);
  const [expanded, setExpanded] = useState<Record<number, boolean>>({});

  const load = () =>
    fetch(`/api/manager/tasks/${id}`)
      .then((r) => r.json())
      .then((d) => { if (!d.error) setData(d); });

  useEffect(() => {
    load();
    const iv = setInterval(() => {
      setData((cur) => {
        if (!cur || ACTIVE.includes(cur.task.status)) load();
        return cur;
      });
    }, 3000);
    return () => clearInterval(iv);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  // auto-expand assignments that are actively working
  useEffect(() => {
    if (!data) return;
    setExpanded((prev) => {
      const next = { ...prev };
      for (const a of data.assignments) {
        if (["in_progress", "needs_revision", "submitted"].includes(a.status)) {
          next[a.id] = true;
        }
        if (!(a.id in next)) next[a.id] = false;
      }
      return next;
    });
  }, [data]);

  const sendAnswer = async () => {
    if (!answer.trim() || sending) return;
    setSending(true);
    try {
      await fetch(`/api/manager/tasks/${id}/clarify`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ answer: answer.trim() }),
      });
      setAnswer("");
      load();
    } finally {
      setSending(false);
    }
  };

  const toggleExpand = (aId: number) =>
    setExpanded((prev) => ({ ...prev, [aId]: !prev[aId] }));

  if (!data) return <div className="skeleton" style={{ height: 80 }} />;

  const { task, assignments, events } = data;
  const tb = statusBadge(task.status);
  const working = ACTIVE.includes(task.status);

  // group events by assignment_id
  const eventsByAssignment = new Map<number | null, TaskEvent[]>();
  for (const e of events ?? []) {
    const key = e.assignment_id ?? null;
    if (!eventsByAssignment.has(key)) eventsByAssignment.set(key, []);
    eventsByAssignment.get(key)!.push(e);
  }
  const globalEvents = eventsByAssignment.get(null) ?? [];

  return (
    <div>
      {/* Header */}
      <div className="row" style={{ marginBottom: 4 }}>
        <Link href="/manager" className="btn" style={{ padding: "3px 10px", fontSize: 12 }}>
          ← Manager
        </Link>
      </div>
      <div className="row" style={{ justifyContent: "space-between", alignItems: "flex-start", marginBottom: 8 }}>
        <h1 style={{ margin: 0 }}>{task.title}</h1>
        <span className={`badge ${tb.cls}`}>
          {working && <span className="dot dot-blue pulse-dot" />}
          {tb.label}
        </span>
      </div>
      <p className="muted small" style={{ marginTop: 0, marginBottom: 16 }}>
        {task.original_request}
      </p>

      {/* Global events (planning / clarification phase) */}
      {globalEvents.length > 0 && (
        <div style={{ marginBottom: 16 }}>
          {globalEvents.map((e) => (
            <div key={e.id} className="row muted small" style={{ gap: 8, marginBottom: 4, alignItems: "flex-start" }}>
              <span style={{ flexShrink: 0 }}>{eventLabel(e.event_type)}</span>
              {e.content && (
                <span style={{ color: "var(--text-tertiary)", wordBreak: "break-word" }}>
                  — {e.content.slice(0, 120)}{e.content.length > 120 ? "…" : ""}
                </span>
              )}
            </div>
          ))}
        </div>
      )}

      {/* Clarification prompt */}
      {task.status === "clarifying" && task.clarification_question && (
        <div className="card" style={{ borderColor: "var(--warning)", marginBottom: 20 }}>
          <strong>The manager needs one thing before it starts:</strong>
          <p className="review-note" style={{ margin: "8px 0" }}>{task.clarification_question}</p>
          <textarea
            value={answer}
            onChange={(e) => setAnswer(e.target.value)}
            rows={2}
            placeholder="Your answer…"
            style={{ width: "100%", resize: "vertical", boxSizing: "border-box" }}
          />
          <div className="row" style={{ justifyContent: "flex-end", marginTop: 8 }}>
            <button
              className="btn btn-primary"
              data-loading={sending}
              onClick={sendAnswer}
              disabled={sending || !answer.trim()}
            >
              {sending ? "Sending…" : "Send answer"}
            </button>
          </div>
        </div>
      )}

      {/* Working indicator */}
      {working && !task.clarification_question && (
        <div className="row muted small" style={{ margin: "0 0 16px" }}>
          <span className="dot dot-blue pulse-dot" /> Manager is working…
        </div>
      )}

      {/* Assumptions */}
      {task.assumptions && (
        <div className="muted small" style={{
          border: "1px solid var(--warning)",
          borderRadius: 6,
          padding: "8px 12px",
          marginBottom: 16,
        }}>
          ℹ️ Assumption: {task.assumptions}
        </div>
      )}

      {/* Assignment timeline — live detail */}
      {assignments.length > 0 && (
        <>
          <h3 style={{ margin: "0 0 12px" }}>Assignments</h3>
          <div className="timeline">
            {assignments.map((a) => {
              const ab = assignmentBadge(a.status);
              const isExpanded = expanded[a.id] ?? false;
              const isWorking = a.status === "in_progress";
              const aEvents = eventsByAssignment.get(a.id) ?? [];
              const hasPlan = !!a.last_plan;
              const hasResult = !!a.last_result;

              return (
                <div key={a.id} className="timeline-item">
                  {/* Agent header + toggle */}
                  <div className="row" style={{ justifyContent: "space-between", alignItems: "flex-start" }}>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div className="row" style={{ gap: 8, marginBottom: 2 }}>
                        <strong>{a.agent_name}</strong>
                        <span className={`badge ${ab.cls}`} style={{ flexShrink: 0 }}>
                          {isWorking && <span className="dot dot-blue pulse-dot" />}
                          {ab.label}
                        </span>
                      </div>
                      <p className="muted small" style={{ margin: 0 }}>
                        {a.subtask_description}
                      </p>
                    </div>
                    <button
                      className="btn"
                      style={{ padding: "3px 10px", fontSize: 12, marginLeft: 8, flexShrink: 0 }}
                      onClick={() => toggleExpand(a.id)}
                    >
                      {isExpanded ? "Hide detail" : "Show detail"}
                    </button>
                  </div>

                  {/* Attempt / revision counters */}
                  <div className="row muted small" style={{ marginTop: 6, gap: 12 }}>
                    <span>Attempts: {a.attempt_count}</span>
                    {a.revision_count > 0 && <span>Revisions: {a.revision_count}</span>}
                  </div>

                  {/* Review notes */}
                  {a.last_review_notes && (a.status === "needs_revision" || a.status === "failed") && (
                    <div className="review-note" style={{ marginTop: 6 }}>
                      Reviewer: {a.last_review_notes}
                    </div>
                  )}

                  {/* Expanded detail panel */}
                  {isExpanded && (
                    <div style={{
                      marginTop: 12,
                      borderTop: "1px solid var(--border)",
                      paddingTop: 12,
                      display: "flex",
                      flexDirection: "column",
                      gap: 12,
                    }}>
                      {/* Activity trail for this assignment */}
                      {aEvents.length > 0 && (
                        <div>
                          <div className="small" style={{ fontWeight: 600, marginBottom: 6, color: "var(--text-secondary)" }}>
                            Activity
                          </div>
                          <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                            {aEvents.map((e) => (
                              <div key={e.id} className="row small" style={{ gap: 8, alignItems: "flex-start", color: "var(--text-secondary)" }}>
                                <span style={{ flexShrink: 0 }}>{eventLabel(e.event_type)}</span>
                                {e.content && (
                                  <span style={{
                                    color: "var(--text-tertiary)",
                                    wordBreak: "break-word",
                                    fontFamily: "var(--font-mono)",
                                    fontSize: 11,
                                  }}>
                                    {e.content.slice(0, 200)}{e.content.length > 200 ? "…" : ""}
                                  </span>
                                )}
                              </div>
                            ))}
                            {isWorking && (
                              <div className="row small" style={{ color: "var(--text-tertiary)", gap: 6 }}>
                                <span className="dot dot-blue pulse-dot" /> Working…
                              </div>
                            )}
                          </div>
                        </div>
                      )}

                      {/* Plan */}
                      {hasPlan && (
                        <div>
                          <div className="small" style={{ fontWeight: 600, marginBottom: 6, color: "var(--text-secondary)" }}>
                            🗒 Plan
                          </div>
                          <pre style={{
                            whiteSpace: "pre-wrap",
                            margin: 0,
                            fontSize: 12,
                            background: "var(--bg-surface)",
                            border: "1px solid var(--border)",
                            borderRadius: 6,
                            padding: "10px 12px",
                            lineHeight: 1.6,
                          }}>
                            {a.last_plan}
                          </pre>
                        </div>
                      )}

                      {/* Result — updates every 3s while working */}
                      <div>
                        <div className="small" style={{
                          fontWeight: 600,
                          marginBottom: 6,
                          color: "var(--text-secondary)",
                          display: "flex",
                          alignItems: "center",
                          gap: 6,
                        }}>
                          📄 Result
                          {isWorking && (
                            <span className="muted small" style={{ fontWeight: 400 }}>(updating…)</span>
                          )}
                        </div>
                        {hasResult ? (
                          <pre style={{
                            whiteSpace: "pre-wrap",
                            margin: 0,
                            fontSize: 12,
                            background: "var(--bg-surface)",
                            border: "1px solid var(--border)",
                            borderRadius: 6,
                            padding: "10px 12px",
                            lineHeight: 1.6,
                            maxHeight: 400,
                            overflowY: "auto",
                          }}>
                            {a.last_result}
                          </pre>
                        ) : (
                          <span className="muted small">
                            {isWorking
                              ? <span className="row" style={{ gap: 6 }}><span className="dot dot-blue pulse-dot" /> Agent is working…</span>
                              : "(no output yet)"}
                          </span>
                        )}
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </>
      )}

      {/* Final report */}
      {task.report && (
        <div style={{ marginTop: 28 }}>
          <h3 style={{ margin: "0 0 8px" }}>
            {task.status === "failed" ? "❌ Report" : "✅ Report"}
          </h3>
          <div style={{
            background: "var(--bg-muted)",
            border: "1px solid var(--border)",
            borderRadius: 8,
            padding: "14px 16px",
            fontSize: 13,
            lineHeight: 1.7,
            whiteSpace: "pre-wrap",
          }}>
            {task.report}
          </div>
        </div>
      )}
    </div>
  );
}
