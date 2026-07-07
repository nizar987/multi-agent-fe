"use client";
import { useEffect, useState } from "react";
import AgentAvatar from "@/components/AgentAvatar";
import { statusBadge, assignmentBadge } from "@/app/(app)/manager/status";

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
interface TaskDetail {
  task: {
    id: number;
    title: string;
    original_request: string;
    status: string;
    clarification_question: string | null;
    clarification_options: string | null; // JSON array of 2 suggestions
    report: string | null;
  };
  assignments: Assignment[];
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
  const [showDetail, setShowDetail] = useState(false);

  const load = () =>
    fetch(`/api/manager/tasks/${taskId}`).then((r) => r.json()).then((d) => { if (!d.error) setData(d); });

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

  const sendAnswer = async () => {
    if (!answer.trim() || sending) return;
    setSending(true);
    try {
      await fetch(`/api/manager/tasks/${taskId}/clarify`, {
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

  const agentById = (id: number) => agents.find((a) => a.id === id);

  const parseOptions = (raw: string | null): string[] => {
    if (!raw) return [];
    try { const arr = JSON.parse(raw); return Array.isArray(arr) ? arr.slice(0, 2) : []; } catch { return []; }
  };

  if (!data) return <div className="skeleton" style={{ height: 60 }} />;
  const { task, assignments } = data;
  const tb = statusBadge(task.status);
  const working = ACTIVE.includes(task.status);

  return (
    <div className="manager-run">
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
                    onClick={() => {
                      setAnswer(s);
                      setSending(true);
                      fetch(`/api/manager/tasks/${taskId}/clarify`, {
                        method: "POST",
                        headers: { "content-type": "application/json" },
                        body: JSON.stringify({ answer: s }),
                      }).then(() => { setAnswer(""); load(); }).finally(() => setSending(false));
                    }}
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
                  <button className="btn btn-primary" data-loading={sending} onClick={sendAnswer} disabled={sending || !answer.trim()}>
                    {sending ? "Sending…" : "Send answer"}
                  </button>
                </div>
              </>
            )}
          </div>
        );
      })()}

      {working && !task.clarification_question && (
        <div className="row muted small" style={{ marginTop: 8 }}>
          <span className="dot dot-blue pulse-dot" /> Manager is working…
        </div>
      )}

      {/* Assignments */}
      {assignments.length > 0 && (
        <div className="timeline" style={{ marginTop: 12 }}>
          {assignments.map((a) => {
            const ab = assignmentBadge(a.status);
            const av = agentById(a.agent_id);
            return (
              <div key={a.id} className="timeline-item">
                <div className="row">
                  <span className="row" style={{ gap: 8 }}>
                    <AgentAvatar avatar={av?.avatar} color={av?.color} size={24} working={a.status === "in_progress"} />
                    <span>
                      <strong>{a.agent_name}</strong>
                      <p className="muted small" style={{ margin: "2px 0 0" }}>{a.subtask_description}</p>
                    </span>
                  </span>
                  <span className={`badge ${ab.cls}`}>
                    {a.status === "in_progress" && <span className="dot dot-blue pulse-dot" />}
                    {ab.label}
                  </span>
                </div>
                <div className="row muted small" style={{ marginTop: 8, gap: 12 }}>
                  <span>Attempts: {a.attempt_count}</span>
                  {a.revision_count > 0 && <span>Revisions: {a.revision_count}</span>}
                </div>
                {a.last_review_notes && (a.status === "needs_revision" || a.status === "failed") && (
                  <div className="review-note">Reviewer: {a.last_review_notes}</div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* Report */}
      {task.report && (
        <div style={{ marginTop: 12 }}>
          <div className="report-box">{task.report}</div>
          {assignments.length > 0 && (
            <>
              <button className="btn" style={{ marginTop: 10 }} onClick={() => setShowDetail((s) => !s)}>
                {showDetail ? "Hide detail per agent" : "See detail per agent"}
              </button>
              {showDetail && (
                <div className="timeline" style={{ marginTop: 10 }}>
                  {assignments.map((a) => (
                    <div key={a.id} className="timeline-item">
                      <strong>{a.agent_name}</strong>
                      {a.last_plan && (
                        <details style={{ margin: "8px 0 0" }}>
                          <summary className="muted small" style={{ cursor: "pointer" }}>Plan (plan mode)</summary>
                          <pre style={{ whiteSpace: "pre-wrap", margin: "6px 0 0", fontSize: 12 }}>{a.last_plan}</pre>
                        </details>
                      )}
                      <div className="muted small" style={{ margin: "10px 0 4px" }}>Result (act mode)</div>
                      <pre style={{ whiteSpace: "pre-wrap", margin: 0, fontSize: 12 }}>{a.last_result || "(no output)"}</pre>
                    </div>
                  ))}
                </div>
              )}
            </>
          )}
        </div>
      )}
    </div>
  );
}
