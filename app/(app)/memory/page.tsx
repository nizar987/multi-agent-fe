"use client";
import { useEffect, useState } from "react";

export default function MemoryPage() {
  const [memories, setMemories] = useState<any[]>([]);
  const [audit, setAudit] = useState<any[]>([]);
  const [tab, setTab] = useState<"data" | "audit">("data");

  const load = () => {
    fetch("/api/memory").then((r) => r.json()).then(setMemories);
    fetch("/api/memory/audit").then((r) => r.json()).then(setAudit);
  };
  useEffect(load, []);

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
                <div className="mono small"><strong>{m.key}</strong></div>
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
