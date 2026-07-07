"use client";
import { useEffect, useState } from "react";

export default function SkillsPage() {
  const [skills, setSkills] = useState<any[]>([]);
  const [editing, setEditing] = useState<any | null>(null);

  const load = () => fetch("/api/skills").then((r) => r.json()).then(setSkills);
  useEffect(() => { load(); }, []);

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
    <div style={{ maxWidth: 720 }}>
      <div className="row" style={{ justifyContent: "space-between", marginBottom: 20 }}>
        <h1 style={{ margin: 0 }}>Skills</h1>
        <button className="btn btn-primary" onClick={() => setEditing({ name: "", description: "", content: "" })}>+ New skill</button>
      </div>
      <p className="muted small mb-4">
        A skill = a snippet of instructions you can attach to an agent (injected into its system prompt).
      </p>

      {editing && (
        <div className="card mb-4">
          <div className="field">
            <label>Name</label>
            <input className="input" value={editing.name} onChange={(e) => setEditing({ ...editing, name: e.target.value })} />
          </div>
          <div className="field">
            <label>Short description</label>
            <input className="input" value={editing.description} onChange={(e) => setEditing({ ...editing, description: e.target.value })} />
          </div>
          <div className="field">
            <label>Instructions</label>
            <textarea className="input" rows={6} value={editing.content} onChange={(e) => setEditing({ ...editing, content: e.target.value })} />
          </div>
          <div className="row">
            <button className="btn btn-primary" onClick={save} disabled={!editing.name || !editing.content}>Save</button>
            <button className="btn" onClick={() => setEditing(null)}>Cancel</button>
          </div>
        </div>
      )}

      {skills.length === 0 && !editing && (
        <div className="empty-state"><div className="glyph">✦</div>No skills in the library yet.</div>
      )}
      {skills.map((s) => (
        <div key={s.id} className="list-row">
          <div className="grow">
            <strong>{s.name}</strong>
            <div className="muted small">{s.description}</div>
          </div>
          <button className="btn" onClick={() => setEditing(s)}>Edit</button>
          <button className="btn btn-danger-ghost" onClick={() => del(s.id, s.name)}>Delete</button>
        </div>
      ))}
    </div>
  );
}
