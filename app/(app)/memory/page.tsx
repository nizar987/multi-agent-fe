"use client";
import { useCallback, useEffect, useState } from "react";

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
    <div style={{ maxWidth: 720 }}>
      <h1>Shared Memory</h1>
      <p className="muted small mb-4">
        Values written by one agent can be read by the others. Every access is recorded in the audit log.
      </p>
      {loadError && (
        <div className="banner-danger" style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <span style={{ flex: 1 }}>Failed to load: {loadError}</span>
          <button className="btn" onClick={load}>Retry</button>
        </div>
      )}
      <div className="row mb-4">
        <button className={`btn${tab === "data" ? " btn-primary" : ""}`} onClick={() => setTab("data")}>Data</button>
        <button className={`btn${tab === "audit" ? " btn-primary" : ""}`} onClick={() => setTab("audit")}>Audit log</button>
      </div>

      {tab === "data" && (
        <>
          {memories.length === 0 && (
            <div className="empty-state"><div className="glyph">▤</div>Shared memory is still empty.</div>
          )}
          {memories.map((m) => (
            <div key={m.key} className="list-row">
              <div className="grow">
                <div className="mono small">
                  <strong>{m.key}</strong>
                  {String(m.key).startsWith("agent:") && <> <span className="tag" title="Private note an agent saved for itself">🧠 self-learned</span></>}
                </div>
                <div className="muted small" style={{ wordBreak: "break-word" }}>{m.value}</div>
                <div className="muted small">updated {m.updated_at}</div>
              </div>
              <button className="btn btn-danger-ghost" onClick={() => del(m.key)}>Delete</button>
            </div>
          ))}
        </>
      )}

      {tab === "audit" && (
        <>
          {audit.length === 0 && (
            <div className="empty-state"><div className="glyph">▤</div>No memory activity yet.</div>
          )}
          {audit.map((a) => (
            <div key={a.id} className="list-row">
              <span className={`tag`}>{a.action}</span>
              <div className="grow">
                <span className="mono small">{a.key}</span>
                {a.value_preview && <span className="muted small"> — {a.value_preview}</span>}
                <div className="muted small">{a.agent_name ?? "?"} · {a.created_at}</div>
              </div>
            </div>
          ))}
        </>
      )}
    </div>
  );
}
