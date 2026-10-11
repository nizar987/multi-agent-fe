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

import {
  Freq, FriendlySchedule, DAY_NAMES, DEFAULT_SCHEDULE,
  parseSchedule, buildSchedule, describeCron,
} from "@/lib/schedule";
import Icon from "@/components/Icon";
import AgentAvatar from "@/components/AgentAvatar";

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
      <div className="toolbar">
        <span className="muted small">{jobs.length} schedule{jobs.length === 1 ? "" : "s"} · {jobs.filter((j) => j.enabled).length} active</span>
        <span style={{ flex: 1 }} />
        <button className="btn btn-primary" onClick={() => { setEditing(null); setShowForm(true); }}><Icon name="plus" size={15} strokeWidth={2.2} /> New schedule</button>
      </div>

      {jobs.length === 0 && !showForm && (
        <div className="empty-state">
          <span className="glyph"><Icon name="schedules" size={22} /></span>
          <span className="empty-state-title">No schedules yet</span>
          <span>Create one to run an agent task automatically.</span>
        </div>
      )}

      {jobs.length > 0 && (
        <div className="item-list">
          {jobs.map((job) => (
            <div key={job.id} className={`item-row${job.enabled ? "" : " item-row--muted"}`}>
              <AgentAvatar avatar={job.agent_avatar} size={32} name={job.agent_name} />
              <div className="item-row-main">
                <div className="item-row-title"><strong>{job.name}</strong></div>
                <div className="item-row-sub">
                  {job.agent_name} · <span title={job.schedule}>{describeCron(job.schedule)}</span>
                </div>
                <div className="item-row-meta">
                  {job.prompt.slice(0, 100)}{job.prompt.length > 100 ? "…" : ""}
                  {job.last_run && <> · last run {new Date(job.last_run).toLocaleString()}</>}
                </div>
              </div>
              <div className="item-row-actions">
                <button className="btn btn-ghost btn-icon btn-sm" onClick={() => { setEditing(job); setShowForm(true); }} title="Edit" aria-label={`Edit ${job.name}`}>
                  <Icon name="pencil" size={14} />
                </button>
                <button className="btn btn-danger-ghost btn-icon btn-sm" onClick={() => remove(job.id)} title="Delete" aria-label={`Delete ${job.name}`}>
                  <Icon name="trash" size={14} />
                </button>
              </div>
              <label className="switch" title={job.enabled ? "Disable" : "Enable"}>
                <input type="checkbox" checked={!!job.enabled} onChange={() => toggle(job)} aria-label={`${job.enabled ? "Disable" : "Enable"} ${job.name}`} />
                <span className="switch-track" aria-hidden />
              </label>
            </div>
          ))}
        </div>
      )}

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
  const [sched, setSched] = useState<FriendlySchedule>(() =>
    job?.schedule ? parseSchedule(job.schedule) : { ...DEFAULT_SCHEDULE }
  );
  const [prompt, setPrompt] = useState(job?.prompt || "");

  const schedule = buildSchedule(sched);
  const patch = (p: Partial<FriendlySchedule>) => setSched((s) => ({ ...s, ...p }));

  return (
    <div className="card" style={{ marginTop: 12, padding: 16 }}>
      <h3>{job ? "Edit schedule" : "New schedule"}</h3>
      <div className="field">
        <label>Name</label>
        <input className="input" value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Daily summary" />
      </div>
      <div className="field">
        <label>Agent</label>
        <select className="input" value={agentId} onChange={(e) => setAgentId(Number(e.target.value))}>
          {agents.map((a) => (
            <option key={a.id} value={a.id}>{a.avatar ? `${a.avatar} ` : ""}{a.name}</option>
          ))}
        </select>
      </div>
      <div className="field">
        <label>Repeat</label>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
          <select
            className="input"
            style={{ width: 190 }}
            value={sched.freq}
            onChange={(e) => patch({ freq: e.target.value as Freq })}
          >
            <option value="hourly">Every hour</option>
            <option value="daily">Every day</option>
            <option value="weekdays">Weekdays (Mon–Fri)</option>
            <option value="weekly">Every week</option>
            <option value="monthly">Every month</option>
            <option value="custom">Custom (advanced)</option>
          </select>

          {sched.freq === "weekly" && (
            <select
              className="input"
              style={{ width: 140 }}
              value={sched.weekday}
              onChange={(e) => patch({ weekday: Number(e.target.value) })}
              aria-label="Day of the week"
            >
              {DAY_NAMES.map((d, i) => <option key={i} value={i}>{d}</option>)}
            </select>
          )}

          {sched.freq === "monthly" && (
            <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 13 }}>
              on day
              <input
                className="input"
                type="number"
                min={1}
                max={31}
                style={{ width: 70 }}
                value={sched.monthday}
                onChange={(e) => patch({ monthday: Math.min(31, Math.max(1, Number(e.target.value) || 1)) })}
                aria-label="Day of the month"
              />
            </label>
          )}

          {sched.freq !== "hourly" && sched.freq !== "custom" && (
            <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 13 }}>
              at
              <input
                className="input"
                type="time"
                style={{ width: 120 }}
                value={sched.time}
                onChange={(e) => patch({ time: e.target.value || "09:00" })}
                aria-label="Time"
              />
            </label>
          )}

          {sched.freq === "custom" && (
            <input
              className="input mono"
              style={{ width: 160 }}
              value={sched.custom}
              onChange={(e) => patch({ custom: e.target.value })}
              placeholder="0 9 * * *"
              title="Cron expression: minute hour day-of-month month day-of-week"
            />
          )}
        </div>
        <div className="hint" style={{ marginTop: 6 }}>
          Runs: <strong>{describeCron(schedule)}</strong>
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
