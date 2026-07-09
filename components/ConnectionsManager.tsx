"use client";
import { useEffect, useRef, useState } from "react";
import { AI_PROVIDER_PRESETS, getProviderPreset } from "@/lib/ai-provider-presets";

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
type ConnKind = "ai" | "github" | "gitlab" | "database" | "redis" | "grafana" | "prometheus" | "loki";

const KINDS: KindMeta[] = [
  {
    kind: "ai",
    title: "AI Provider",
    icon: "🤖",
    secretLabel: "API Key",
    secretPlaceholder: "sk-ant-… / sk-… / AIza…",
    secretRequired: true,
    fields: [
      { key: "provider", label: "API format", type: "select", options: ["auto", "anthropic", "openai", "gemini"], def: "auto", width: 150 },
      { key: "baseUrl", label: "Base URL", type: "text", def: "https://api.anthropic.com", placeholder: "https://api.anthropic.com · https://api.moonshot.ai/v1" },
      { key: "model", label: "Default model", type: "text", placeholder: "claude-sonnet-5 · kimi-k2.6 · gemini-2.5-pro" },
    ],
    summarize: (c) => `${c.provider || "auto"} · ${c.baseUrl || ""} · ${c.model || "(no model)"}`,
  },
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
      { key: "engine", label: "Engine", type: "select", options: ["postgres", "mysql", "mariadb"], def: "postgres", width: 150 },
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
  const [editingId, setEditingId] = useState<number | null>(null);
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
                <div key={c.id}>
                  <div className={`conn-row${c.is_active ? " active" : ""}`}>
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
                    <button
                      className="btn"
                      onClick={() => setEditingId(editingId === c.id ? null : c.id)}
                      style={{ padding: "3px 10px", fontSize: 12 }}
                    >{editingId === c.id ? "Close" : "Edit"}</button>
                    <button className="btn btn-danger-ghost" onClick={() => remove(c.id, c.name)} style={{ padding: "3px 10px", fontSize: 12 }}>Remove</button>
                  </div>
                  {editingId === c.id && (
                    <ConnForm
                      meta={meta}
                      existing={c}
                      onDone={() => { setEditingId(null); load(); notify(); }}
                      onCancel={() => setEditingId(null)}
                    />
                  )}
                </div>
              );
            })}

            <ConnForm meta={meta} onDone={() => { load(); notify(); }} />
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

/** Default Base URL per API format — auto-filled when the user picks a format. */
const PROVIDER_BASE_URLS: Record<string, string> = {
  auto: "https://api.anthropic.com",
  anthropic: "https://api.anthropic.com",
  openai: "https://api.openai.com",
  gemini: "https://generativelanguage.googleapis.com",
};

/**
 * Lenient parser for a Claude-Code-style settings.json:
 * { "env": { "ANTHROPIC_BASE_URL": "...", "ANTHROPIC_AUTH_TOKEN": "...", "ANTHROPIC_DEFAULT_MODEL": "..." } }
 * Tolerates trailing commas and a missing "env" wrapper.
 */
function parseSettingsJson(text: string): { baseUrl?: string; token?: string; model?: string } | null {
  try {
    const cleaned = text.replace(/,\s*([}\]])/g, "$1");
    const obj = JSON.parse(cleaned);
    const env = obj?.env ?? obj;
    const baseUrl = env?.ANTHROPIC_BASE_URL;
    const token = env?.ANTHROPIC_AUTH_TOKEN ?? env?.ANTHROPIC_API_KEY;
    const model = env?.ANTHROPIC_DEFAULT_MODEL ?? env?.ANTHROPIC_MODEL;
    if (!baseUrl && !token && !model) return null;
    return { baseUrl, token, model };
  } catch {
    return null;
  }
}

function ConnForm({ meta, existing, onDone, onCancel }: {
  meta: KindMeta;
  /** When set, the form edits this connection instead of creating a new one. */
  existing?: ConnectionView;
  onDone: () => void;
  onCancel?: () => void;
}) {
  const isEdit = !!existing;
  const initialValues = () =>
    isEdit ? { ...defaultValues(meta), ...existing!.config } : defaultValues(meta);

  const [open, setOpen] = useState(isEdit);
  const [name, setName] = useState(existing?.name ?? "");
  const [values, setValues] = useState<Record<string, any>>(initialValues());
  const [secret, setSecret] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const importRef = useRef<HTMLInputElement>(null);

  /** Fill the form from a Claude-Code-style settings.json (9router, etc.). */
  const importSettingsFile = async (file: File | undefined) => {
    if (!file) return;
    const parsed = parseSettingsJson(await file.text());
    if (!parsed) { setErr("settings.json tidak dikenali — butuh env.ANTHROPIC_BASE_URL / ANTHROPIC_AUTH_TOKEN."); return; }
    setErr("");
    setValues((v) => ({
      ...v,
      provider: "anthropic",
      baseUrl: parsed.baseUrl ?? v.baseUrl,
      model: parsed.model ?? v.model,
    }));
    if (parsed.token) setSecret(parsed.token);
    if (!name.trim()) {
      try { setName(`9Router (${new URL(parsed.baseUrl ?? "").host})`); }
      catch { setName("9Router"); }
    }
    if (importRef.current) importRef.current.value = "";
  };

  const [preset, setPreset] = useState("");

  /** Apply a provider preset: fill API format, Base URL and (if empty) model + name. */
  const applyPreset = (id: string) => {
    setPreset(id);
    if (!id) return;
    const p = getProviderPreset(id);
    if (!p) return;
    setErr("");
    setValues((v) => ({
      ...v,
      provider: p.format,
      baseUrl: p.baseUrl,
      model: String(v.model ?? "").trim() || (p.models[0] ?? ""),
    }));
    if (!name.trim()) setName(p.label);
  };

  const reset = () => { setName(existing?.name ?? ""); setValues(initialValues()); setSecret(""); setErr(""); setPreset(""); };

  const submit = async () => {
    // On edit, an empty secret means "keep the current key".
    if (!isEdit && meta.secretRequired && !secret.trim()) { setErr(`${meta.secretLabel} is required.`); return; }
    setBusy(true);
    setErr("");
    try {
      const config: Record<string, any> = {};
      for (const f of meta.fields) {
        config[f.key] = f.type === "number" ? Number(values[f.key]) || 0 : values[f.key];
      }
      const res = await fetch(isEdit ? `/api/connections/${existing!.id}` : "/api/connections", {
        method: isEdit ? "PATCH" : "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          ...(isEdit ? {} : { kind: meta.kind }),
          name: name.trim() || meta.title,
          config,
          secret: secret.trim() || null,
        }),
      });
      if (!res.ok) { setErr("Could not save the connection."); return; }
      reset();
      setOpen(false);
      onDone();
    } finally {
      setBusy(false);
    }
  };

  if (!open) {
    return <button className="btn" style={{ marginTop: 4 }} onClick={() => setOpen(true)}>+ Add {meta.title}</button>;
  }

  return (
    <div className="conn-addform">
      {meta.kind === "ai" && (
        <div className="row" style={{ justifyContent: "flex-end", marginBottom: 4 }}>
          <button
            className="btn"
            style={{ fontSize: 12, padding: "3px 10px" }}
            onClick={() => importRef.current?.click()}
            title='Isi form dari file settings.json (format Claude Code / 9router: { "env": { "ANTHROPIC_BASE_URL": …, "ANTHROPIC_AUTH_TOKEN": …, "ANTHROPIC_DEFAULT_MODEL": … } })'
          >
            📥 Import settings.json
          </button>
          <input
            ref={importRef}
            type="file"
            accept=".json,application/json"
            style={{ display: "none" }}
            onChange={(e) => importSettingsFile(e.target.files?.[0])}
          />
        </div>
      )}
      <div className="field">
        <label>Name</label>
        <input className="input" value={name} onChange={(e) => setName(e.target.value)} placeholder={`e.g. ${meta.title} (prod)`} />
      </div>
      {meta.kind === "ai" && (
        <div className="field">
          <label>Provider preset</label>
          <select className="input" value={preset} onChange={(e) => applyPreset(e.target.value)}>
            <option value="">Custom (set format & Base URL manually)</option>
            {AI_PROVIDER_PRESETS.map((p) => (
              <option key={p.id} value={p.id}>{p.label}{p.free ? " · free tier" : ""}</option>
            ))}
          </select>
          {preset && (() => {
            const p = getProviderPreset(preset);
            if (!p) return null;
            return (
              <div className="muted small" style={{ marginTop: 4 }}>
                {p.note ? <span>{p.note} </span> : null}
                {p.apiKeyUrl && (
                  <a href={p.apiKeyUrl} target="_blank" rel="noreferrer">Get API key ↗</a>
                )}
              </div>
            );
          })()}
        </div>
      )}
      <div className="row" style={{ flexWrap: "wrap", gap: 10 }}>
        {meta.fields.map((f) => (
          <div key={f.key} className="field" style={{ width: f.width, ...(f.width ? {} : { flex: "1 1 160px" }) }}>
            {f.type !== "checkbox" && <label>{f.label}</label>}
            {f.type === "select" ? (
              <select
                className="input"
                value={values[f.key]}
                onChange={(e) => {
                  const val = e.target.value;
                  setValues((v) => {
                    const next = { ...v, [f.key]: val };
                    if (meta.kind === "ai" && f.key === "provider") {
                      // Picking an API format also fills in its Base URL,
                      // unless the user already typed a custom gateway URL.
                      const cur = String(v.baseUrl ?? "").trim();
                      const isDefault = !cur || Object.values(PROVIDER_BASE_URLS).includes(cur);
                      if (isDefault) next.baseUrl = PROVIDER_BASE_URLS[val] ?? cur;
                      // Manually changing the format no longer matches a preset.
                      setPreset("");
                    }
                    if (meta.kind === "database" && f.key === "engine") {
                      // Auto-update port to match the selected engine default,
                      // but only if the user hasn't manually changed it yet.
                      const DEFAULT_PORTS: Record<string, number> = { postgres: 5432, mysql: 3306, mariadb: 3306 };
                      const currentPort = Number(v.port);
                      const prevDefault = DEFAULT_PORTS[String(v.engine) ?? "postgres"] ?? 5432;
                      const isDefaultPort = !currentPort || currentPort === prevDefault;
                      if (isDefaultPort) next.port = DEFAULT_PORTS[val] ?? 5432;
                    }
                    return next;
                  });
                }}
              >
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
        <label>{meta.secretLabel}{isEdit ? " (leave empty to keep the current one)" : ""}</label>
        <input
          className="input mono"
          type="password"
          value={secret}
          onChange={(e) => setSecret(e.target.value)}
          placeholder={isEdit ? (existing!.has_secret ? "•••••• (unchanged)" : meta.secretPlaceholder) : meta.secretPlaceholder}
        />
      </div>
      {err && <div className="banner-danger" style={{ marginBottom: 8 }}>{err}</div>}
      <div className="row" style={{ justifyContent: "flex-end", gap: 8 }}>
        <button className="btn" onClick={() => { reset(); setOpen(false); onCancel?.(); }}>Cancel</button>
        <button className="btn btn-primary" data-loading={busy} onClick={submit} disabled={busy}>
          {isEdit ? "Save changes" : "Add connection"}
        </button>
      </div>
    </div>
  );
}
