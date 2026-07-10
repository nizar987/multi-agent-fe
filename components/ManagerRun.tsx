"use client";
import { useEffect, useState } from "react";
import AgentAvatar from "@/components/AgentAvatar";
import { statusBadge, assignmentBadge, eventLabel } from "@/app/(app)/manager/status";

interface Assignment {
  id: number;
  agent_id: number;
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
    clarification_options: string | null;
    report: string | null;
  };
  assignments: Assignment[];
  events: TaskEvent[];
}

const ACTIVE = ["planning", "in_progress", "reviewing", "revising", "reporting"];

interface AgentLite { id: number; avatar?: string; color?: string }

interface ManagerRunProps {
  taskId: number;
  agents: AgentLite[];
}

export default function ManagerRun({ taskId, agents }: ManagerRunProps) {
  const [data, setData] = useState<TaskDetail | null>(null);
  const [answer, setAnswer] = useState("");
  const [customMode, setCustomMode] = useState(false);
  const [sending, setSending] = useState(false);
  // track which assignment detail panels are open
  const [expanded, setExpanded] = useState<Record<number, boolean>>({});

  const load = () =>
    fetch(`/api/manager/tasks/${taskId}`)
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
  }, [taskId]);

  // auto-expand assignments that are actively in progress
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

  const sendAnswer = async (text: string) => {
    if (!text.trim() || sending) return;
    setSending(true);
    try {
      await fetch(`/api/manager/tasks/${taskId}/clarify`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ answer: text.trim() }),
      });
      setAnswer("");
      setCustomMode(false);
      load();
    } finally {
      setSending(false);
    }
  };

  const toggleExpand = (aId: number) =>
    setExpanded((prev) => ({ ...prev, [aId]: !prev[aId] }));

  const agentById = (id: number) => agents.find((a) => a.id === id);

  const parseOptions = (raw: string | null): string[] => {
    if (!raw) return [];
    try {
      const arr = JSON.parse(raw);
      return Array.isArray(arr) ? arr.slice(0, 2) : [];
    } catch { return []; }
  };

  if (!data) return <div className="skeleton" style={{ height: 60 }} />;

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

  return (
    <div className="manager-run">
      {/* Header */}
      <div className="row" style={{ justifyContent: "space-between", alignItems: "flex-start" }}>
        <div>
          <span className="muted small">🧭 Manager task</span>
          <div style={{ fontWeight: 600 }}>{task.title}</div>
        </div>
        <span className={`badge ${tb.cls}`}>
          {working && <span className="dot dot-blue pulse-dot" />}
          {tb.label}
        </span>
      </div>

      {/* Clarification */}
      {task.status === "clarifying" && task.clarification_question && (() => {
        const suggestions = parseOptions(task.clarification_options);
        return (
          <div className="card" style={{ borderColor: "var(--warning)", marginTop: 10 }}>
            <strong>The manager needs one thing before it starts:</strong>
            <p className="review-note" style={{ margin: "8px 0" }}>{task.clarification_question}</p>
            {suggestions.length > 0 && !customMode ? (
              <div style={{ display: "flex", flexDirection: "column", gap: 6, marginTop: 4 }}>
                {suggestions.map((s, i) => (
                  <button
                    key={i}
                    className="btn"
                    style={{ textAlign: "left", justifyContent: "flex-start", whiteSpace: "normal", lineHeight: 1.4 }}
                    disabled={sending}
                    onClick={() => sendAnswer(s)}
                  >
                    {s}
                  </button>
                ))}
                <button
                  className="btn"
                  style={{ borderStyle: "dashed", color: "var(--text-secondary)" }}
                  onClick={() => { setCustomMode(true); setAnswer(""); }}
                >
                  ✏️ Custom answer…
                </button>
              </div>
            ) : (
              <>
                <textarea
                  value={answer}
                  onChange={(e) => setAnswer(e.target.value)}
                  rows={2}
                  placeholder="Your answer…"
                  style={{ width: "100%", resize: "vertical", boxSizing: "border-box" }}
                  autoFocus={customMode}
                />
                <div className="row" style={{ justifyContent: "flex-end", marginTop: 8, gap: 6 }}>
                  {customMode && suggestions.length > 0 && (
                    <button className="btn" onClick={() => setCustomMode(false)}>← Back to choices</button>
                  )}
                  <button
                    className="btn btn-primary"
                    data-loading={sending}
                    onClick={() => sendAnswer(answer)}
                    disabled={sending || !answer.trim()}
                  >
                    {sending ? "Sending…" : "Send answer"}
                  </button>
                </div>
              </>
            )}
          </div>
        );
      })()}

      {/* Working indicator */}
      {working && !task.clarification_question && (
        <div className="row muted small" style={{ marginTop: 8 }}>
          <span className="dot dot-blue pulse-dot" /> Manager is working…
        </div>
      )}

      {/* Assignment list with inline live detail */}
      {assignments.length > 0 && (
        <div className="timeline" style={{ marginTop: 12 }}>
          {assignments.map((a) => {
            const ab = assignmentBadge(a.status);
            const av = agentById(a.agent_id);
            const isExpanded = expanded[a.id] ?? false;
            const isWorking = a.status === "in_progress";
            const aEvents = eventsByAssignment.get(a.id) ?? [];
            const hasPlan = !!a.last_plan;
            const hasResult = !!a.last_result;

            return (
              <div key={a.id} className="timeline-item">
                {/* Agent header row */}
                <div className="row" style={{ justifyContent: "space-between", alignItems: "flex-start" }}>
                  <span className="row" style={{ gap: 8, flex: 1, minWidth: 0 }}>
                    <AgentAvatar
                      avatar={av?.avatar}
                      color={av?.color}
                      size={24}
                      working={isWorking}
                    />
                    <span style={{ minWidth: 0 }}>
                      <strong>{a.agent_name}</strong>
                      <p className="muted small" style={{ margin: "2px 0 0", wordBreak: "break-word" }}>
                        {a.subtask_description}
                      </p>
                    </span>
                  </span>
                  <span className="row" style={{ gap: 6, flexShrink: 0, marginLeft: 8 }}>
                    <span className={`badge ${ab.cls}`}>
                      {isWorking && <span className="dot dot-blue pulse-dot" />}
                      {ab.label}
                    </span>
                    <button
                      className="btn"
                      style={{ padding: "2px 8px", fontSize: 11 }}
                      onClick={() => toggleExpand(a.id)}
                    >
                      {isExpanded ? "▲" : "▼"}
                    </button>
                  </span>
                </div>

                {/* Attempt / revision counters */}
                <div className="row muted small" style={{ marginTop: 6, gap: 12 }}>
                  <span>Attempts: {a.attempt_count}</span>
                  {a.revision_count > 0 && <span>Revisions: {a.revision_count}</span>}
                </div>

                {/* Review notes */}
                {a.last_review_notes &&
                  (a.status === "needs_revision" || a.status === "failed") && (
                    <div className="review-note" style={{ marginTop: 6 }}>
                      Reviewer: {a.last_review_notes}
                    </div>
                  )}

                {/* Expanded detail panel — live activity + plan + result */}
                {isExpanded && (
                  <div
                    style={{
                      marginTop: 10,
                      borderTop: "1px solid var(--border)",
                      paddingTop: 10,
                      display: "flex",
                      flexDirection: "column",
                      gap: 10,
                    }}
                  >
                    {/* Activity trail */}
                    {aEvents.length > 0 && (
                      <div>
                        <div className="small" style={{ fontWeight: 600, marginBottom: 4, color: "var(--text-secondary)" }}>
                          Activity
                        </div>
                        <div style={{ display: "flex", flexDirection: "column", gap: 3 }}>
                          {aEvents.map((e) => (
                            <div
                              key={e.id}
                              className="row small"
                              style={{ gap: 6, alignItems: "flex-start", color: "var(--text-secondary)" }}
                            >
                              <span style={{ flexShrink: 0 }}>{eventLabel(e.event_type)}</span>
                              {e.content && (
                                <span style={{
                                  color: "var(--text-tertiary)",
                                  fontFamily: "var(--font-mono)",
                                  fontSize: 11,
                                  wordBreak: "break-word",
                                }}>
                                  {e.content.slice(0, 150)}{e.content.length > 150 ? "…" : ""}
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
                      <details open={false}>
                        <summary className="muted small" style={{ cursor: "pointer", fontWeight: 600 }}>
                          🗒 Plan
                        </summary>
                        <pre style={{
                          whiteSpace: "pre-wrap",
                          margin: "6px 0 0",
                          fontSize: 11,
                          background: "var(--bg-surface)",
                          border: "1px solid var(--border)",
                          borderRadius: "var(--radius-sm)",
                          padding: "8px 10px",
                          lineHeight: 1.6,
                        }}>
                          {a.last_plan}
                        </pre>
                      </details>
                    )}

                    {/* Result — updates live while working */}
                    <div>
                      <div className="small" style={{
                        fontWeight: 600,
                        marginBottom: 4,
                        color: "var(--text-secondary)",
                        display: "flex",
                        alignItems: "center",
                        gap: 6,
                      }}>
                        📄 Result
                        {isWorking && (
                          <span className="muted" style={{ fontWeight: 400, fontSize: 11 }}>(updating…)</span>
                        )}
                      </div>
                      {hasResult ? (
                        <pre style={{
                          whiteSpace: "pre-wrap",
                          margin: 0,
                          fontSize: 11,
                          background: "var(--bg-surface)",
                          border: "1px solid var(--border)",
                          borderRadius: "var(--radius-sm)",
                          padding: "8px 10px",
                          lineHeight: 1.6,
                          maxHeight: 300,
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
      )}

      {/* Final report */}
      {task.report && (
        <div style={{ marginTop: 14 }}>
          <div style={{
            background: "var(--bg-surface)",
            border: "1px solid var(--border)",
            borderRadius: "var(--radius-md)",
            padding: "12px 14px",
            fontSize: 12,
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
