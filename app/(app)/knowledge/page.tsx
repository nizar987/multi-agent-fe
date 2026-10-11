"use client";
import { useEffect, useState } from "react";
import Icon from "@/components/Icon";
import PageHeader from "@/components/PageHeader";

export default function KnowledgePage() {
  const [items, setItems] = useState<any[]>([]);
  const [agents, setAgents] = useState<any[]>([]);
  const [editing, setEditing] = useState<any | null>(null);

  const [error, setError] = useState<string | null>(null);

  const loadJson = async (url: string): Promise<any[]> => {
    const r = await fetch(url);
    if (!r.ok) throw new Error(`${url} responded ${r.status}`);
    const data = await r.json();
    return Array.isArray(data) ? data : [];
  };

  const load = () => {
    setError(null);
    Promise.all([loadJson("/api/knowledge"), loadJson("/api/agents")])
      .then(([k, a]) => {
        setItems(k);
        setAgents(a);
      })
      .catch((e) => setError(e instanceof Error ? e.message : "Failed to load"));
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
    <div className="page-narrow">
      <PageHeader
        title="Knowledge"
        subtitle={<>Trusted context injected into the system prompt — for <strong>all agents</strong> (global) or one specific agent.</>}
        actions={
          <button className="btn btn-primary" onClick={() => setEditing({ title: "", content: "", agent_id: "" })}>
            <Icon name="plus" size={15} strokeWidth={2.2} /> New knowledge
          </button>
        }
      />

      {error && (
        <div className="banner-danger row" style={{ gap: 12 }}>
          <span style={{ flex: 1 }}><strong>Couldn&apos;t load knowledge.</strong> {error}</span>
          <button className="btn btn-sm" onClick={load}><Icon name="refresh" size={14} /> Retry</button>
        </div>
      )}

      {editing && (
        <div className="card editor-card mb-4">
          <h3>{editing.id ? "Edit knowledge" : "New knowledge"}</h3>
          <div className="field">
            <label>Title</label>
            <input className="input" autoFocus value={editing.title} onChange={(e) => setEditing({ ...editing, title: e.target.value })} />
          </div>
          <div className="field">
            <label>Applies to</label>
            <select className="input" value={editing.agent_id ?? ""} onChange={(e) => setEditing({ ...editing, agent_id: e.target.value })}>
              <option value="">All agents (global)</option>
              {agents.map((a) => <option key={a.id} value={a.id}>{a.avatar} {a.name}</option>)}
            </select>
          </div>
          <div className="field">
            <label>Content</label>
            <textarea className="input" rows={8} value={editing.content} onChange={(e) => setEditing({ ...editing, content: e.target.value })}
              placeholder="e.g. internal glossary, naming rules, team conventions, domain facts…" />
          </div>
          <div className="row" style={{ justifyContent: "flex-end" }}>
            <button className="btn btn-ghost" onClick={() => setEditing(null)}>Cancel</button>
            <button className="btn btn-primary" onClick={save} disabled={!editing.title || !editing.content}>Save</button>
          </div>
        </div>
      )}

      {items.length === 0 && !editing && !error && (
        <div className="empty-state">
          <span className="glyph"><Icon name="knowledge" size={22} /></span>
          <span className="empty-state-title">No knowledge yet</span>
          <span>Add context your agents should know.</span>
        </div>
      )}
      {items.length > 0 && (
        <div className="item-list">
          {items.map((k) => (
            <div key={k.id} className="item-row">
              <span className="item-row-icon"><Icon name="file-text" size={16} /></span>
              <div className="item-row-main">
                <div className="item-row-title">
                  <strong>{k.title}</strong>
                  <span className="tag">
                    {k.agent_name ? <>only {k.agent_name}</> : <><Icon name="globe" size={11} /> global</>}
                  </span>
                  {k.created_by_agent && <span className="tag tag-accent" title="Saved by the agent itself"><Icon name="brain" size={11} /> self-learned</span>}
                </div>
                <div className="item-row-sub">{String(k.content ?? "")}</div>
              </div>
              <div className="item-row-actions">
                <button className="btn btn-ghost btn-icon btn-sm" title="Edit" aria-label={`Edit ${k.title}`}
                  onClick={() => setEditing({ ...k, title: String(k.title ?? ""), content: String(k.content ?? ""), agent_id: k.agent_id ?? "" })}>
                  <Icon name="pencil" size={14} />
                </button>
                <button className="btn btn-danger-ghost btn-icon btn-sm" title="Delete" aria-label={`Delete ${k.title}`} onClick={() => del(k.id, k.title)}>
                  <Icon name="trash" size={14} />
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
