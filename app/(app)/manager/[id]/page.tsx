"use client";
import Link from "next/link";
import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import { statusBadge, assignmentBadge } from "../status";

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
  events: { id: number; event_type: string; content: string | null; created_at: string }[];
}

const ACTIVE = ["planning", "in_progress", "reviewing", "revising", "reporting"];

export default function ManagerTaskPage() {
  const { id } = useParams<{ id: string }>();
  const [data, setData] = useState<TaskDetail | null>(null);
  const [answer, setAnswer] = useState("");
  const [sending, setSending] = useState(false);
  const [showDetail, setShowDetail] = useState(false);

  const load = () => fetch(`/api/manager/tasks/${id}`).then((r) => r.json()).then((d) => { if (!d.error) setData(d); });
  useEffect(() => {
    load();
    const iv = setInterval(() => {
      // keep polling while the task is still moving
      setData((cur) => {
        if (!cur || ACTIVE.includes(cur.task.status)) load();
        return cur;
      });
    }, 3000);
    return () => clearInterval(iv);
  }, [id]);

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

  if (!data) return <div className="skeleton" style={{ height: 80 }} />;
  const { task, assignments } = data;
  const tb = statusBadge(task.status);
  const working = ACTIVE.includes(task.status);

  return (
    <div>
      <div className="row" style={{ marginBottom: 4 }}>
        <Link href="/manager" className="btn" style={{ padding: "3px 10px", fontSize: 12 }}>← Manager</Link>
      </div>
      <div className="row" style={{ justifyContent: "space-between", alignItems: "flex-start", marginBottom: 16 }}>
        <h1 style={{ margin: 0 }}>{task.title}</h1>
        <span className={`badge ${tb.cls}`}>
          {working && <span className="dot dot-blue pulse-dot" />}
          {tb.label}
        </span>
      </div>
      <p className="muted small" style={{ marginTop: 0 }}>{task.original_request}</p>

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
            <button className="btn btn-primary" data-loading={sending} onClick={sendAnswer} disabled={sending || !answer.trim()}>
              {sending ? "Sending…" : "Send answer"}
            </button>
          </div>
        </div>
      )}

      {/* Final report */}
      {task.report && (
        <div style={{ marginBottom: 24 }}>
          <h3 style={{ margin: "0 0 8px" }}>Report</h3>
          <div className="report-box">{task.report}</div>
        </div>
      )}

      {/* Working indicator */}
      {working && !task.clarification_question && (
        <div className="row muted small" style={{ margin: "0 0 16px" }}>
          <span className="dot dot-blue pulse-dot" /> Manager is working…
        </div>
      )}

      {/* Assignment timeline */}
      {assignments.length > 0 && (
        <>
          <h3 style={{ margin: "0 0 12px" }}>Assignments</h3>
          <div className="timeline">
            {assignments.map((a) => {
              const ab = assignmentBadge(a.status);
              return (
                <div key={a.id} className="timeline-item">
                  <div className="row">
                    <div>
                      <strong>{a.agent_name}</strong>
                      <p className="muted small" style={{ margin: "4px 0 0" }}>{a.subtask_description}</p>
                    </div>
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

          <button className="btn" style={{ marginTop: 16 }} onClick={() => setShowDetail((s) => !s)}>
            {showDetail ? "Hide detail per agent" : "See detail per agent"}
          </button>
          {showDetail && (
            <div style={{ marginTop: 12 }} className="timeline">
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
                  <pre style={{ whiteSpace: "pre-wrap", margin: 0, fontSize: 12 }}>
                    {a.last_result || "(no output)"}
                  </pre>
                </div>
              ))}
            </div>
          )}
        </>
      )}
    </div>
  );
}
