/**
 * MCP manager — spawns MCP servers via the INTERNAL Node runtime (no
 * external npx/npm, PLAN Phase A). In Electron: process.execPath +
 * ELECTRON_RUN_AS_NODE=1. In dev: plain node.
 *
 * - filesystem : @modelcontextprotocol/server-filesystem (bundled)
 * - gitlab     : @modelcontextprotocol/server-gitlab (bundled)
 * - grafana    : official mcp-grafana Go binary (installed by the user,
 *                found on PATH or via the connection's "bin" field) —
 *                GRAFANA_URL / GRAFANA_SERVICE_ACCOUNT_TOKEN come from the
 *                ACTIVE grafana connection.
 * - github     : temporarily via built-in REST API (see lib/tools-github.ts)
 *                — a native Go binary lands in Phase C (PLAN), so Docker
 *                is never required.
 */
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { getConfig, getSecret, hasSecret, getConnectionSecret, configEvents } from "./config";
import { getBridge } from "./paths";
import { logger } from "./logger";

// Tavily's hosted remote MCP server. The API key is passed as a query param
// (see https://docs.tavily.com/documentation/mcp#remote-mcp-server).
export const TAVILY_MCP_URL = "https://mcp.tavily.com/mcp/";

export type McpServerName = "filesystem" | "gitlab" | "grafana" | "tavily";
export type ToolStatus = {
  status: "connected" | "unconfigured" | "error" | "connecting";
  detail: string;
};

type Managed = {
  client: Client | null;
  status: ToolStatus;
  tools: { name: string; description?: string; inputSchema: any }[];
};

const state: Record<McpServerName, Managed> = (globalThis as any).__mcpState ?? {
  filesystem: { client: null, status: { status: "unconfigured", detail: "No allowed folders yet" }, tools: [] },
  gitlab: { client: null, status: { status: "unconfigured", detail: "No token yet" }, tools: [] },
  grafana: { client: null, status: { status: "unconfigured", detail: "No Grafana connection yet" }, tools: [] },
  tavily: { client: null, status: { status: "unconfigured", detail: "No API key yet" }, tools: [] },
};
(globalThis as any).__mcpState = state;
// Hot-reload guard: an older cached state object may predate newer entries.
state.grafana ??= { client: null, status: { status: "unconfigured", detail: "No Grafana connection yet" }, tools: [] };
state.tavily ??= { client: null, status: { status: "unconfigured", detail: "No API key yet" }, tools: [] };

function nodeCommand(): { command: string; env: Record<string, string> } {
  const bridge = getBridge();
  if (bridge?.nodePath) {
    return { command: bridge.nodePath, env: { ELECTRON_RUN_AS_NODE: "1" } };
  }
  return { command: process.execPath, env: {} };
}

function resolveServerEntry(pkg: string): string {
  // MCP server packages usually only have "bin" (no "main"/"exports"),
  // so require.resolve fails — locate package.json directly in candidate
  // node_modules and take its bin/main entry.
  // eslint-disable-next-line no-eval
  const nodeRequire = eval("require") as NodeRequire;
  const fs = nodeRequire("fs") as typeof import("fs");
  const path = nodeRequire("path") as typeof import("path");

  // Walk UP from both the compiled module location and the process cwd,
  // collecting every `node_modules/<pkg>` ancestor. In the packaged app the
  // server code is bundled under `.next/standalone/.next/server/**` while the
  // MCP packages are copied (by scripts/copy-mcp.js) to
  // `.next/standalone/node_modules` — an ancestor dir the old fixed paths
  // (`__dirname/../..`) never reached, which is why it failed once built.
  const candidates = new Set<string>();
  for (const start of [__dirname, process.cwd()]) {
    let dir = start;
    // eslint-disable-next-line no-constant-condition
    while (true) {
      candidates.add(path.join(dir, "node_modules", pkg));
      const parent = path.dirname(dir);
      if (parent === dir) break;
      dir = parent;
    }
  }
  for (const dir of candidates) {
    const pj = path.join(dir, "package.json");
    if (!fs.existsSync(pj)) continue;
    const meta = JSON.parse(fs.readFileSync(pj, "utf8"));
    let entry: string | undefined = meta.main;
    if (!entry && meta.bin) {
      entry = typeof meta.bin === "string" ? meta.bin : (Object.values(meta.bin)[0] as string);
    }
    if (!entry) continue;
    const full = path.join(dir, entry);
    if (fs.existsSync(full)) return full;
  }
  throw new Error(`MCP package '${pkg}' was not found in the app bundle.`);
}

async function startServer(name: McpServerName): Promise<void> {
  await stopServer(name);
  const cfg = getConfig();
  const m = state[name];

  let command = "";
  let args: string[] = [];
  let baseEnv: Record<string, string> = {};
  let extraEnv: Record<string, string> = {};
  let detailSuffix = "";
  let remoteUrl: string | null = null;
  /** Auth headers for a remote (Streamable HTTP) server. */
  let remoteHeaders: Record<string, string> | null = null;

  if (name === "filesystem") {
    if (cfg.filesystem.allowedDirs.length === 0) {
      m.status = { status: "unconfigured", detail: "No allowed folders yet" };
      return;
    }
    const node = nodeCommand();
    command = node.command;
    baseEnv = node.env;
    args = [resolveServerEntry("@modelcontextprotocol/server-filesystem"), ...cfg.filesystem.allowedDirs];
  } else if (name === "gitlab") {
    const token = getSecret("gitlabToken");
    if (!token) {
      m.status = { status: "unconfigured", detail: "No token yet" };
      return;
    }
    const node = nodeCommand();
    command = node.command;
    baseEnv = node.env;
    args = [resolveServerEntry("@modelcontextprotocol/server-gitlab")];
    extraEnv = {
      GITLAB_PERSONAL_ACCESS_TOKEN: token,
      GITLAB_API_URL: cfg.gitlab.apiUrl,
    };
    try {
      detailSuffix = ` (${new URL(cfg.gitlab.apiUrl).host})`;
    } catch { /* keep empty */ }
  } else if (name === "tavily") {
    // The API key used to travel as a `?tavilyApiKey=` query param, which lands
    // in access logs and any intermediary along the way. mcp.tavily.com accepts
    // `Authorization: Bearer <key>` (verified: header → 200, no auth → 401), so
    // send it as a header instead.
    const key = getSecret("tavilyApiKey");
    if (!key) {
      m.status = { status: "unconfigured", detail: "No API key yet" };
      return;
    }
    remoteUrl = TAVILY_MCP_URL;
    remoteHeaders = { Authorization: `Bearer ${key}` };
    detailSuffix = " (mcp.tavily.com)";
  } else {
    // grafana — official mcp-grafana Go binary, config from the ACTIVE grafana connection
    const { getActive } = await import("./connections-db");
    const conn = getActive("grafana");
    const token = conn ? getConnectionSecret(conn.id) : null;
    if (!conn || !token) {
      m.status = { status: "unconfigured", detail: "No Grafana connection yet — add one on the Monitoring page" };
      return;
    }
    let gcfg: Record<string, any> = {};
    try { gcfg = JSON.parse(conn.config || "{}"); } catch { gcfg = {}; }
    const url = String(gcfg.url ?? "").replace(/\/+$/, "");
    if (!url) {
      m.status = { status: "unconfigured", detail: "The active Grafana connection has no URL" };
      return;
    }
    // Binary on PATH by default; the connection's "bin" field can point to a full path
    // (useful in the packaged app, where PATH may not include ~/go/bin).
    command = String(gcfg.bin ?? "").trim() || "mcp-grafana";
    extraEnv = {
      GRAFANA_URL: url,
      GRAFANA_SERVICE_ACCOUNT_TOKEN: token,
    };
    try {
      detailSuffix = ` (${new URL(url).host})`;
    } catch { /* keep empty */ }
  }

  m.status = { status: "connecting", detail: "Connecting…" };
  // The child's stderr is the ONLY place a spawn/require failure surfaces
  // (a crashed server just closes the stdio pipe, so `connect` throws a generic
  // "connection closed"). Capture it so the real cause is not lost.
  let stderrTail = "";
  try {
    let stdioTransport: StdioClientTransport | null = null;
    const transport = remoteUrl
      ? new StreamableHTTPClientTransport(new URL(remoteUrl), {
          // Auth for remote servers travels in headers, never in the URL.
          ...(remoteHeaders ? { requestInit: { headers: remoteHeaders } } : {}),
        })
      : (stdioTransport = new StdioClientTransport({
          command,
          args,
          env: { ...process.env as any, ...baseEnv, ...extraEnv },
          stderr: "pipe",
        }));
    // `stderr` is only readable AFTER the transport starts (client.connect),
    // so attach the listener right after; SDK buffers the pipe until then.
    const client = new Client({ name: "agent-platform", version: "0.1.0" });
    await client.connect(transport);
    stdioTransport?.stderr?.on("data", (d: Buffer) => {
      stderrTail = (stderrTail + d.toString()).slice(-800);
    });
    const res = await client.listTools();
    m.client = client;
    m.tools = res.tools.map((t) => ({ name: t.name, description: t.description, inputSchema: t.inputSchema }));
    m.status = { status: "connected", detail: `connected${detailSuffix} — ${m.tools.length} tools` };
    logger.info(`MCP ${name}: connected — ${m.tools.length} tools`);
  } catch (e: any) {
    m.client = null;
    m.tools = [];
    const msg = String(e?.message ?? e);
    const hint =
      name === "grafana" && /ENOENT|not found/i.test(msg)
        ? " — install it (go install github.com/grafana/mcp-grafana/cmd/mcp-grafana@latest) or set the binary path on the connection"
        : "";
    const stderrNote = stderrTail.trim() ? ` | server stderr: ${stderrTail.trim().slice(-300)}` : "";
    m.status = { status: "error", detail: `server failed to start: ${msg.slice(0, 160)}${hint}` };
    // 🔴 Was fully swallowed before — a filesystem/gitlab failure left no trace
    // in the log, so "Tool X is unavailable" had no diagnosable cause.
    logger.error(`MCP ${name} failed to start: ${msg}${stderrNote} | command=${command} args=${JSON.stringify(args)}`);
  }
}

async function stopServer(name: McpServerName) {
  const m = state[name];
  if (m.client) {
    try { await m.client.close(); } catch { /* ignore */ }
    m.client = null;
    m.tools = [];
  }
}

export async function ensureServer(name: McpServerName): Promise<Managed> {
  const m = state[name];
  if (m.client) return m;
  await startServer(name);
  return m;
}

export async function getToolStatuses(): Promise<Record<string, ToolStatus>> {
  const cfg = getConfig();
  // lightweight health check: start configured servers that are not running yet
  for (const name of ["filesystem", "gitlab"] as McpServerName[]) {
    const configured = name === "filesystem"
      ? cfg.filesystem.allowedDirs.length > 0
      : hasSecret("gitlabToken");
    if (configured && !state[name].client) await startServer(name);
    if (!configured) {
      await stopServer(name);
      state[name].status = {
        status: "unconfigured",
        detail: name === "filesystem" ? "No allowed folders yet" : "No token yet",
      };
    }
  }
  const github: ToolStatus = hasSecret("githubToken")
    ? { status: "connected", detail: "connected (REST API — native MCP binary lands in Phase C)" }
    : { status: "unconfigured", detail: "No token yet" };

  const tavily: ToolStatus = hasSecret("tavilyApiKey")
    ? { status: "connected", detail: "connected (REST API — web search, extract, crawl & map)" }
    : { status: "unconfigured", detail: "No API key yet" };

  // Tavily hosted remote MCP (Streamable HTTP) — started on demand when the key is set.
  if (hasSecret("tavilyApiKey")) {
    if (!state.tavily.client) await startServer("tavily");
  } else {
    await stopServer("tavily");
    state.tavily.status = { status: "unconfigured", detail: "No API key yet" };
  }
  const tavilyMcp: ToolStatus = state.tavily.status;

  const database: ToolStatus = {
    status: "connected",
    detail: `${cfg.database.type} ${cfg.database.host}:${cfg.database.port}/${cfg.database.database} — verify via Test in Settings`,
  };
  const redis: ToolStatus = {
    status: "connected",
    detail: `${cfg.redis.host}:${cfg.redis.port} db ${cfg.redis.db} — verify via Test in Settings`,
  };
  const env: ToolStatus = {
    status: "connected",
    detail: "reads .env from the allowed working folder — every read needs approval",
  };

  // Monitoring: grafana runs through the mcp-grafana server; prometheus/loki are direct REST.
  let monitoring: ToolStatus;
  try {
    const { getActive } = await import("./connections-db");
    const hasGrafana = !!getActive("grafana");
    if (hasGrafana && !state.grafana.client) await startServer("grafana");
    if (!hasGrafana) {
      await stopServer("grafana");
      state.grafana.status = { status: "unconfigured", detail: "No Grafana connection yet" };
    }
    const direct = (["prometheus", "loki"] as const).filter((k) => getActive(k));
    const parts: string[] = [];
    if (hasGrafana) parts.push(`grafana: ${state.grafana.status.detail}`);
    if (direct.length) parts.push(`${direct.join(", ")}: direct API`);
    const anyConnected = (hasGrafana && state.grafana.status.status === "connected") || direct.length > 0;
    monitoring = parts.length
      ? { status: anyConnected ? "connected" : state.grafana.status.status, detail: parts.join(" · ") }
      : { status: "unconfigured", detail: "No Grafana/Prometheus/Loki connection yet" };
  } catch {
    monitoring = { status: "unconfigured", detail: "No Grafana/Prometheus/Loki connection yet" };
  }

  // Vision (read_image): forwards attached images to the configured vision model.
  const visionModel = cfg.ai.visionModel?.trim();
  const vision: ToolStatus = visionModel
    ? { status: "connected", detail: `via ${visionModel}` }
    : { status: "connected", detail: "via the active default model — set a dedicated vision model in Connections" };

  // Video editing: local ffmpeg (not bundled — detected on PATH/common dirs).
  let video: ToolStatus;
  try {
    const { ffmpegAvailable } = await import("./tools-video");
    video = ffmpegAvailable()
      ? { status: "connected", detail: "ffmpeg found — trim, concat, transcode, subtitles, transcribe" }
      : { status: "unconfigured", detail: "ffmpeg not installed (macOS: brew install ffmpeg)" };
  } catch {
    video = { status: "unconfigured", detail: "ffmpeg not installed (macOS: brew install ffmpeg)" };
  }

  return {
    filesystem: state.filesystem.status,
    gitlab: state.gitlab.status,
    github,
    tavily,
    tavily_mcp: tavilyMcp,
    database,
    redis,
    env,
    monitoring,
    vision,
    video,
  };
}

export async function listMcpTools(name: McpServerName) {
  const m = await ensureServer(name);
  return m.tools;
}

/** Current status of one MCP server (for user-facing "why unavailable" notices). */
export function getMcpStatus(name: McpServerName): ToolStatus {
  return state[name].status;
}

export async function callMcpTool(name: McpServerName, tool: string, args: any) {
  const m = await ensureServer(name);
  if (!m.client) throw new Error(`Tool ${name} is unavailable: ${m.status.detail}`);
  const res = await m.client.callTool({ name: tool, arguments: args });
  const content = Array.isArray(res.content)
    ? res.content.map((c: any) => (c.type === "text" ? c.text : JSON.stringify(c))).join("\n")
    : JSON.stringify(res.content);
  if (res.isError) throw new Error(content.slice(0, 500));
  return content;
}

/* Reload MCP when config changes (PLAN B.1 — reload mechanism). */
if (!(globalThis as any).__mcpReloadHooked) {
  (globalThis as any).__mcpReloadHooked = true;
  configEvents.on("config-changed", () => { void stopServer("filesystem"); void stopServer("gitlab"); });
  configEvents.on("secret-changed", (name: string) => {
    if (name === "gitlabToken") void stopServer("gitlab");
  });
  // Monitoring kinds have no legacy config slot, so connection switches emit their own event.
  configEvents.on("connection-changed", (kind: string) => {
    if (kind === "grafana") void stopServer("grafana");
  });
}
