"use client";
import { useEffect, useState } from "react";
import Icon from "@/components/Icon";

type Kind = "shell" | "database" | "redis" | "env" | "learning";

interface Entry {
  id: number;
  kind: Kind;
  detail: string;
  created_at: string;
}

const KIND_LABELS: Record<Kind, string> = {
  shell: "⌘ Shell",
  database: "SQL",
  redis: "Redis",
  env: ".env",
  learning: "Catalog changes",
};

/** Manage "Always allow" approval entries — actions here run without asking. */
export default function AllowlistManager() {
  const [entries, setEntries] = useState<Entry[]>([]);
  const [kind, setKind] = useState<Kind>("shell");
  const [detail, setDetail] = useState("");

  const load = () => fetch("/api/approvals/allowlist").then((r) => r.json()).then(setEntries);
  useEffect(() => { load(); }, []);

  const add = async () => {
    const d = detail.trim();
    if (!d) return;
    await fetch("/api/approvals/allowlist", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ kind, detail: d }),
    });
    setDetail("");
    load();
  };

  const remove = async (id: number) => {
    await fetch(`/api/approvals/allowlist?id=${id}`, { method: "DELETE" });
    load();
  };

  return (
    <div>
      {entries.length === 0 && (
        <div className="empty-state">
          <span className="glyph"><Icon name="permissions" size={22} /></span>
          <span className="empty-state-title">Nothing is always-allowed yet</span>
          <span>Choose “Always allow” on an approval card, or add an entry below.</span>
        </div>
      )}

      {entries.length > 0 && (
        <div className="item-list">
          {entries.map((e) => (
            <div key={e.id} className="item-row">
              <span className="tag" style={{ flex: "none", minWidth: 64, justifyContent: "center" }}>{KIND_LABELS[e.kind]}</span>
              <div className="item-row-main">
                <code className="item-row-sub" style={{ color: "var(--text-primary)" }} title={e.detail}>{e.detail}</code>
              </div>
              <div className="item-row-actions">
                <button className="btn btn-danger-ghost btn-icon btn-sm" onClick={() => remove(e.id)} title="Remove — this action will ask for approval again" aria-label="Remove entry">
                  <Icon name="x" size={14} />
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      <div className="card" style={{ display: "flex", gap: 8, marginTop: 16, alignItems: "center", padding: 10 }}>
        <select className="input" style={{ width: 130, flex: "none" }} value={kind} onChange={(e) => setKind(e.target.value as Kind)}>
          <option value="shell">Shell</option>
          <option value="database">SQL</option>
          <option value="redis">Redis</option>
          <option value="env">.env read</option>
          <option value="learning">Agent/skill/knowledge change</option>
        </select>
        <input
          className="input mono"
          style={{ flex: 1 }}
          value={detail}
          onChange={(e) => setDetail(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter") add(); }}
          placeholder={kind === "shell" ? "exact command, e.g. npm test" : "exact detail to always allow"}
        />
        <button className="btn btn-primary" onClick={add} disabled={!detail.trim()}><Icon name="plus" size={14} strokeWidth={2.2} /> Add</button>
      </div>
    </div>
  );
}
