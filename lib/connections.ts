/** Connection tests for GitHub, GitLab, database, Redis & monitoring (Grafana/Prometheus/Loki). */
import type { AppConfig } from "./config";

type TestResult = { ok: boolean; message: string };

const CONNECT_TIMEOUT_MS = 10_000;

export async function testGithub(token: string) {
  try {
    const res = await fetch("https://api.github.com/user", {
      headers: {
        authorization: `Bearer ${token}`,
        accept: "application/vnd.github+json",
        "user-agent": "agent-platform-desktop",
      },
      signal: AbortSignal.timeout(15_000),
    });
    if (res.status === 401) return { ok: false as const, message: "The GitHub token is invalid or has been revoked." };
    if (!res.ok) return { ok: false as const, message: `GitHub rejected the request (${res.status}).` };
    const u: any = await res.json();
    return { ok: true as const, message: `Connected as ${u.login}` };
  } catch {
    return { ok: false as const, message: "Could not reach api.github.com — check your connection." };
  }
}

export async function testGitlab(token: string, apiUrl: string) {
  const base = apiUrl.replace(/\/+$/, "");
  try {
    const res = await fetch(`${base}/user`, {
      headers: { "PRIVATE-TOKEN": token },
      signal: AbortSignal.timeout(15_000),
    });
    if (res.status === 401) return { ok: false as const, message: "The GitLab token is invalid or has been revoked." };
    if (res.status === 404) return { ok: false as const, message: `Unknown endpoint ${base} — check the API URL (must end with /api/v4).` };
    if (!res.ok) return { ok: false as const, message: `GitLab rejected the request (${res.status}).` };
    const u: any = await res.json();
    const host = new URL(base).host;
    return { ok: true as const, message: `Connected as ${u.username} (${host})` };
  } catch {
    return { ok: false as const, message: `Could not reach ${base} — check the connection or URL.` };
  }
}

function connectError(host: string, port: number, error: unknown): string {
  const e = error as NodeJS.ErrnoException;
  if (e?.code === "ECONNREFUSED") return `Connection to ${host}:${port} was refused — make sure the server is running.`;
  if (e?.code === "ENOTFOUND") return `Host ${host} was not found — check the hostname.`;
  if (e?.code === "ETIMEDOUT" || /timeout/i.test(e?.message ?? ""))
    return `Timed out connecting to ${host}:${port}.`;
  return `Could not reach ${host}:${port} — ${e?.message ?? "check the connection"}.`;
}

/** Database test: connect + a light query, genuinely validates credentials. */
export async function testDatabase(cfg: AppConfig["database"], password: string | null): Promise<TestResult> {
  if (cfg.type === "postgres") {
    const { Client } = await import("pg");
    const client = new Client({
      host: cfg.host,
      port: cfg.port,
      user: cfg.user,
      password: password ?? undefined,
      database: cfg.database,
      ssl: cfg.ssl ? { rejectUnauthorized: false } : undefined,
      connectionTimeoutMillis: CONNECT_TIMEOUT_MS,
    });
    try {
      await client.connect();
      const r = await client.query("SELECT current_database() db, version() v");
      const row = r.rows[0] as { db: string; v: string };
      return { ok: true, message: `Connected to ${row.v.split(" on ")[0]} — database "${row.db}".` };
    } catch (error: unknown) {
      const code = (error as { code?: string })?.code;
      if (code === "28P01" || code === "28000")
        return { ok: false, message: `Wrong PostgreSQL user/password for "${cfg.user}".` };
      if (code === "3D000")
        return { ok: false, message: `Database "${cfg.database}" does not exist on the server.` };
      return { ok: false, message: connectError(cfg.host, cfg.port, error) };
    } finally {
      await client.end().catch(() => {});
    }
  }

  const mysql = await import("mysql2/promise");
  try {
    const conn = await mysql.createConnection({
      host: cfg.host,
      port: cfg.port,
      user: cfg.user,
      password: password ?? undefined,
      database: cfg.database,
      ssl: cfg.ssl ? { rejectUnauthorized: false } : undefined,
      connectTimeout: CONNECT_TIMEOUT_MS,
    });
    try {
      const [rows] = await conn.query("SELECT DATABASE() db, VERSION() v");
      const row = (rows as { db: string; v: string }[])[0];
      return { ok: true, message: `Connected to MySQL ${row.v} — database "${row.db}".` };
    } finally {
      await conn.end().catch(() => {});
    }
  } catch (error: unknown) {
    const code = (error as { code?: string })?.code;
    if (code === "ER_ACCESS_DENIED_ERROR")
      return { ok: false, message: `Wrong MySQL user/password for "${cfg.user}".` };
    if (code === "ER_BAD_DB_ERROR")
      return { ok: false, message: `Database "${cfg.database}" does not exist on the server.` };
    return { ok: false, message: connectError(cfg.host, cfg.port, error) };
  }
}

/* -------------------------------------------------------------------------- */
/* Monitoring: Grafana / Prometheus / Loki                                     */
/* -------------------------------------------------------------------------- */

/** Basic auth when a username is set, otherwise Bearer when a secret is set. */
export function monitoringAuthHeaders(username: string | undefined, secret: string | null): Record<string, string> {
  if (username && secret) {
    return { authorization: `Basic ${Buffer.from(`${username}:${secret}`).toString("base64")}` };
  }
  if (secret) return { authorization: `Bearer ${secret}` };
  return {};
}

function stripSlash(url: string): string {
  return url.replace(/\/+$/, "");
}

/** Grafana test: GET /api/org with the API key / service-account token. */
export async function testGrafana(url: string, secret: string | null): Promise<TestResult> {
  const base = stripSlash(url);
  try {
    const res = await fetch(`${base}/api/org`, {
      headers: { accept: "application/json", ...monitoringAuthHeaders(undefined, secret) },
      signal: AbortSignal.timeout(CONNECT_TIMEOUT_MS),
    });
    if (res.status === 401 || res.status === 403)
      return { ok: false, message: "The Grafana API token is invalid or lacks permissions." };
    if (!res.ok) return { ok: false, message: `Grafana rejected the request (${res.status}).` };
    const org: any = await res.json();
    return { ok: true, message: `Connected to Grafana — org "${org.name ?? org.id}".` };
  } catch {
    return { ok: false, message: `Could not reach ${base} — check the URL and your connection.` };
  }
}

/** Prometheus test: run a trivial instant query. */
export async function testPrometheus(url: string, username: string | undefined, secret: string | null): Promise<TestResult> {
  const base = stripSlash(url);
  try {
    const res = await fetch(`${base}/api/v1/query?query=${encodeURIComponent("vector(1)")}`, {
      headers: { accept: "application/json", ...monitoringAuthHeaders(username, secret) },
      signal: AbortSignal.timeout(CONNECT_TIMEOUT_MS),
    });
    if (res.status === 401 || res.status === 403)
      return { ok: false, message: "Prometheus rejected the credentials." };
    if (!res.ok) return { ok: false, message: `Prometheus rejected the request (${res.status}).` };
    const d: any = await res.json();
    if (d.status !== "success") return { ok: false, message: `Prometheus responded but the query failed (${d.error ?? "unknown"}).` };
    return { ok: true, message: `Connected to Prometheus at ${base}.` };
  } catch {
    return { ok: false, message: `Could not reach ${base} — check the URL and your connection.` };
  }
}

/** Loki test: list labels. */
export async function testLoki(url: string, username: string | undefined, secret: string | null): Promise<TestResult> {
  const base = stripSlash(url);
  try {
    const res = await fetch(`${base}/loki/api/v1/labels`, {
      headers: { accept: "application/json", ...monitoringAuthHeaders(username, secret) },
      signal: AbortSignal.timeout(CONNECT_TIMEOUT_MS),
    });
    if (res.status === 401 || res.status === 403)
      return { ok: false, message: "Loki rejected the credentials." };
    if (!res.ok) return { ok: false, message: `Loki rejected the request (${res.status}).` };
    const d: any = await res.json();
    const n = Array.isArray(d.data) ? d.data.length : 0;
    return { ok: true, message: `Connected to Loki at ${base} (${n} label${n === 1 ? "" : "s"}).` };
  } catch {
    return { ok: false, message: `Could not reach ${base} — check the URL and your connection.` };
  }
}

/** Redis test: connect + PING via ioredis. */
export async function testRedis(cfg: AppConfig["redis"], password: string | null): Promise<TestResult> {
  const { default: Redis } = await import("ioredis");
  const redis = new Redis({
    host: cfg.host,
    port: cfg.port,
    username: cfg.username || undefined,
    password: password ?? undefined,
    db: cfg.db,
    tls: cfg.tls ? {} : undefined,
    connectTimeout: CONNECT_TIMEOUT_MS,
    lazyConnect: true,
    maxRetriesPerRequest: 0,
    retryStrategy: () => null,
  });
  try {
    await redis.connect();
    await redis.ping();
    return { ok: true, message: `Connected to Redis ${cfg.host}:${cfg.port} (db ${cfg.db}).` };
  } catch (error: unknown) {
    const msg = (error as Error)?.message ?? "";
    if (/NOAUTH/i.test(msg)) return { ok: false, message: "Redis requires a password — set one first." };
    if (/WRONGPASS|invalid username-password/i.test(msg))
      return { ok: false, message: "Wrong Redis password (or ACL username)." };
    return { ok: false, message: connectError(cfg.host, cfg.port, error) };
  } finally {
    redis.disconnect();
  }
}
