/**
 * Monitoring tools — Prometheus and Loki via their HTTP APIs.
 * Grafana is NOT here: it runs through the official mcp-grafana MCP server
 * (see lib/mcp.ts), wired in by the "monitoring" branch of assembleTools.
 * All tools here are read-only (queries only), so they never need approval gating.
 * Each provider reads its ACTIVE connection from the multi-connection registry.
 */
import { getActive, type ConnKind } from "./connections-db";
import { getConnectionSecret } from "./config";
import { monitoringAuthHeaders } from "./connections";
import type { AiTool } from "./ai";

const MAX_RESULT_CHARS = 40_000;

interface MonitoringTarget {
  base: string;
  headers: Record<string, string>;
}

function target(kind: ConnKind, label: string): MonitoringTarget {
  const conn = getActive(kind);
  if (!conn) throw new Error(`No active ${label} connection — add one on the Monitoring page.`);
  let cfg: Record<string, any> = {};
  try { cfg = JSON.parse(conn.config || "{}"); } catch { cfg = {}; }
  const url = String(cfg.url ?? "").replace(/\/+$/, "");
  if (!url) throw new Error(`The active ${label} connection has no URL configured.`);
  const secret = getConnectionSecret(conn.id);
  const username = String(cfg.username ?? "") || undefined;
  return { base: url, headers: { accept: "application/json", ...monitoringAuthHeaders(username, secret) } };
}

async function getJson(t: MonitoringTarget, pathname: string): Promise<any> {
  const res = await fetch(`${t.base}${pathname}`, {
    headers: t.headers,
    signal: AbortSignal.timeout(20_000),
  });
  if (res.status === 401 || res.status === 403) throw new Error("Authentication failed — check the stored credentials.");
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`HTTP ${res.status}: ${body.slice(0, 300)}`);
  }
  return res.json();
}

function clip(s: string): string {
  return s.length > MAX_RESULT_CHARS ? s.slice(0, MAX_RESULT_CHARS) + "\n…(truncated)" : s;
}

/** Accepts unix seconds, RFC3339, or relative like "now-1h"/"now". */
function toUnixSeconds(v: unknown, def: number): number {
  if (v === undefined || v === null || v === "") return def;
  if (typeof v === "number") return Math.floor(v);
  const s = String(v).trim();
  if (/^\d+(\.\d+)?$/.test(s)) return Math.floor(Number(s));
  const rel = /^now(?:-(\d+)([smhd]))?$/.exec(s);
  if (rel) {
    const now = Math.floor(Date.now() / 1000);
    if (!rel[1]) return now;
    const mult = { s: 1, m: 60, h: 3600, d: 86400 }[rel[2] as "s" | "m" | "h" | "d"];
    return now - Number(rel[1]) * mult;
  }
  const parsed = Date.parse(s);
  if (!Number.isNaN(parsed)) return Math.floor(parsed / 1000);
  return def;
}

/* -------------------------------------------------------------------------- */
/* Tool definitions                                                            */
/* -------------------------------------------------------------------------- */

export const monitoringToolDefs: AiTool[] = [
  {
    name: "prometheus_query",
    description: "Run an instant PromQL query against the active Prometheus connection.",
    input_schema: {
      type: "object",
      properties: {
        query: { type: "string", description: "PromQL expression, e.g. up or rate(http_requests_total[5m])" },
        time: { type: "string", description: "evaluation time: unix seconds, RFC3339, or now/now-1h (optional, default now)" },
      },
      required: ["query"],
    },
  },
  {
    name: "prometheus_query_range",
    description: "Run a PromQL range query (time series over a window) against the active Prometheus connection.",
    input_schema: {
      type: "object",
      properties: {
        query: { type: "string", description: "PromQL expression" },
        start: { type: "string", description: "start: unix seconds, RFC3339, or now-1h (default now-1h)" },
        end: { type: "string", description: "end: unix seconds, RFC3339, or now (default now)" },
        step: { type: "string", description: "resolution step, e.g. 30s, 5m (default 1m)" },
      },
      required: ["query"],
    },
  },
  {
    name: "prometheus_list_metrics",
    description: "List metric names known to the active Prometheus connection (optionally filtered by a substring).",
    input_schema: {
      type: "object",
      properties: {
        filter: { type: "string", description: "case-insensitive substring filter (optional)" },
      },
    },
  },
  {
    name: "loki_query",
    description: "Run a LogQL range query against the active Loki connection and return matching log lines.",
    input_schema: {
      type: "object",
      properties: {
        query: { type: "string", description: 'LogQL, e.g. {app="api"} |= "error"' },
        start: { type: "string", description: "start: unix seconds, RFC3339, or now-1h (default now-1h)" },
        end: { type: "string", description: "end: unix seconds, RFC3339, or now (default now)" },
        limit: { type: "number", description: "max log lines (default 100, max 1000)" },
      },
      required: ["query"],
    },
  },
  {
    name: "loki_list_labels",
    description: "List label names (and optionally the values of one label) from the active Loki connection.",
    input_schema: {
      type: "object",
      properties: {
        label: { type: "string", description: "if set, return the values of this label instead of label names" },
      },
    },
  },
];

/* -------------------------------------------------------------------------- */
/* Tool dispatcher                                                             */
/* -------------------------------------------------------------------------- */

export async function callMonitoringTool(name: string, args: any): Promise<string> {
  switch (name) {
    case "prometheus_query": {
      const t = target("prometheus", "Prometheus");
      const time = toUnixSeconds(args?.time, Math.floor(Date.now() / 1000));
      const d = await getJson(t, `/api/v1/query?query=${encodeURIComponent(String(args.query))}&time=${time}`);
      if (d.status !== "success") throw new Error(`Prometheus error: ${d.error ?? "unknown"}`);
      return clip(JSON.stringify(d.data, null, 2));
    }
    case "prometheus_query_range": {
      const t = target("prometheus", "Prometheus");
      const now = Math.floor(Date.now() / 1000);
      const start = toUnixSeconds(args?.start, now - 3600);
      const end = toUnixSeconds(args?.end, now);
      const step = String(args?.step ?? "1m");
      const d = await getJson(
        t,
        `/api/v1/query_range?query=${encodeURIComponent(String(args.query))}&start=${start}&end=${end}&step=${encodeURIComponent(step)}`
      );
      if (d.status !== "success") throw new Error(`Prometheus error: ${d.error ?? "unknown"}`);
      return clip(JSON.stringify(d.data, null, 2));
    }
    case "prometheus_list_metrics": {
      const t = target("prometheus", "Prometheus");
      const d = await getJson(t, `/api/v1/label/__name__/values`);
      if (d.status !== "success") throw new Error(`Prometheus error: ${d.error ?? "unknown"}`);
      let names: string[] = Array.isArray(d.data) ? d.data : [];
      const filter = String(args?.filter ?? "").toLowerCase();
      if (filter) names = names.filter((n) => n.toLowerCase().includes(filter));
      return clip(names.slice(0, 500).join("\n") || "No metrics found.");
    }
    case "loki_query": {
      const t = target("loki", "Loki");
      const now = Math.floor(Date.now() / 1000);
      const start = toUnixSeconds(args?.start, now - 3600);
      const end = toUnixSeconds(args?.end, now);
      const limit = Math.min(Math.max(Number(args?.limit) || 100, 1), 1000);
      const d = await getJson(
        t,
        `/loki/api/v1/query_range?query=${encodeURIComponent(String(args.query))}` +
          `&start=${start}000000000&end=${end}000000000&limit=${limit}&direction=backward`
      );
      if (d.status !== "success") throw new Error(`Loki error: ${d.error ?? "unknown"}`);
      const streams: any[] = d.data?.result ?? [];
      const lines: string[] = [];
      for (const s of streams) {
        const labels = JSON.stringify(s.stream ?? {});
        for (const [ts, line] of s.values ?? []) {
          lines.push(`${new Date(Number(ts) / 1e6).toISOString()} ${labels} ${line}`);
        }
      }
      lines.sort().reverse();
      return clip(lines.slice(0, limit).join("\n") || "No log lines matched.");
    }
    case "loki_list_labels": {
      const t = target("loki", "Loki");
      const label = String(args?.label ?? "").trim();
      const d = await getJson(t, label ? `/loki/api/v1/label/${encodeURIComponent(label)}/values` : `/loki/api/v1/labels`);
      if (d.status !== "success") throw new Error(`Loki error: ${d.error ?? "unknown"}`);
      return clip((d.data ?? []).join("\n") || "No labels found.");
    }
    default:
      throw new Error(`Unknown monitoring tool: ${name}`);
  }
}
