"use client";
import { useEffect, useState } from "react";

type CronJob = {
  id: number;
  agent_id: number;
  agent_name: string;
  agent_avatar?: string;
  agent_color?: string;
  name: string;
  schedule: string;
  prompt: string;
  enabled: number;
  last_run: string | null;
};

type Agent = { id: number; name: string; avatar?: string; color?: string };

const PRESETS = [
  { label: "Every hour", value: "0 * * * *" },
  { label: "Every day at 9 AM", value: "0 9 * * *" },
  { label: "Every day at 6 PM", value: "0 18 * * *" },
  { label: "Every Monday 9 AM", value: "0 9 * * 1" },
  { label: "Every weekday 9 AM", value: "0 9 * * 1-5" },
];

function describeCron(expr: string): string {
  const p = PRESETS.find((p) => p.value === expr);
  if (p) return p.label;
  return expr;
}

export default function CronManager() {
  const [jobs, setJobs] = useState<CronJob[]>([]);
  const [agents, setAgents] = useState<Agent[]>([]);
  const [editing, setEditing] = useState<CronJob | null>(null);
  const [showForm, setShowForm] = useState(false);

  const load = () => {
    fetch("/api/cron").then((r) => r.json()).then(setJobs);
    fetch("/api/agents").then((r) => r.json()).then(setAgents);
  };

  useEffect(() => { load(); }, []);

  const save = async (data: Partial<CronJob>) => {
    if (editing) {
      await fetch(`/api/cron/${editing.id}`, {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(data),
      });
    } else {
      await fetch("/api/cron", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(data),
      });
    }
    setEditing(null);
    setShowForm(false);
    load();
  };

  const toggle = async (job: CronJob) => {
    await fetch(`/api/cron/${job.id}`, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ enabled: !job.enabled }),
    });
    load();
  };

  const remove = async (id: number) => {
    if (!confirm("Delete this cron job?")) return;
    await fetch(`/api/cron/${id}`, { method: "DELETE" });
    load();
  };

  return (
    <div>
      <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 12 }}>
        <span className="muted small">Schedule agent tasks to run automatically.</span>
        <span style={{ flex: 1 }} />
        <button className="btn btn-primary" onClick={() => { setEditing(null); setShowForm(true); }}>+ New cron</button>
      </div>

      {jobs.length === 0 && !showForm && (
        <div className="empty-state" style={{ padding: 24 }}>
          <div className="glyph">⏰</div>
          No cron jobs yet. Create one to schedule agent tasks.
        </div>
      )}

      {jobs.map((job) => (
        <div key={job.id} className="list-row" style={{ alignItems: "flex-start", padding: "10px 12px" }}>
          <span style={{ fontSize: 20, marginTop: 2 }}>{job.agent_avatar || "🤖"}</span>
          <div className="grow">
            <div style={{ fontWeight: 500 }}>{job.name}</div>
            <div className="muted small" style={{ marginTop: 2 }}>
              {job.agent_name} · <code style={{ fontSize: 11 }}>{describeCron(job.schedule)}</code>
            </div>
            <div className="muted small" style={{ marginTop: 4, fontSize: 12, opacity: 0.7 }}>
              {job.prompt.slice(0, 100)}{job.prompt.length > 100 ? "…" : ""}
            </div>
            {job.last_run && (
              <div className="muted small" style={{ marginTop: 4, fontSize: 11 }}>
                Last run: {new Date(job.last_run).toLocaleString()}
              </div>
            )}
          </div>
          <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
            <button
              className={`btn ${job.enabled ? "btn-success" : ""}`}
              onClick={() => toggle(job)}
              title={job.enabled ? "Disable" : "Enable"}
              style={{ fontSize: 12, padding: "4px 10px" }}
            >
              {job.enabled ? "✓ On" : "Off"}
            </button>
            <button className="btn" onClick={() => { setEditing(job); setShowForm(true); }} style={{ fontSize: 12, padding: "4px 10px" }}>Edit</button>
            <button className="btn btn-danger-ghost" onClick={() => remove(job.id)} style={{ fontSize: 12, padding: "4px 10px" }}>×</button>
          </div>
        </div>
      ))}

      {showForm && (
        <CronForm
          job={editing}
          agents={agents}
          onSave={save}
          onCancel={() => { setEditing(null); setShowForm(false); }}
        />
      )}
    </div>
  );
}

function CronForm({ job, agents, onSave, onCancel }: {
  job: CronJob | null;
  agents: Agent[];
  onSave: (data: Partial<CronJob>) => void;
  onCancel: () => void;
}) {
  const [name, setName] = useState(job?.name || "");
  const [agentId, setAgentId] = useState(job?.agent_id || (agents[0]?.id ?? 0));
  const [schedule, setSchedule] = useState(job?.schedule || "0 9 * * *");
  const [prompt, setPrompt] = useState(job?.prompt || "");

  return (
    <div className="card" style={{ marginTop: 12, padding: 16 }}>
      <h3>{job ? "Edit cron job" : "New cron job"}</h3>
      <div className="field">
        <label>Name</label>
        <input className="input" value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Daily summary" />
      </div>
      <div className="field">
        <label>Agent</label>
        <select className="input" value={agentId} onChange={(e) => setAgentId(Number(e.target.value))}>
          {agents.map((a) => (
            <option key={a.id} value={a.id}>{a.avatar || "🤖"} {a.name}</option>
          ))}
        </select>
      </div>
      <div className="field">
        <label>Schedule (cron expression)</label>
        <input className="input mono" value={schedule} onChange={(e) => setSchedule(e.target.value)} placeholder="0 9 * * *" />
        <div className="hint">
          Presets:{" "}
          {PRESETS.map((p) => (
            <button
              key={p.value}
              className="btn"
              style={{ fontSize: 11, padding: "2px 8px", marginRight: 4 }}
              onClick={() => setSchedule(p.value)}
            >
              {p.label}
            </button>
          ))}
        </div>
      </div>
      <div className="field">
        <label>Task prompt</label>
        <textarea
          className="input"
          rows={3}
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
          placeholder="What should the agent do on this schedule?"
        />
      </div>
      <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
        <button className="btn" onClick={onCancel}>Cancel</button>
        <button
          className="btn btn-primary"
          disabled={!name || !agentId || !schedule || !prompt}
          onClick={() => onSave({ name, agent_id: agentId, schedule, prompt })}
        >
          {job ? "Save" : "Create"}
        </button>
      </div>
    </div>
  );
}
