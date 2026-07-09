"use client";
import { useCallback, useEffect, useState } from "react";
import Link from "next/link";

type ToolState = "connected" | "unconfigured" | "error" | "connecting";
type ToolStatus = { status: ToolState; detail: string };
type StatusResponse = { tools: Record<string, ToolStatus>; ai: "configured" | "unconfigured" };

const TOOL_META: Record<string, { label: string; icon: string; blurb: string }> = {
  filesystem: { label: "Filesystem", icon: "📁", blurb: "Read/write files in allowed folders" },
  github: { label: "GitHub", icon: "🐙", blurb: "Repos, issues & PRs via REST API" },
  tavily: { label: "Tavily", icon: "🔎", blurb: "Web search, extract, crawl & map (REST API)" },
  tavily_mcp: { label: "Tavily MCP", icon: "🌐", blurb: "Hosted remote MCP (mcp.tavily.com)" },
  gitlab: { label: "GitLab", icon: "🦊", blurb: "Repos & issues via GitLab MCP" },
  database: { label: "Database", icon: "🗄", blurb: "SQL queries (Postgres / MySQL)" },
  redis: { label: "Redis", icon: "🧱", blurb: "Key/value cache access" },
  env: { label: "Env", icon: "🔑", blurb: "Reads .env from the working folder" },
  monitoring: { label: "Monitoring", icon: "📈", blurb: "Grafana / Prometheus / Loki" },
  vision: { label: "Vision (read_image)", icon: "👁", blurb: "Agents read attached images via a vision model" },
};

const DOT: Record<ToolState, string> = {
  connected: "dot-green",
  error: "dot-red",
  connecting: "dot-gray",
  unconfigured: "dot-gray",
};

const STATE_LABEL: Record<ToolState, string> = {
  connected: "Connected",
  error: "Error",
  connecting: "Connecting…",
  unconfigured: "Not configured",
};

export default function ToolsPage() {
  const [data, setData] = useState<StatusResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setErr(null);
    try {
      const res = await fetch("/api/tools/status", { cache: "no-store" });
      if (!res.ok) throw new Error(await res.text());
      setData(await res.json());
    } catch (e: unknown) {
      setErr(e instanceof Error ? e.message : "Failed to load tool status");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const entries = data ? Object.entries(data.tools) : [];

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%", gap: 12 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
        <h1 style={{ margin: 0 }}>Tools</h1>
        <span className="muted small">Connection status for every tool agents can use.</span>
        <span style={{ flex: 1 }} />
        <button className="btn" onClick={load} disabled={loading}>
          {loading ? "Refreshing…" : "↻ Refresh"}
        </button>
        <Link href="/settings" className="btn btn-primary">Configure in Settings</Link>
      </div>

      {err && (
        <div className="card" style={{ borderColor: "var(--danger)", color: "var(--danger)" }}>
          {err}
        </div>
      )}

      {loading && !data ? (
        <div className="muted" style={{ padding: 32, textAlign: "center" }}>Loading tool status…</div>
      ) : (
        <div className="card-grid">
          {entries.map(([key, st]) => {
            const meta = TOOL_META[key] ?? { label: key, icon: "🔧", blurb: "" };
            return (
              <div key={key} className="card" style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  <span style={{ fontSize: 18 }}>{meta.icon}</span>
                  <strong>{meta.label}</strong>
                  <span style={{ flex: 1 }} />
                  <span style={{
                    display: "inline-flex", alignItems: "center", gap: 6, fontSize: 12,
                    padding: "2px 8px", borderRadius: 999,
                    border: "1px solid var(--border)", color: "var(--text-secondary)",
                  }}>
                    <span className={`dot ${DOT[st.status]}`} />
                    {STATE_LABEL[st.status]}
                  </span>
                </div>
                {meta.blurb && <div className="muted small">{meta.blurb}</div>}
                <div className="small" style={{ color: "var(--text-tertiary)", wordBreak: "break-word" }}>
                  {st.detail}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
