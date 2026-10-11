"use client";
import { useCallback, useEffect, useState } from "react";
import Icon from "@/components/Icon";
import PageHeader from "@/components/PageHeader";

export default function MemoryPage() {
  const [memories, setMemories] = useState<any[]>([]);
  const [audit, setAudit] = useState<any[]>([]);
  const [tab, setTab] = useState<"data" | "audit">("data");
  const [loadError, setLoadError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setLoadError(null);
      const [memRes, auditRes] = await Promise.all([
        fetch("/api/memory"),
        fetch("/api/memory/audit"),
      ]);
      if (!memRes.ok) throw new Error(`Memory fetch error: ${memRes.status}`);
      if (!auditRes.ok) throw new Error(`Audit fetch error: ${auditRes.status}`);
      setMemories(await memRes.json());
      setAudit(await auditRes.json());
    } catch (e: any) {
      setLoadError(e.message);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const del = async (key: string) => {
    if (!confirm(`Delete memory "${key}"?`)) return;
    await fetch("/api/memory", {
      method: "DELETE",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ key }),
    });
    load();
  };

  return (
    <div className="page-narrow">
      <PageHeader
        title="Shared Memory"
        subtitle="Values written by one agent can be read by the others. Every access is recorded in the audit log."
      />
      {loadError && (
        <div className="banner-danger row" style={{ gap: 12 }}>
          <span style={{ flex: 1 }}>Failed to load: {loadError}</span>
          <button className="btn btn-sm" onClick={load}><Icon name="refresh" size={14} /> Retry</button>
        </div>
      )}
      <div className="segmented mb-4" role="tablist" aria-label="Memory view">
        <button role="tab" aria-selected={tab === "data"} className={`segmented-item${tab === "data" ? " active" : ""}`} onClick={() => setTab("data")}>
          Data{memories.length > 0 && <span className="segmented-count">{memories.length}</span>}
        </button>
        <button role="tab" aria-selected={tab === "audit"} className={`segmented-item${tab === "audit" ? " active" : ""}`} onClick={() => setTab("audit")}>
          Audit log
        </button>
      </div>

      {tab === "data" && (
        <>
          {memories.length === 0 && (
            <div className="empty-state">
              <span className="glyph"><Icon name="memory" size={22} /></span>
              <span className="empty-state-title">Shared memory is empty</span>
              <span>Agents write here when they share values with each other.</span>
            </div>
          )}
          {memories.length > 0 && (
            <div className="item-list">
              {memories.map((m) => (
                <div key={m.key} className="item-row">
                  <span className="item-row-icon"><Icon name="key" size={15} /></span>
                  <div className="item-row-main">
                    <div className="item-row-title">
                      <strong className="mono">{m.key}</strong>
                      {String(m.key).startsWith("agent:") && (
                        <span className="tag tag-accent" title="Private note an agent saved for itself"><Icon name="brain" size={11} /> self-learned</span>
                      )}
                    </div>
                    <div className="item-row-sub item-row-sub--wrap">{m.value}</div>
                    <div className="item-row-meta">updated {m.updated_at}</div>
                  </div>
                  <div className="item-row-actions">
                    <button className="btn btn-danger-ghost btn-icon btn-sm" title="Delete" aria-label={`Delete ${m.key}`} onClick={() => del(m.key)}>
                      <Icon name="trash" size={14} />
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </>
      )}

      {tab === "audit" && (
        <>
          {audit.length === 0 && (
            <div className="empty-state">
              <span className="glyph"><Icon name="history" size={22} /></span>
              <span className="empty-state-title">No memory activity yet</span>
            </div>
          )}
          {audit.length > 0 && (
            <div className="item-list">
              {audit.map((a) => (
                <div key={a.id} className="item-row">
                  <span className="tag" style={{ minWidth: 52, justifyContent: "center" }}>{a.action}</span>
                  <div className="item-row-main">
                    <div className="item-row-title">
                      <span className="mono small">{a.key}</span>
                      {a.value_preview && <span className="muted small">— {a.value_preview}</span>}
                    </div>
                    <div className="item-row-meta">{a.agent_name ?? "?"} · {a.created_at}</div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </>
      )}
    </div>
  );
}
