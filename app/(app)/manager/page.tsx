"use client";
import Link from "next/link";
import { useEffect, useState } from "react";
import { statusBadge } from "./status";

interface TaskRow {
  id: number;
  title: string;
  status: string;
  clarification_question: string | null;
  created_at: string;
}

export default function ManagerPage() {
  const [tasks, setTasks] = useState<TaskRow[] | null>(null);
  const [request, setRequest] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");

  const load = () => fetch("/api/manager/tasks").then((r) => r.json()).then(setTasks);
  useEffect(() => {
    load();
    const iv = setInterval(load, 4000); // live-refresh statuses
    return () => clearInterval(iv);
  }, []);

  const submit = async () => {
    if (!request.trim() || busy) return;
    setBusy(true);
    setErr("");
    try {
      const res = await fetch("/api/manager/tasks", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ original_request: request.trim() }),
      });
      const data = await res.json();
      if (!res.ok) {
        setErr(data.error === "no_api_key" ? "Configure the AI API key in Settings first." : data.error || "Failed to create task.");
        return;
      }
      setRequest("");
      window.location.href = `/manager/${data.id}`;
    } finally {
      setBusy(false);
    }
  };

  return (
    <div>
      <div style={{ marginBottom: 20 }}>
        <h1 style={{ margin: 0 }}>Agent Manager</h1>
        <p className="muted small" style={{ marginTop: 6 }}>
          A supervisor that plans a task across your agents, checks their work, asks for revisions,
          and reports back.
        </p>
      </div>

      <div className="card" style={{ marginBottom: 24 }}>
        <label className="small muted" style={{ display: "block", marginBottom: 6 }}>
          What needs to be done?
        </label>
        <textarea
          value={request}
          onChange={(e) => setRequest(e.target.value)}
          onKeyDown={(e) => { if ((e.metaKey || e.ctrlKey) && e.key === "Enter") submit(); }}
          placeholder="e.g. Review the auth module in the repo and write a summary of the risks."
          rows={3}
          style={{ width: "100%", resize: "vertical", boxSizing: "border-box" }}
        />
        {err && <div className="banner-danger" style={{ marginTop: 10 }}>{err}</div>}
        <div className="row" style={{ justifyContent: "flex-end", marginTop: 10 }}>
          <button className="btn btn-primary" data-loading={busy} onClick={submit} disabled={busy || !request.trim()}>
            {busy ? "Starting…" : "Start task"}
          </button>
        </div>
      </div>

      <h3 style={{ margin: "0 0 12px" }}>Tasks</h3>
      {tasks === null && <div className="skeleton" style={{ height: 60 }} />}
      {tasks?.length === 0 && (
        <div className="empty-state">
          <div className="glyph">🧭</div>
          No tasks yet. Describe something above to get started.
        </div>
      )}
      <div className="card-grid">
        {tasks?.map((t) => {
          const b = statusBadge(t.status);
          return (
            <Link key={t.id} href={`/manager/${t.id}`} className="card clickable" style={{ textDecoration: "none", color: "inherit" }}>
              <div className="row" style={{ justifyContent: "space-between", alignItems: "flex-start" }}>
                <h3 style={{ margin: 0, fontSize: 15 }}>{t.title}</h3>
                <span className={`badge ${b.cls}`}>
                  {t.status === "in_progress" && <span className="dot dot-blue pulse-dot" />}
                  {b.label}
                </span>
              </div>
              {t.status === "clarifying" && t.clarification_question && (
                <p className="review-note" style={{ margin: "8px 0 0" }}>Waiting on you: {t.clarification_question}</p>
              )}
              <p className="muted small" style={{ margin: "8px 0 0" }}>{t.created_at}</p>
            </Link>
          );
        })}
      </div>
    </div>
  );
}
