"use client";
import { useEffect, useState } from "react";

interface ConnectionView {
  id: number;
  kind: string;
  name: string;
  config: Record<string, any>;
  is_active: boolean;
  has_secret: boolean;
}

const NVIDIA_BASE = "https://integrate.api.nvidia.com/v1";

/** Static curated list — no API fetch needed */
const NVIDIA_MODELS = [
  { id: "openai/gpt-oss-120b",                    label: "GPT-OSS 120B" },
  { id: "meta/llama-3.1-405b-instruct",            label: "Llama 3.1 405B" },
  { id: "nvidia/llama-3.3-nemotron-super-49b-v1",  label: "Nemotron 49B" },
  { id: "deepseek-ai/deepseek-r1",                 label: "DeepSeek R1" },
  { id: "meta/llama-3.1-70b-instruct",             label: "Llama 3.1 70B" },
];
const DEFAULT_MODEL = NVIDIA_MODELS[0].id;

function isNvidia(config: Record<string, any>) {
  return String(config.baseUrl || "").toLowerCase().includes("nvidia.com");
}

function modelLabel(modelId: string) {
  return NVIDIA_MODELS.find((m) => m.id === modelId)?.label ?? modelId;
}

export default function NvidiaNimSection({ onChanged }: { onChanged?: () => void }) {
  const [conns, setConns] = useState<ConnectionView[]>([]);
  const [loading, setLoading] = useState(true);
  const [formOpen, setFormOpen] = useState(false);
  const [editingId, setEditingId] = useState<number | null>(null);

  // form fields
  const [name, setName] = useState("");
  const [models, setModels] = useState<string[]>([DEFAULT_MODEL]);
  const [secret, setSecret] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");

  const [testing, setTesting] = useState<
    Record<number, { ok?: boolean; message: string; loading: boolean }>
  >({});

  // ── data loading (no /api/models fetch) ─────────────────────────────────
  const load = async () => {
    try {
      const data: ConnectionView[] = await fetch("/api/connections").then((r) => r.json());
      setConns(data.filter((x) => x.kind === "ai" && isNvidia(x.config)));
    } catch (e: any) {
      setErr(e.message || "Failed to load connections");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, []);

  const notify = () => {
    onChanged?.();
    window.dispatchEvent(new Event("settings-changed"));
    load();
  };

  // ── actions ──────────────────────────────────────────────────────────────
  const setActive = async (id: number) => {
    await fetch(`/api/connections/${id}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ active: true }),
    });
    notify();
  };

  const remove = async (id: number, connName: string) => {
    if (!confirm(`Remove NVIDIA connection "${connName}"?`)) return;
    await fetch(`/api/connections/${id}`, { method: "DELETE" });
    notify();
  };

  const test = async (id: number) => {
    setTesting((t) => ({ ...t, [id]: { message: "Testing…", loading: true } }));
    try {
      const res = await fetch(`/api/connections/${id}/test`, { method: "POST" });
      const data = await res.json();
      setTesting((t) => ({ ...t, [id]: { ok: data.ok, message: data.message, loading: false } }));
    } catch (e: any) {
      setTesting((t) => ({ ...t, [id]: { ok: false, message: e.message, loading: false } }));
    }
  };

  const submit = async () => {
    if (!secret.trim() && !editingId) { setErr("API key is required."); return; }
    if (models.length === 0) { setErr("Select at least one model."); return; }
    setBusy(true);
    setErr("");
    try {
      const body = {
        kind: "ai",
        name: name.trim() || "NVIDIA NIM",
        config: { provider: "openai", baseUrl: NVIDIA_BASE, models, model: models[0] },
        secret: secret.trim() || null,
      };
      const res = await fetch(
        editingId ? `/api/connections/${editingId}` : "/api/connections",
        {
          method: editingId ? "PATCH" : "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(body),
        }
      );
      if (!res.ok) { setErr("Could not save NVIDIA connection."); return; }
      closeForm();
      notify();
    } finally {
      setBusy(false);
    }
  };

  const toggleModel = (id: string) => {
    setModels((prev) =>
      prev.includes(id) ? prev.filter((m) => m !== id) : [...prev, id]
    );
  };

  const startEdit = (c: ConnectionView) => {
    setEditingId(c.id);
    setName(c.name);
    // support both old single-model config and new multi-model array
    const saved = c.config.models
      ? (Array.isArray(c.config.models) ? c.config.models : [c.config.models])
      : [String(c.config.model || DEFAULT_MODEL)];
    setModels(saved);
    setSecret("");
    setFormOpen(true);
  };

  const closeForm = () => {
    setFormOpen(false);
    setEditingId(null);
    setName("");
    setModels([DEFAULT_MODEL]);
    setSecret("");
    setErr("");
  };

  if (loading) return <div className="skeleton" style={{ height: 40 }} />;

  return (
    <section className="settings-section" id="nvidia-nim">
      <h2>NVIDIA NIM</h2>
      <div className="hint mb-2">
        NVIDIA NIM runs as its own connection. The selected model appears in the global model
        picker. Get an API key at{" "}
        <a href="https://build.nvidia.com/settings/api-keys" target="_blank" rel="noreferrer">
          build.nvidia.com ↗
        </a>
      </div>

      {err && <div className="banner-danger" style={{ marginBottom: 8 }}>{err}</div>}

      {/* ── connection list ─────────────────────────────────────────────── */}
      {conns.length === 0 && !formOpen ? (
        <div className="empty-state">
          <div className="glyph">🚀</div>
          No NVIDIA NIM connection yet.
          <button className="btn btn-primary" style={{ marginTop: 8 }} onClick={() => setFormOpen(true)}>
            + Add NVIDIA NIM
          </button>
        </div>
      ) : (
        conns.map((c) => {
          const t = testing[c.id];
          return (
            <div key={c.id} className={`conn-row${c.is_active ? " active" : ""}`}>
              {/* active toggle — pill button instead of radio */}
              <button
                className={c.is_active ? "btn btn-primary" : "btn"}
                onClick={() => !c.is_active && setActive(c.id)}
                style={{ padding: "3px 10px", fontSize: 11, minWidth: 56 }}
                title={c.is_active ? "Currently active" : "Set as active"}
              >
                {c.is_active ? "✓ active" : "set active"}
              </button>

              <div className="grow" style={{ minWidth: 0 }}>
                <div className="row" style={{ gap: 8 }}>
                  <strong style={{ fontSize: 13 }}>{c.name}</strong>
                  {!c.has_secret && <span className="badge badge-warn">no key</span>}
                </div>
                <div className="muted small mono" style={{ marginTop: 2 }}>
                  {/* support both models[] and legacy model string */}
                  {(Array.isArray(c.config.models) && c.config.models.length > 0
                    ? c.config.models
                    : [String(c.config.model || "")]
                  ).map((m) => modelLabel(m)).join(", ")} · {c.config.baseUrl}
                </div>
                {t && !t.loading && (
                  <div className="small" style={{ marginTop: 4, color: t.ok ? "var(--success)" : "var(--danger)" }}>
                    {t.ok ? "✓ " : "✕ "}{t.message}
                  </div>
                )}
              </div>

              <button
                className="btn"
                data-loading={t?.loading}
                onClick={() => test(c.id)}
                style={{ padding: "3px 10px", fontSize: 12 }}
              >
                {t?.loading ? "…" : "Test"}
              </button>
              <button className="btn" onClick={() => startEdit(c)} style={{ padding: "3px 10px", fontSize: 12 }}>
                Edit
              </button>
              <button
                className="btn btn-danger-ghost"
                onClick={() => remove(c.id, c.name)}
                style={{ padding: "3px 10px", fontSize: 12 }}
              >
                Remove
              </button>
            </div>
          );
        })
      )}

      {/* ── add / edit form ─────────────────────────────────────────────── */}
      <div className="conn-addform">
        {formOpen ? (
          <>
            <div className="field">
              <label>Name</label>
              <input
                className="input"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="NVIDIA NIM"
              />
            </div>

            {/* ── model multi-select (pill toggle group) ────────────────── */}
            <div className="field">
              <label style={{ display: "flex", alignItems: "center", gap: 8 }}>
                Model
                <span className="muted small" style={{ fontWeight: 400 }}>
                  ({models.length} selected)
                </span>
                <button
                  type="button"
                  className="btn"
                  style={{ padding: "1px 8px", fontSize: 11, marginLeft: "auto" }}
                  onClick={() => setModels(NVIDIA_MODELS.map((m) => m.id))}
                >
                  Select All
                </button>
                <button
                  type="button"
                  className="btn"
                  style={{ padding: "1px 8px", fontSize: 11 }}
                  onClick={() => setModels([])}
                >
                  Clear
                </button>
              </label>
              <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginTop: 6 }}>
                {NVIDIA_MODELS.map((m) => {
                  const active = models.includes(m.id);
                  return (
                    <button
                      key={m.id}
                      type="button"
                      onClick={() => toggleModel(m.id)}
                      style={{
                        padding: "5px 14px",
                        borderRadius: 20,
                        border: active ? "none" : "1px solid var(--border)",
                        background: active ? "var(--accent, #6366f1)" : "var(--bg-2, transparent)",
                        color: active ? "#fff" : "var(--text)",
                        cursor: "pointer",
                        fontSize: 12,
                        fontWeight: active ? 600 : 400,
                        transition: "background 0.15s, border 0.15s",
                        outline: "none",
                      }}
                    >
                      {active ? "✓ " : ""}{m.label}
                    </button>
                  );
                })}
              </div>
              {models.length > 0 && (
                <div className="muted small mono" style={{ marginTop: 6 }}>
                  {models.join(", ")}
                </div>
              )}
            </div>

            <div className="field">
              <label>API Key {editingId ? "(leave empty to keep current)" : ""}</label>
              <input
                className="input mono"
                type="password"
                value={secret}
                onChange={(e) => setSecret(e.target.value)}
                placeholder="nvapi-…"
              />
            </div>

            <div className="row" style={{ justifyContent: "flex-end", gap: 8 }}>
              <button className="btn" onClick={closeForm}>Cancel</button>
              <button
                className="btn btn-primary"
                data-loading={busy}
                onClick={submit}
                disabled={busy}
              >
                {editingId ? "Save changes" : "Add connection"}
              </button>
            </div>
          </>
        ) : (
          conns.length > 0 && (
            <button className="btn" style={{ marginTop: 4 }} onClick={() => setFormOpen(true)}>
              + Add another NVIDIA NIM
            </button>
          )
        )}
      </div>
    </section>
  );
}
