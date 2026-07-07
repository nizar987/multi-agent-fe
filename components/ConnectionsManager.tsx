"use client";
import { useEffect, useState } from "react";

/* ---------------- kind metadata ---------------- */

type FieldType = "text" | "number" | "checkbox" | "select";
interface Field {
  key: string;
  label: string;
  type: FieldType;
  placeholder?: string;
  options?: string[];
  def?: string | number | boolean;
  width?: number;
}
interface KindMeta {
  kind: ConnKind;
  title: string;
  icon: string;
  secretLabel: string;
  secretPlaceholder: string;
  secretRequired: boolean;
  fields: Field[];
  summarize: (c: Record<string, any>) => string;
}
type ConnKind = "github" | "gitlab" | "database" | "redis" | "grafana" | "prometheus" | "loki";

const KINDS: KindMeta[] = [
  {
    kind: "github",
    title: "GitHub",
    icon: "🐙",
    secretLabel: "Personal Access Token",
    secretPlaceholder: "ghp_… / github_pat_…",
    secretRequired: true,
    fields: [],
    summarize: () => "REST API",
  },
  {
    kind: "gitlab",
    title: "GitLab",
    icon: "🦊",
    secretLabel: "Personal Access Token",
    secretPlaceholder: "glpat-…",
    secretRequired: true,
    fields: [{ key: "apiUrl", label: "API URL", type: "text", def: "https://gitlab.com/api/v4", placeholder: "https://gitlab.com/api/v4" }],
    summarize: (c) => String(c.apiUrl || ""),
  },
  {
    kind: "database",
    title: "Database",
    icon: "💾",
    secretLabel: "Password",
    secretPlaceholder: "database password",
    secretRequired: false,
    fields: [
      { key: "engine", label: "Engine", type: "select", options: ["postgres", "mysql"], def: "postgres", width: 150 },
      { key: "host", label: "Host", type: "text", def: "localhost" },
      { key: "port", label: "Port", type: "number", def: 5432, width: 100 },
      { key: "user", label: "User", type: "text" },
      { key: "database", label: "Database", type: "text" },
      { key: "ssl", label: "Use SSL/TLS", type: "checkbox", def: false },
    ],
    summarize: (c) => `${c.engine || "postgres"} · ${c.host || "localhost"}:${c.port || ""}/${c.database || ""}`,
  },
  {
    kind: "redis",
    title: "Redis",
    icon: "🧱",
    secretLabel: "Password (optional)",
    secretPlaceholder: "leave empty if no auth",
    secretRequired: false,
    fields: [
      { key: "host", label: "Host", type: "text", def: "localhost" },
      { key: "port", label: "Port", type: "number", def: 6379, width: 100 },
      { key: "db", label: "DB", type: "number", def: 0, width: 80 },
      { key: "username", label: "Username (ACL, optional)", type: "text" },
      { key: "tls", label: "Use TLS", type: "checkbox", def: false },
    ],
    summarize: (c) => `${c.host || "localhost"}:${c.port || ""} db ${c.db ?? 0}`,
  },
  {
    kind: "grafana",
    title: "Grafana",
    icon: "📊",
    secretLabel: "Service account token",
    secretPlaceholder: "glsa_…",
    secretRequired: true,
    fields: [
      { key: "url", label: "URL", type: "text", def: "http://localhost:3000", placeholder: "http://localhost:3000" },
      { key: "bin", label: "mcp-grafana path (optional — defaults to PATH)", type: "text", placeholder: "mcp-grafana" },
    ],
    summarize: (c) => `${c.url || ""} · via mcp-grafana`,
  },
  {
    kind: "prometheus",
    title: "Prometheus",
    icon: "🔥",
    secretLabel: "Password / bearer token (optional)",
    secretPlaceholder: "leave empty if no auth",
    secretRequired: false,
    fields: [
      { key: "url", label: "URL", type: "text", def: "http://localhost:9090", placeholder: "http://localhost:9090" },
      { key: "username", label: "Username (basic auth, optional)", type: "text" },
    ],
    summarize: (c) => String(c.url || ""),
  },
  {
    kind: "loki",
    title: "Loki",
    icon: "🪵",
    secretLabel: "Password / bearer token (optional)",
    secretPlaceholder: "leave empty if no auth",
    secretRequired: false,
    fields: [
      { key: "url", label: "URL", type: "text", def: "http://localhost:3100", placeholder: "http://localhost:3100" },
      { key: "username", label: "Username (basic auth, optional)", type: "text" },
    ],
    summarize: (c) => String(c.url || ""),
  },
];

/* ---------------- types ---------------- */

interface ConnectionView {
  id: number;
  kind: ConnKind;
  name: string;
  config: Record<string, any>;
  is_active: boolean;
  has_secret: boolean;
}

interface ConnectionsManagerProps {
  /** Restrict to specific kinds (defaults to all). */
  kinds?: ConnKind[];
  onChanged?: () => void;
}

/* ---------------- component ---------------- */

export default function ConnectionsManager({ kinds, onChanged }: ConnectionsManagerProps) {
  const [conns, setConns] = useState<ConnectionView[] | null>(null);
  const [testing, setTesting] = useState<Record<number, { ok?: boolean; message: string; loading: boolean }>>({});
  const shown = KINDS.filter((k) => !kinds || kinds.includes(k.kind));

  const load = () => fetch("/api/connections").then((r) => r.json()).then(setConns);
  useEffect(() => { load(); }, []);

  const notify = () => { onChanged?.(); window.dispatchEvent(new Event("settings-changed")); };

  const setActive = async (id: number) => {
    await fetch(`/api/connections/${id}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ active: true }),
    });
    await load();
    notify();
  };

  const remove = async (id: number, name: string) => {
    if (!confirm(`Remove connection "${name}"?`)) return;
    await fetch(`/api/connections/${id}`, { method: "DELETE" });
    await load();
    notify();
  };

  const test = async (id: number) => {
    setTesting((t) => ({ ...t, [id]: { message: "Testing…", loading: true } }));
    try {
      const res = await fetch(`/api/connections/${id}/test`, { method: "POST" });
      const data = await res.json();
      setTesting((t) => ({ ...t, [id]: { ok: data.ok, message: data.message, loading: false } }));
    } catch (e: unknown) {
      setTesting((t) => ({ ...t, [id]: { ok: false, message: e instanceof Error ? e.message : "Test failed", loading: false } }));
    }
  };

  if (!conns) return <div className="skeleton" style={{ height: 40 }} />;

  return (
    <div>
      {shown.map((meta) => {
        const rows = conns.filter((c) => c.kind === meta.kind);
        return (
          <div key={meta.kind} className="conn-group">
            <div className="conn-group-title">
              <span>{meta.icon} {meta.title}</span>
              <span className="tag">{rows.length} connection{rows.length !== 1 ? "s" : ""}</span>
            </div>

            {rows.length === 0 && <div className="muted small" style={{ margin: "4px 0 10px" }}>None yet — add one below.</div>}

            {rows.map((c) => {
              const t = testing[c.id];
              return (
                <div key={c.id} className={`conn-row${c.is_active ? " active" : ""}`}>
                  <label className="conn-radio" title="Set as the active connection for this type">
                    <input type="radio" checked={c.is_active} onChange={() => setActive(c.id)} />
                  </label>
                  <div className="grow" style={{ minWidth: 0 }}>
                    <div className="row" style={{ gap: 8 }}>
                      <strong style={{ fontSize: 13 }}>{c.name}</strong>
                      {c.is_active && <span className="badge badge-success">active</span>}
                      {!c.has_secret && meta.secretRequired && <span className="badge badge-warn">no token</span>}
                    </div>
                    <div className="muted small mono" style={{ marginTop: 2 }}>{meta.summarize(c.config)}</div>
                    {t && !t.loading && (
                      <div className="small" style={{ marginTop: 4, color: t.ok ? "var(--success)" : "var(--danger)" }}>
                        {t.ok ? "✓ " : "✕ "}{t.message}
                      </div>
                    )}
                  </div>
                  <button className="btn" data-loading={t?.loading} onClick={() => test(c.id)} style={{ padding: "3px 10px", fontSize: 12 }}>Test</button>
                  <button className="btn btn-danger-ghost" onClick={() => remove(c.id, c.name)} style={{ padding: "3px 10px", fontSize: 12 }}>Remove</button>
                </div>
              );
            })}

            <AddForm meta={meta} onAdded={() => { load(); notify(); }} />
          </div>
        );
      })}
    </div>
  );
}

/* ---------------- add form ---------------- */

function defaultValues(meta: KindMeta): Record<string, any> {
  const v: Record<string, any> = {};
  for (const f of meta.fields) v[f.key] = f.def ?? (f.type === "checkbox" ? false : "");
  return v;
}

function AddForm({ meta, onAdded }: { meta: KindMeta; onAdded: () => void }) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [values, setValues] = useState<Record<string, any>>(defaultValues(meta));
  const [secret, setSecret] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");

  const reset = () => { setName(""); setValues(defaultValues(meta)); setSecret(""); setErr(""); };

  const submit = async () => {
    if (meta.secretRequired && !secret.trim()) { setErr(`${meta.secretLabel} is required.`); return; }
    setBusy(true);
    setErr("");
    try {
      const config: Record<string, any> = {};
      for (const f of meta.fields) {
        config[f.key] = f.type === "number" ? Number(values[f.key]) || 0 : values[f.key];
      }
      const res = await fetch("/api/connections", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ kind: meta.kind, name: name.trim() || meta.title, config, secret: secret || null }),
      });
      if (!res.ok) { setErr("Could not save the connection."); return; }
      reset();
      setOpen(false);
      onAdded();
    } finally {
      setBusy(false);
    }
  };

  if (!open) {
    return <button className="btn" style={{ marginTop: 4 }} onClick={() => setOpen(true)}>+ Add {meta.title}</button>;
  }

  return (
    <div className="conn-addform">
      <div className="field">
        <label>Name</label>
        <input className="input" value={name} onChange={(e) => setName(e.target.value)} placeholder={`e.g. ${meta.title} (prod)`} />
      </div>
      <div className="row" style={{ flexWrap: "wrap", gap: 10 }}>
        {meta.fields.map((f) => (
          <div key={f.key} className="field" style={{ width: f.width, ...(f.width ? {} : { flex: "1 1 160px" }) }}>
            {f.type !== "checkbox" && <label>{f.label}</label>}
            {f.type === "select" ? (
              <select className="input" value={values[f.key]} onChange={(e) => setValues((v) => ({ ...v, [f.key]: e.target.value }))}>
                {f.options?.map((o) => <option key={o} value={o}>{o}</option>)}
              </select>
            ) : f.type === "checkbox" ? (
              <label className="row" style={{ fontWeight: 400, marginTop: 22 }}>
                <input type="checkbox" checked={!!values[f.key]} onChange={(e) => setValues((v) => ({ ...v, [f.key]: e.target.checked }))} />
                {f.label}
              </label>
            ) : (
              <input
                className="input mono"
                type={f.type === "number" ? "number" : "text"}
                value={values[f.key]}
                placeholder={f.placeholder}
                onChange={(e) => setValues((v) => ({ ...v, [f.key]: e.target.value }))}
              />
            )}
          </div>
        ))}
      </div>
      <div className="field">
        <label>{meta.secretLabel}</label>
        <input className="input mono" type="password" value={secret} onChange={(e) => setSecret(e.target.value)} placeholder={meta.secretPlaceholder} />
      </div>
      {err && <div className="banner-danger" style={{ marginBottom: 8 }}>{err}</div>}
      <div className="row" style={{ justifyContent: "flex-end", gap: 8 }}>
        <button className="btn" onClick={() => { reset(); setOpen(false); }}>Cancel</button>
        <button className="btn btn-primary" data-loading={busy} onClick={submit} disabled={busy}>Add connection</button>
      </div>
    </div>
  );
}
