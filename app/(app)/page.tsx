"use client";
import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import AgentAvatar from "@/components/AgentAvatar";

// Safe JSON array parse — returns [] if the string is null/undefined/corrupt (CRITICAL-3)
function safeParseArray<T = string>(json: string | null | undefined): T[] {
  try { return JSON.parse(json || "[]") ?? []; }
  catch { return []; }
}

export default function AgentsPage() {
  const [agents, setAgents] = useState<any[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setLoadError(null);
      const r = await fetch("/api/agents");
      if (!r.ok) throw new Error(`Server error: ${r.status}`);
      setAgents(await r.json());
    } catch (e: any) {
      setLoadError(e.message);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const del = async (id: number, name: string) => {
    if (!confirm(`Delete agent "${name}"? All of its conversations will be deleted too.`)) return;
    await fetch(`/api/agents/${id}`, { method: "DELETE" });
    load();
  };

  return (
    <div>
      <div className="row" style={{ justifyContent: "space-between", marginBottom: 20 }}>
        <h1 style={{ margin: 0 }}>Agents</h1>
        <Link href="/agents/new" className="btn btn-primary">+ New agent</Link>
      </div>

      {loadError && (
        <div className="banner-danger" style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <span style={{ flex: 1 }}>Failed to load agents: {loadError}</span>
          <button className="btn" onClick={load}>Retry</button>
        </div>
      )}

      {agents === null && !loadError && (
        <div className="card-grid">
          {[0, 1, 2].map((i) => <div key={i} className="card"><div className="skeleton mb-2" /><div className="skeleton" style={{ width: "60%" }} /></div>)}
        </div>
      )}

      {agents?.length === 0 && (
        <div className="empty-state">
          <div className="glyph">◆</div>
          No agents yet. Create your first agent to get started.
        </div>
      )}

      <div className="card-grid">
        {agents?.map((a) => (
          <div key={a.id} className="card">
            <div className="row" style={{ justifyContent: "space-between" }}>
              <Link href={`/chat/${a.id}`} className="row" style={{ gap: 8, textDecoration: "none", color: "inherit", flex: 1, minWidth: 0 }}>
                <AgentAvatar avatar={a.avatar} color={a.color} size={30} name={a.name} />
                <h3 style={{ margin: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{a.name}</h3>
              </Link>
              <span className="row">
                <Link href={`/agents/${a.id}`} className="btn" style={{ padding: "3px 8px", fontSize: 12 }}>Edit</Link>
                <button className="btn btn-danger-ghost" style={{ padding: "3px 8px", fontSize: 12 }} onClick={() => del(a.id, a.name)}>Delete</button>
              </span>
            </div>
            <p className="muted small" style={{ margin: "8px 0" }}>{a.description || "No description"}</p>
            <div className="row" style={{ flexWrap: "wrap", gap: 4 }}>
              {safeParseArray<string>(a.tools).map((t) => <span key={t} className="tag">{t}</span>)}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
