"use client";
import { useEffect, useState } from "react";

type Kind = "shell" | "database" | "redis" | "env" | "learning";

interface Entry {
  id: number;
  kind: Kind;
  detail: string;
  created_at: string;
}

const KIND_LABELS: Record<Kind, string> = {
  shell: "⌘ Shell",
  database: "🗄 SQL",
  redis: "⚡ Redis",
  env: "🔑 .env",
  learning: "🧠 Catalog changes",
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
      <p className="muted small" style={{ marginTop: 0 }}>
        Actions on this list run <strong>without asking for approval</strong>. Entries are added when
        you pick “Always allow” on an approval card, or manually below. Matching is exact.
      </p>

      {entries.length === 0 && (
        <div className="empty-state" style={{ padding: 20 }}>
          <div className="glyph">🛡</div>
          Nothing is always-allowed yet. Choose “Always allow” on an approval card to add an entry.
        </div>
      )}

      {entries.map((e) => (
        <div key={e.id} className="list-row" style={{ padding: "8px 12px", alignItems: "center" }}>
          <span className="tag" style={{ flex: "none" }}>{KIND_LABELS[e.kind]}</span>
          <code className="grow" style={{ fontSize: 12, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} title={e.detail}>
            {e.detail}
          </code>
          <button className="btn btn-danger-ghost" onClick={() => remove(e.id)} title="Remove — this action will ask for approval again" style={{ fontSize: 12, padding: "4px 10px" }}>×</button>
        </div>
      ))}

      <div style={{ display: "flex", gap: 8, marginTop: 12, alignItems: "center" }}>
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
        <button className="btn" onClick={add} disabled={!detail.trim()}>+ Add</button>
      </div>
    </div>
  );
}
