/**
 * Multi-connection registry for GitHub, GitLab, Database and Redis.
 *
 * The user can save many connections per kind and mark ONE active per kind.
 * Setting a connection active mirrors its non-secret fields into the legacy
 * `config.json` slot and its token/password into the legacy named secret
 * (githubToken / gitlabToken / dbPassword / redisPassword). That way every
 * existing tool (db-clients, tools-github, the MCP gitlab spawn) keeps reading
 * a single active value and needs no changes.
 */
import { getDb } from "./db";
import {
  getConfig,
  updateConfig,
  setSecret,
  getSecret,
  deleteSecret,
  hasSecret,
  setConnectionSecret,
  getConnectionSecret,
  deleteConnectionSecret,
  hasConnectionSecret,
  configEvents,
} from "./config";

export type ConnKind =
  | "github"
  | "gitlab"
  | "database"
  | "redis"
  | "grafana"
  | "prometheus"
  | "loki"
  | "tavily";
export const CONN_KINDS: ConnKind[] = [
  "github",
  "gitlab",
  "database",
  "redis",
  "grafana",
  "prometheus",
  "loki",
  "tavily",
];

/** Monitoring kinds have no legacy config.json slot — tools read the active connection directly. */
export const MONITORING_KINDS: ConnKind[] = ["grafana", "prometheus", "loki"];

export interface Connection {
  id: number;
  kind: ConnKind;
  name: string;
  config: string; // JSON string
  is_active: number;
  created_at: string;
}

/** Connection with parsed config + whether a secret is stored (never the value). */
export interface ConnectionView {
  id: number;
  kind: ConnKind;
  name: string;
  config: Record<string, unknown>;
  is_active: boolean;
  has_secret: boolean;
}

const DEFAULT_GITLAB_API = "https://gitlab.com/api/v4";

/* -------------------------------------------------------------------------- */
/* Basic queries                                                               */
/* -------------------------------------------------------------------------- */

function row(id: number): Connection | null {
  return (getDb().prepare("SELECT * FROM connections WHERE id=?").get(id) as Connection) ?? null;
}

export function listConnections(): Connection[] {
  ensureMigrated();
  return getDb().prepare("SELECT * FROM connections ORDER BY kind, id").all() as Connection[];
}

export function listByKind(kind: ConnKind): Connection[] {
  return getDb()
    .prepare("SELECT * FROM connections WHERE kind=? ORDER BY id DESC")
    .all(kind) as Connection[];
}

export function toView(c: Connection): ConnectionView {
  let config: Record<string, unknown> = {};
  try {
    config = JSON.parse(c.config || "{}");
  } catch {
    config = {};
  }
  return {
    id: c.id,
    kind: c.kind,
    name: c.name,
    config,
    is_active: !!c.is_active,
    has_secret: hasConnectionSecret(c.id),
  };
}

/* -------------------------------------------------------------------------- */
/* Mutations                                                                   */
/* -------------------------------------------------------------------------- */

export function createConnection(input: {
  kind: ConnKind;
  name: string;
  config: Record<string, unknown>;
  secret?: string | null;
}): number {
  ensureMigrated(); // import any legacy single-connection setup first
  const r = getDb()
    .prepare("INSERT INTO connections(kind,name,config,is_active) VALUES(?,?,?,0)")
    .run(input.kind, input.name.trim() || input.kind, JSON.stringify(input.config ?? {}));
  const id = Number(r.lastInsertRowid);
  if (input.secret) setConnectionSecret(id, input.secret);

  // First connection of its kind becomes active automatically.
  const activeExists = getDb()
    .prepare("SELECT 1 FROM connections WHERE kind=? AND is_active=1 LIMIT 1")
    .get(input.kind);
  if (!activeExists) setActive(input.kind, id);
  return id;
}

export function updateConnection(
  id: number,
  patch: { name?: string; config?: Record<string, unknown>; secret?: string | null }
): void {
  const c = row(id);
  if (!c) return;
  if (patch.name !== undefined) {
    getDb().prepare("UPDATE connections SET name=? WHERE id=?").run(patch.name.trim() || c.kind, id);
  }
  if (patch.config !== undefined) {
    getDb().prepare("UPDATE connections SET config=? WHERE id=?").run(JSON.stringify(patch.config), id);
  }
  if (patch.secret) setConnectionSecret(id, patch.secret);
  // If this connection is the active one, re-sync the legacy slot.
  const fresh = row(id);
  if (fresh?.is_active) {
    applyActiveToLegacy(fresh);
    configEvents.emit("connection-changed", fresh.kind);
  }
}

export function removeConnection(id: number): void {
  const c = row(id);
  if (!c) return;
  deleteConnectionSecret(id);
  getDb().prepare("DELETE FROM connections WHERE id=?").run(id);
  if (c.is_active) {
    const next = listByKind(c.kind)[0];
    if (next) setActive(c.kind, next.id);
    else {
      clearLegacy(c.kind);
      configEvents.emit("connection-changed", c.kind);
    }
  }
}

export function setActive(kind: ConnKind, id: number): void {
  const d = getDb();
  d.prepare("UPDATE connections SET is_active=0 WHERE kind=?").run(kind);
  d.prepare("UPDATE connections SET is_active=1 WHERE id=? AND kind=?").run(id, kind);
  const c = row(id);
  if (c) applyActiveToLegacy(c);
  configEvents.emit("connection-changed", kind);
}

export function getActive(kind: ConnKind): Connection | null {
  return (
    (getDb().prepare("SELECT * FROM connections WHERE kind=? AND is_active=1").get(kind) as Connection) ??
    null
  );
}

/* -------------------------------------------------------------------------- */
/* Legacy-slot sync                                                            */
/* -------------------------------------------------------------------------- */

/** Mirror an active connection into config.json + the legacy named secret. */
export function applyActiveToLegacy(c: Connection): void {
  let cfg: Record<string, any> = {};
  try {
    cfg = JSON.parse(c.config || "{}");
  } catch {
    cfg = {};
  }
  const secret = getConnectionSecret(c.id);

  if (c.kind === "github") {
    if (secret) setSecret("githubToken", secret);
    else deleteSecret("githubToken");
  } else if (c.kind === "gitlab") {
    updateConfig({ gitlab: { apiUrl: String(cfg.apiUrl || DEFAULT_GITLAB_API) } });
    if (secret) setSecret("gitlabToken", secret);
    else deleteSecret("gitlabToken");
  } else if (c.kind === "database") {
    updateConfig({
      database: {
        type: cfg.engine === "mysql" ? "mysql" : "postgres",
        host: String(cfg.host ?? "localhost"),
        port: Number(cfg.port) || (cfg.engine === "mysql" ? 3306 : 5432),
        user: String(cfg.user ?? ""),
        database: String(cfg.database ?? ""),
        ssl: !!cfg.ssl,
      },
    });
    if (secret) setSecret("dbPassword", secret);
    else deleteSecret("dbPassword");
  } else if (c.kind === "redis") {
    updateConfig({
      redis: {
        host: String(cfg.host ?? "localhost"),
        port: Number(cfg.port) || 6379,
        username: String(cfg.username ?? ""),
        db: Number(cfg.db) || 0,
        tls: !!cfg.tls,
      },
    });
    if (secret) setSecret("redisPassword", secret);
    else deleteSecret("redisPassword");
  }
  // Monitoring kinds (grafana/prometheus/loki) have no legacy slot — nothing to mirror.
}

/** When the last connection of a kind is removed, disable it in the legacy slot. */
function clearLegacy(kind: ConnKind): void {
  if (kind === "github") deleteSecret("githubToken");
  else if (kind === "gitlab") deleteSecret("gitlabToken");
  else if (kind === "database") deleteSecret("dbPassword");
  else if (kind === "redis") deleteSecret("redisPassword");
  // Monitoring kinds have no legacy slot.
}

/* -------------------------------------------------------------------------- */
/* One-time migration from the old single-connection config                    */
/* -------------------------------------------------------------------------- */

function ensureMigrated(): void {
  const g = globalThis as { __connMigrated?: boolean };
  if (g.__connMigrated) return;
  g.__connMigrated = true;

  const d = getDb();
  const count = (d.prepare("SELECT COUNT(*) c FROM connections").get() as { c: number }).c;
  if (count > 0) return;

  const cfg = getConfig();
  const insert = (kind: ConnKind, name: string, config: Record<string, unknown>, secret: string | null) => {
    const id = Number(
      d.prepare("INSERT INTO connections(kind,name,config,is_active) VALUES(?,?,?,1)")
        .run(kind, name, JSON.stringify(config)).lastInsertRowid
    );
    if (secret) setConnectionSecret(id, secret);
  };

  if (hasSecret("githubToken")) {
    insert("github", "GitHub", {}, getSecret("githubToken"));
  }
  if (hasSecret("gitlabToken")) {
    let host = "GitLab";
    try {
      host = new URL(cfg.gitlab.apiUrl).host;
    } catch {
      /* keep default */
    }
    insert("gitlab", host, { apiUrl: cfg.gitlab.apiUrl }, getSecret("gitlabToken"));
  }
  if (hasSecret("dbPassword") || cfg.database.host !== "localhost" || cfg.database.database !== "postgres") {
    insert(
      "database",
      `${cfg.database.type} · ${cfg.database.database || cfg.database.host}`,
      {
        engine: cfg.database.type,
        host: cfg.database.host,
        port: cfg.database.port,
        user: cfg.database.user,
        database: cfg.database.database,
        ssl: cfg.database.ssl,
      },
      getSecret("dbPassword")
    );
  }
  if (hasSecret("redisPassword") || cfg.redis.host !== "localhost") {
    insert(
      "redis",
      `redis · ${cfg.redis.host}:${cfg.redis.port}`,
      {
        host: cfg.redis.host,
        port: cfg.redis.port,
        username: cfg.redis.username,
        db: cfg.redis.db,
        tls: cfg.redis.tls,
      },
      getSecret("redisPassword")
    );
  }
}
