"use client";
import { useCallback, useEffect, useState } from "react";
import Icon from "@/components/Icon";
import PageHeader from "@/components/PageHeader";

export default function SkillsPage() {
  const [skills, setSkills] = useState<any[]>([]);
  const [editing, setEditing] = useState<any | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setLoadError(null);
      const r = await fetch("/api/skills");
      if (!r.ok) throw new Error(`Server error: ${r.status}`);
      setSkills(await r.json());
    } catch (e: any) {
      setLoadError(e.message);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const save = async () => {
    const body = { name: editing.name, description: editing.description, content: editing.content };
    if (editing.id) {
      await fetch(`/api/skills/${editing.id}`, { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
    } else {
      await fetch("/api/skills", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
    }
    setEditing(null);
    load();
  };

  const del = async (id: number, name: string) => {
    if (!confirm(`Delete skill "${name}"?`)) return;
    await fetch(`/api/skills/${id}`, { method: "DELETE" });
    load();
  };

  return (
    <div className="page-narrow">
      <PageHeader
        title="Skills"
        subtitle="A skill is a snippet of instructions you can attach to an agent (injected into its system prompt)."
        actions={
          <button className="btn btn-primary" onClick={() => setEditing({ name: "", description: "", content: "" })}>
            <Icon name="plus" size={15} strokeWidth={2.2} /> New skill
          </button>
        }
      />

      {editing && (
        <div className="card editor-card mb-4">
          <h3>{editing.id ? "Edit skill" : "New skill"}</h3>
          <div className="field">
            <label>Name</label>
            <input className="input" autoFocus value={editing.name} onChange={(e) => setEditing({ ...editing, name: e.target.value })} />
          </div>
          <div className="field">
            <label>Short description</label>
            <input className="input" value={editing.description} onChange={(e) => setEditing({ ...editing, description: e.target.value })} />
          </div>
          <div className="field">
            <label>Instructions</label>
            <textarea className="input" rows={6} value={editing.content} onChange={(e) => setEditing({ ...editing, content: e.target.value })} />
          </div>
          <div className="row" style={{ justifyContent: "flex-end" }}>
            <button className="btn btn-ghost" onClick={() => setEditing(null)}>Cancel</button>
            <button className="btn btn-primary" onClick={save} disabled={!editing.name || !editing.content}>Save</button>
          </div>
        </div>
      )}

      {loadError && (
        <div className="banner-danger row" style={{ gap: 12 }}>
          <span style={{ flex: 1 }}>Failed to load skills: {loadError}</span>
          <button className="btn btn-sm" onClick={load}><Icon name="refresh" size={14} /> Retry</button>
        </div>
      )}

      {skills.length === 0 && !editing && !loadError && (
        <div className="empty-state">
          <span className="glyph"><Icon name="skills" size={22} /></span>
          <span className="empty-state-title">No skills yet</span>
          <span>Create reusable instructions and attach them to agents.</span>
        </div>
      )}
      {skills.length > 0 && (
        <div className="item-list">
          {skills.map((s) => (
            <div key={s.id} className="item-row">
              <span className="item-row-icon"><Icon name="sparkle" size={15} /></span>
              <div className="item-row-main">
                <div className="item-row-title">
                  <strong>{s.name}</strong>
                  {s.created_by_agent && <span className="tag tag-accent" title="Created by an agent itself"><Icon name="brain" size={11} /> self-learned</span>}
                </div>
                {s.description && <div className="item-row-sub">{s.description}</div>}
              </div>
              <div className="item-row-actions">
                <button className="btn btn-ghost btn-icon btn-sm" title="Edit" aria-label={`Edit ${s.name}`} onClick={() => setEditing(s)}>
                  <Icon name="pencil" size={14} />
                </button>
                <button className="btn btn-danger-ghost btn-icon btn-sm" title="Delete" aria-label={`Delete ${s.name}`} onClick={() => del(s.id, s.name)}>
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
