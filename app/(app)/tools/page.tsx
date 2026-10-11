"use client";
import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import Icon, { type IconName } from "@/components/Icon";
import PageHeader from "@/components/PageHeader";

type ToolState = "connected" | "unconfigured" | "error" | "connecting";
type ToolStatus = { status: ToolState; detail: string };
type StatusResponse = { tools: Record<string, ToolStatus>; ai: "configured" | "unconfigured" };

const TOOL_META: Record<string, { label: string; icon: IconName; blurb: string }> = {
  filesystem: { label: "Filesystem", icon: "folder", blurb: "Read/write files in allowed folders" },
  github: { label: "GitHub", icon: "github", blurb: "Repos, issues & PRs via REST API" },
  tavily: { label: "Tavily", icon: "search", blurb: "Web search, extract, crawl & map (REST API)" },
  tavily_mcp: { label: "Tavily MCP", icon: "globe", blurb: "Hosted remote MCP (mcp.tavily.com)" },
  gitlab: { label: "GitLab", icon: "gitlab", blurb: "Repos & issues via GitLab MCP" },
  database: { label: "Database", icon: "database", blurb: "SQL queries (Postgres / MySQL)" },
  redis: { label: "Redis", icon: "layers", blurb: "Key/value cache access" },
  env: { label: "Env", icon: "key", blurb: "Reads .env from the working folder" },
  monitoring: { label: "Monitoring", icon: "monitoring", blurb: "Grafana / Prometheus / Loki" },
  vision: { label: "Vision (read_image)", icon: "eye", blurb: "Agents read attached images via a vision model" },
  video: { label: "Video editing", icon: "video", blurb: "ffmpeg: trim, concat, transcode, subtitles & AI transcription" },
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
    <div>
      <PageHeader
        title="Tools"
        subtitle="Connection status for every tool agents can use."
        actions={
          <>
            <button className="btn" onClick={load} disabled={loading}>
              <Icon name="refresh" size={14} className={loading ? "spin" : undefined} /> {loading ? "Refreshing…" : "Refresh"}
            </button>
            <Link href="/connections" className="btn btn-primary">Configure connections</Link>
          </>
        }
      />

      {err && <div className="banner-danger">{err}</div>}

      {loading && !data ? (
        <div className="card-grid">
          {[0, 1, 2, 3, 4, 5].map((i) => (
            <div key={i} className="card"><div className="skeleton mb-2" style={{ width: "40%" }} /><div className="skeleton" /></div>
          ))}
        </div>
      ) : (
        <div className="card-grid">
          {entries.map(([key, st]) => {
            const meta = TOOL_META[key] ?? { label: key, icon: "tools" as const, blurb: "" };
            return (
              <div key={key} className="card tool-card">
                <div className="tool-card-head">
                  <span className="item-row-icon"><Icon name={meta.icon} size={16} /></span>
                  <strong>{meta.label}</strong>
                  <span className={`status-pill status-pill--${st.status}`}>
                    <span className={`dot ${DOT[st.status]}`} />
                    {STATE_LABEL[st.status]}
                  </span>
                </div>
                {meta.blurb && <div className="muted small">{meta.blurb}</div>}
                {st.detail && <div className="tool-card-detail">{st.detail}</div>}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
