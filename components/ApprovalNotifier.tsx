"use client";
/**
 * Global alerts for anything an agent is WAITING on:
 *  - approval requests (shell / SQL / Redis / .env) → Allow once / Always / Deny
 *  - runs paused on a NETWORK error (offline)       → Retry / Cancel
 * Polls the pending endpoints and shows a native desktop notification once per
 * item plus a floating card that works from any page. Decisions go to the same
 * endpoints the inline chat cards use.
 */
import { useEffect, useRef, useState } from "react";

interface PendingApproval {
  id: string;
  kind: string;
  detail: string;
  createdAt: number;
  expiresAt: number;
}

interface PausedRun {
  id: string;
  agentName: string;
  reason: string;
  createdAt: number;
}

const KIND_ICON: Record<string, string> = {
  shell: "❯_",
  database: "🗄",
  redis: "⚡",
  env: "🔑",
  learning: "🧠",
};

const POLL_MS = 4000;

async function notify(id: string, title: string, body: string) {
  try {
    if (typeof Notification === "undefined") return;
    // Do NOT auto-request permission — only send if already granted (MAJOR-7 fix).
    // Permission should be requested explicitly from a user gesture in the UI.
    if (Notification.permission !== "granted") return;
    const n = new Notification(title, { body: body.slice(0, 140), tag: id, silent: false });
    n.onclick = () => window.focus();
  } catch { /* notifications unavailable — the floating card still shows */ }
}

export default function ApprovalNotifier() {
  const [approvals, setApprovals] = useState<PendingApproval[]>([]);
  const [paused, setPaused] = useState<PausedRun[]>([]);
  const [now, setNow] = useState(Date.now());
  const notified = useRef<Set<string>>(new Set());

  useEffect(() => {
    let alive = true;

    const poll = async () => {
      try {
        const [a, p] = await Promise.all([
          fetch("/api/approvals/pending").then((r) => r.json()).catch(() => []),
          fetch("/api/runs/paused").then((r) => r.json()).catch(() => []),
        ]);
        if (!alive) return;
        const apps: PendingApproval[] = Array.isArray(a) ? a : [];
        const runs: PausedRun[] = Array.isArray(p) ? p : [];
        setApprovals(apps);
        setPaused(runs);

        for (const x of apps) {
          if (notified.current.has(x.id)) continue;
          notified.current.add(x.id);
          void notify(x.id, "Approval needed", `${x.kind}: ${x.detail}`);
        }
        for (const x of runs) {
          if (notified.current.has(x.id)) continue;
          notified.current.add(x.id);
          void notify(x.id, "Connection lost — run paused", `${x.agentName}: press Retry when you're back online.`);
        }
        // Forget resolved ids so the set doesn't grow forever.
        const ids = new Set([...apps.map((x) => x.id), ...runs.map((x) => x.id)]);
        for (const id of notified.current) if (!ids.has(id)) notified.current.delete(id);
      } catch { /* server briefly unavailable — try again next tick */ }
    };

    poll();
    const iv = setInterval(poll, POLL_MS);
    const tick = setInterval(() => setNow(Date.now()), 1000);
    return () => { alive = false; clearInterval(iv); clearInterval(tick); };
  }, []);

  const decideApproval = async (id: string, decision: "always" | "once" | "deny") => {
    setApprovals((cur) => cur.filter((p) => p.id !== id)); // optimistic
    try {
      await fetch("/api/shell/approve", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ id, decision }),
      });
    } catch { /* if it failed, the next poll brings the card back */ }
  };

  const decidePause = async (id: string, action: "retry" | "cancel") => {
    setPaused((cur) => cur.filter((p) => p.id !== id)); // optimistic
    try {
      await fetch("/api/runs/retry", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ id, action }),
      });
    } catch { /* if it failed, the next poll brings the card back */ }
  };

  if (approvals.length === 0 && paused.length === 0) return null;

  return (
    <div className="approval-notifier" role="alert" aria-live="assertive">
      {paused.map((p) => (
        <div key={p.id} className="approval-notifier-card approval-notifier-card--offline">
          <div className="approval-notifier-head">
            <span>📡</span>
            <strong>Connection lost — {p.agentName} is paused</strong>
          </div>
          <pre className="approval-notifier-detail">{p.reason}</pre>
          <div className="approval-notifier-actions">
            <button className="btn btn-primary" onClick={() => decidePause(p.id, "retry")} title="Retry the AI call and continue the run">
              ↻ Retry
            </button>
            <button className="btn btn-danger-ghost" onClick={() => decidePause(p.id, "cancel")} title="Stop this run">
              Cancel run
            </button>
          </div>
        </div>
      ))}
      {approvals.map((p) => {
        const secondsLeft = Math.max(0, Math.round((p.expiresAt - now) / 1000));
        return (
          <div key={p.id} className="approval-notifier-card">
            <div className="approval-notifier-head">
              <span>{KIND_ICON[p.kind] ?? "⚠"}</span>
              <strong>Approval needed — {p.kind}</strong>
              <span className="muted small" title="Auto-denied when the timer runs out">
                {Math.floor(secondsLeft / 60)}:{String(secondsLeft % 60).padStart(2, "0")}
              </span>
            </div>
            <pre className="approval-notifier-detail">{p.detail}</pre>
            <div className="approval-notifier-actions">
              <button className="btn btn-primary" onClick={() => decideApproval(p.id, "once")}>Allow once</button>
              <button className="btn" onClick={() => decideApproval(p.id, "always")} title="Allow and add to the allowlist">Always allow</button>
              <button className="btn btn-danger-ghost" onClick={() => decideApproval(p.id, "deny")}>Deny</button>
            </div>
          </div>
        );
      })}
    </div>
  );
}
