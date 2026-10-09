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
import { getDb, getMeta, setMeta } from "./db";

/** Normalize a pasted secret: trim, strip surrounding quotes and a "Bearer " prefix. */
export function cleanSecret(raw: string): string {
  return raw
    .trim()
    .replace(/^["']|["']$/g, "")
    .replace(/^Bearer\s+/i, "")
    .trim();
}

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
  | "ai"
  | "github"
  | "gitlab"
  | "database"
  | "redis"
  | "grafana"
  | "prometheus"
  | "loki"
  | "tavily";
export const CONN_KINDS: ConnKind[] = [
  "ai",
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
  if (input.secret?.trim()) setConnectionSecret(id, cleanSecret(input.secret));

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
  if (patch.secret?.trim()) setConnectionSecret(id, cleanSecret(patch.secret));
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
  // 🟠 MAJOR: wrap in a transaction so the exactly-one-active invariant
  // is never violated even under concurrent requests.
  const toggle = d.transaction(() => {
    d.prepare("UPDATE connections SET is_active=0 WHERE kind=?").run(kind);
    d.prepare("UPDATE connections SET is_active=1 WHERE id=? AND kind=?").run(id, kind);
  });
  toggle();
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

  if (c.kind === "ai") {
    updateConfig({
      ai: {
        baseUrl: String(cfg.baseUrl || "https://api.anthropic.com"),
        model: String(cfg.model || ""),
        provider: (["anthropic", "openai", "gemini"].includes(cfg.provider) ? cfg.provider : "auto"),
        visionModel: getConfig().ai.visionModel ?? "", // not per-connection — keep as is
      },
    });
    if (secret) setSecret("aiApiKey", secret);
    else deleteSecret("aiApiKey");
  } else if (c.kind === "github") {
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
  if (kind === "ai") deleteSecret("aiApiKey");
  else if (kind === "github") deleteSecret("githubToken");
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

  const cfg = getConfig();
  const insert = (kind: ConnKind, name: string, config: Record<string, unknown>, secret: string | null) => {
    const id = Number(
      d.prepare("INSERT INTO connections(kind,name,config,is_active) VALUES(?,?,?,1)")
        .run(kind, name, JSON.stringify(config)).lastInsertRowid
    );
    if (secret) setConnectionSecret(id, secret);
  };

  // The AI kind shipped later than the others — seed it from the legacy slot
  // even on installs that already have connections of other kinds.
  const aiCount = (d.prepare("SELECT COUNT(*) c FROM connections WHERE kind='ai'").get() as { c: number }).c;
  if (aiCount === 0 && hasSecret("aiApiKey")) {
    insert(
      "ai",
      cfg.ai.model || "AI Provider",
      { baseUrl: cfg.ai.baseUrl, model: cfg.ai.model, provider: cfg.ai.provider ?? "auto" },
      getSecret("aiApiKey")
    );
  }

  // NVIDIA seeds from .env: NVIDIA_API_KEY creates (non-hijacking) AI
  // connections once, and sets the default vision model for read_image.
  //
  // "Once" is tracked in app_meta, NOT by sniffing the config JSON: matching on
  // `config LIKE '%…%'` re-seeds a duplicate on every start as soon as the user
  // edits or renames the connection — and deleting a seeded connection should
  // stay deleted, not come back next launch.
  const nvKey = process.env.NVIDIA_API_KEY?.trim();
  if (nvKey) {
    const NV_MODEL = "mistralai/ministral-14b-instruct-2512";
    const GPT_OSS_MODEL = "openai/gpt-oss-120b";

    /** Insert one seeded AI connection unless it was already seeded before. */
    const seedNvidia = (metaKey: string, name: string, model: string, legacyMatch: string) => {
      if (getMeta(metaKey)) return;
      // Installs seeded before app_meta tracking: adopt the existing row.
      const existing = d
        .prepare("SELECT 1 FROM connections WHERE kind='ai' AND config LIKE ? LIMIT 1")
        .get(legacyMatch);
      if (existing) {
        setMeta(metaKey, "adopted");
        return;
      }
      const r = d
        .prepare("INSERT INTO connections(kind,name,config,is_active) VALUES('ai',?,?,0)")
        .run(name, JSON.stringify({ baseUrl: "https://integrate.api.nvidia.com/v1", model, provider: "openai" }));
      setConnectionSecret(Number(r.lastInsertRowid), nvKey);
      setMeta(metaKey, String(r.lastInsertRowid));
      // Only becomes active when no other AI connection is active (never hijacks).
      const activeAi = d.prepare("SELECT 1 FROM connections WHERE kind='ai' AND is_active=1 LIMIT 1").get();
      if (!activeAi) setActive("ai", Number(r.lastInsertRowid));
    };

    seedNvidia("seed_nvidia_nim", "NVIDIA NIM", NV_MODEL, "%ministral%");
    // GPT-OSS-120B supports reasoning_content — seeded as its own connection so
    // the user can switch to it from the model picker.
    seedNvidia("seed_nvidia_gpt_oss", "NVIDIA GPT-OSS 120B", GPT_OSS_MODEL, "%gpt-oss-120b%");

    if (!getConfig().ai.visionModel) {
      updateConfig({ ai: { visionModel: NV_MODEL } });
    }
  }

  if (count > 0) return;

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
