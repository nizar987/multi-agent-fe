"use client";
import { useEffect, useState } from "react";

export default function KnowledgePage() {
  const [items, setItems] = useState<any[]>([]);
  const [agents, setAgents] = useState<any[]>([]);
  const [editing, setEditing] = useState<any | null>(null);

  const load = () => {
    fetch("/api/knowledge").then((r) => r.json()).then(setItems);
    fetch("/api/agents").then((r) => r.json()).then(setAgents);
  };
  useEffect(load, []);

  const save = async () => {
    const body = {
      title: editing.title,
      content: editing.content,
      agent_id: editing.agent_id ? Number(editing.agent_id) : null,
    };
    if (editing.id) {
      await fetch(`/api/knowledge/${editing.id}`, { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
    } else {
      await fetch("/api/knowledge", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
    }
    setEditing(null);
    load();
  };

  const del = async (id: number, title: string) => {
    if (!confirm(`Delete knowledge "${title}"?`)) return;
    await fetch(`/api/knowledge/${id}`, { method: "DELETE" });
    load();
  };

  return (
    <div style={{ maxWidth: 720 }}>
      <div className="row" style={{ justifyContent: "space-between", marginBottom: 20 }}>
        <h1 style={{ margin: 0 }}>Knowledge</h1>
        <button className="btn btn-primary" onClick={() => setEditing({ title: "", content: "", agent_id: "" })}>+ New knowledge</button>
      </div>
      <p className="muted small mb-4">
        Trusted context injected into the system prompt — for <strong>all agents</strong> (global) or one specific agent.
      </p>

      {editing && (
        <div className="card mb-4">
          <div className="field">
            <label>Title</label>
            <input className="input" value={editing.title} onChange={(e) => setEditing({ ...editing, title: e.target.value })} />
          </div>
          <div className="field">
            <label>Applies to</label>
            <select className="input" value={editing.agent_id ?? ""} onChange={(e) => setEditing({ ...editing, agent_id: e.target.value })}>
              <option value="">🌐 All agents (global)</option>
              {agents.map((a) => <option key={a.id} value={a.id}>{a.avatar} {a.name}</option>)}
            </select>
          </div>
          <div className="field">
            <label>Content</label>
            <textarea className="input" rows={8} value={editing.content} onChange={(e) => setEditing({ ...editing, content: e.target.value })}
              placeholder="e.g. internal glossary, naming rules, team conventions, domain facts…" />
          </div>
          <div className="row">
            <button className="btn btn-primary" onClick={save} disabled={!editing.title || !editing.content}>Save</button>
            <button className="btn" onClick={() => setEditing(null)}>Cancel</button>
          </div>
        </div>
      )}

      {items.length === 0 && !editing && (
        <div className="empty-state"><div className="glyph">📚</div>No knowledge yet. Add context your agents should know.</div>
      )}
      {items.map((k) => (
        <div key={k.id} className="list-row">
          <div className="grow">
            <strong>{k.title}</strong>{" "}
            <span className="tag">{k.agent_name ? `only ${k.agent_name}` : "🌐 global"}</span>
            <div className="muted small" style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", maxWidth: 480 }}>{k.content}</div>
          </div>
          <button className="btn" onClick={() => setEditing({ ...k, agent_id: k.agent_id ?? "" })}>Edit</button>
          <button className="btn btn-danger-ghost" onClick={() => del(k.id, k.title)}>Delete</button>
        </div>
      ))}
    </div>
  );
}
