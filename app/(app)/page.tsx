"use client";
import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import AgentAvatar from "@/components/AgentAvatar";
import Icon from "@/components/Icon";

interface Agent {
  id: number;
  name: string;
  description: string | null;
  tools: string | null;
  avatar: string | null;
  color: string | null;
  category: string | null;
}

const ALL = "All";
const MAX_TAGS = 3;

// Safe JSON array parse — returns [] if the string is null/undefined/corrupt (CRITICAL-3)
function safeParseArray<T = string>(json: string | null | undefined): T[] {
  try { return JSON.parse(json || "[]") ?? []; }
  catch { return []; }
}

const categoryOf = (a: Agent) => (a.category || "").trim() || "Uncategorized";

export default function AgentsPage() {
  const [agents, setAgents] = useState<Agent[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState(ALL);

  const load = useCallback(async () => {
    try {
      setLoadError(null);
      const r = await fetch("/api/agents");
      if (!r.ok) throw new Error(`Server error: ${r.status}`);
      setAgents(await r.json());
    } catch (e: unknown) {
      setLoadError(e instanceof Error ? e.message : "Unknown error");
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const del = async (id: number, name: string) => {
    if (!confirm(`Delete agent "${name}"? All of its conversations will be deleted too.`)) return;
    await fetch(`/api/agents/${id}`, { method: "DELETE" });
    load();
  };

  const categories = useMemo(() => {
    const set = new Set((agents ?? []).map(categoryOf));
    return [ALL, ...Array.from(set).sort((a, b) => a.localeCompare(b))];
  }, [agents]);

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    return (agents ?? []).filter((a) =>
      (category === ALL || categoryOf(a) === category) &&
      (!q || `${a.name} ${a.description ?? ""} ${a.tools ?? ""}`.toLowerCase().includes(q)),
    );
  }, [agents, query, category]);

  return (
    <div className="agents-page">
      <header className="page-header">
        <div>
          <h1>Agents</h1>
          <p className="page-header-sub">
            {agents ? `${agents.length} agent${agents.length === 1 ? "" : "s"} · pick one to start a conversation` : "Loading your agents…"}
          </p>
        </div>
        <div className="page-header-actions">
          <Link href="/agents/new" className="btn btn-primary">
            <Icon name="plus" size={15} strokeWidth={2.2} /> New agent
          </Link>
        </div>
      </header>

      {loadError && (
        <div className="banner-danger" style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <span style={{ flex: 1 }}>Failed to load agents: {loadError}</span>
          <button className="btn btn-sm" onClick={load}><Icon name="refresh" size={14} /> Retry</button>
        </div>
      )}

      {agents && agents.length > 0 && (
        <div className="agents-toolbar">
          <label className="input-with-icon agents-search">
            <Icon name="search" size={15} />
            <input
              className="input"
              type="search"
              placeholder="Search agents, tools…"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              aria-label="Search agents"
            />
          </label>
          {categories.length > 2 && (
            <div className="segmented" role="tablist" aria-label="Filter by category">
              {categories.map((c) => (
                <button
                  key={c}
                  role="tab"
                  aria-selected={category === c}
                  className={`segmented-item${category === c ? " active" : ""}`}
                  onClick={() => setCategory(c)}
                >
                  {c}
                </button>
              ))}
            </div>
          )}
        </div>
      )}

      {agents === null && !loadError && (
        <div className="card-grid">
          {[0, 1, 2, 3, 4, 5].map((i) => (
            <div key={i} className="agent-card agent-card-skeleton">
              <div className="row" style={{ gap: 12 }}>
                <div className="skeleton" style={{ width: 36, height: 36, borderRadius: 10 }} />
                <div className="skeleton" style={{ width: "50%" }} />
              </div>
              <div className="skeleton" style={{ marginTop: 16 }} />
              <div className="skeleton" style={{ width: "70%", marginTop: 8 }} />
            </div>
          ))}
        </div>
      )}

      {agents?.length === 0 && (
        <div className="empty-state">
          <span className="glyph"><Icon name="agents" size={24} /></span>
          <span className="empty-state-title">No agents yet</span>
          <span>Create your first agent to get started.</span>
          <Link href="/agents/new" className="btn btn-primary" style={{ marginTop: 14 }}>
            <Icon name="plus" size={15} strokeWidth={2.2} /> New agent
          </Link>
        </div>
      )}

      {agents && agents.length > 0 && visible.length === 0 && (
        <div className="empty-state">
          <span className="glyph"><Icon name="search" size={22} /></span>
          <span className="empty-state-title">No matching agents</span>
          <span>Try a different search or category.</span>
        </div>
      )}

      <div className="card-grid">
        {visible.map((a, i) => {
          const tools = safeParseArray<string>(a.tools);
          return (
            <article
              key={a.id}
              className="agent-card"
              style={{ animationDelay: `${Math.min(i, 12) * 28}ms` }}
            >
              <Link href={`/chat/${a.id}`} className="agent-card-link" aria-label={`Chat with ${a.name}`} />
              <div className="agent-card-head">
                <AgentAvatar avatar={a.avatar} color={a.color} size={36} name={a.name} />
                <div className="agent-card-title">
                  <h3>{a.name}</h3>
                  {a.category && <span className="agent-card-category">{a.category}</span>}
                </div>
                <div className="agent-card-actions">
                  <Link href={`/agents/${a.id}`} className="btn btn-ghost btn-icon btn-sm" title="Edit agent" aria-label={`Edit ${a.name}`}>
                    <Icon name="pencil" size={14} />
                  </Link>
                  <button className="btn btn-danger-ghost btn-icon btn-sm" title="Delete agent" aria-label={`Delete ${a.name}`} onClick={() => del(a.id, a.name)}>
                    <Icon name="trash" size={14} />
                  </button>
                </div>
              </div>
              <p className="agent-card-desc">{a.description || "No description"}</p>
              {tools.length > 0 && (
                <div className="agent-card-tags">
                  {tools.slice(0, MAX_TAGS).map((t) => <span key={t} className="tag">{t}</span>)}
                  {tools.length > MAX_TAGS && (
                    <span className="tag" title={tools.slice(MAX_TAGS).join(", ")}>+{tools.length - MAX_TAGS}</span>
                  )}
                </div>
              )}
              <span className="agent-card-cta" aria-hidden>
                <Icon name="chat" size={13} /> Open chat
              </span>
            </article>
          );
        })}
      </div>
    </div>
  );
}
