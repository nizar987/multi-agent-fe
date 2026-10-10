/**
 * Connection to the SHARED catalog database — PostgreSQL (e.g. on Railway)
 * holding agents, skills and knowledge so every installation of the app sees
 * the same catalog. Everything else (conversations, memory, usage, runs…)
 * stays in the local SQLite file.
 *
 * Configured by the `sharedDbUrl` secret (Settings → Shared database). When it
 * is not set, the app keeps using SQLite only (see lib/catalog.ts).
 */
import type { Pool } from "pg";
import { configEvents, getSecret } from "./config";
import { logger } from "./logger";

let pool: Pool | null = null;
let schemaReady: Promise<void> | null = null;

/** Same "YYYY-MM-DD HH:MM:SS" UTC text format SQLite's datetime('now') produces. */
export const PG_NOW = "to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM-DD HH24:MI:SS')";

const SCHEMA = `
  CREATE TABLE IF NOT EXISTS agents (
    id SERIAL PRIMARY KEY,
    name TEXT NOT NULL,
    description TEXT NOT NULL DEFAULT '',
    system_prompt TEXT NOT NULL DEFAULT '',
    model_override TEXT DEFAULT NULL,
    tools TEXT NOT NULL DEFAULT '[]',
    skill_ids TEXT NOT NULL DEFAULT '[]',
    avatar TEXT NOT NULL DEFAULT '🤖',
    color TEXT NOT NULL DEFAULT '#c15f3c',
    category TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL DEFAULT ${PG_NOW},
    updated_at TEXT NOT NULL DEFAULT ${PG_NOW}
  );
  CREATE TABLE IF NOT EXISTS skills (
    id SERIAL PRIMARY KEY,
    name TEXT NOT NULL,
    description TEXT NOT NULL DEFAULT '',
    content TEXT NOT NULL,
    created_by_agent INTEGER DEFAULT NULL,
    created_at TEXT NOT NULL DEFAULT ${PG_NOW}
  );
  CREATE TABLE IF NOT EXISTS knowledge (
    id SERIAL PRIMARY KEY,
    title TEXT NOT NULL,
    content TEXT NOT NULL,
    agent_id INTEGER DEFAULT NULL REFERENCES agents(id) ON DELETE CASCADE,
    created_by_agent INTEGER DEFAULT NULL,
    created_at TEXT NOT NULL DEFAULT ${PG_NOW}
  );
  CREATE INDEX IF NOT EXISTS idx_knowledge_agent ON knowledge(agent_id);
`;

export function sharedDbConfigured(): boolean {
  return !!getSecret("sharedDbUrl");
}

/**
 * TLS settings from the URL. Hosted Postgres (Railway's TCP proxy) uses a
 * self-signed certificate, so encryption is on but the chain is not verified.
 * `sslmode=disable` in the URL (or a localhost host) turns TLS off.
 */
function connectionOptions(raw: string): { connectionString: string; ssl: false | { rejectUnauthorized: false } } {
  const url = new URL(raw);
  const mode = url.searchParams.get("sslmode");
  url.searchParams.delete("sslmode"); // pg would otherwise force strict verification
  const local = ["localhost", "127.0.0.1", "::1"].includes(url.hostname);
  const ssl = mode === "disable" || (local && !mode) ? false : { rejectUnauthorized: false as const };
  return { connectionString: url.toString(), ssl };
}

/** Pool for the shared DB with the schema ensured, or null when not configured. */
export async function getSharedPool(): Promise<Pool | null> {
  const raw = getSecret("sharedDbUrl");
  if (!raw) return null;
  if (!pool) {
    const { Pool: PgPool } = await import("pg");
    pool = new PgPool({
      ...connectionOptions(raw),
      max: 4,
      connectionTimeoutMillis: 8_000,
      idleTimeoutMillis: 30_000,
      query_timeout: 15_000,
    });
    pool.on("error", (e) => logger.warn(`Shared DB pool error: ${e.message}`));
    schemaReady = null;
  }
  if (!schemaReady) {
    const p = pool;
    schemaReady = p.query(SCHEMA).then(() => undefined);
    schemaReady.catch(() => { schemaReady = null; }); // retry the schema on the next call
  }
  await schemaReady;
  return pool;
}

export async function resetSharedPool(): Promise<void> {
  const old = pool;
  pool = null;
  schemaReady = null;
  if (old) await old.end().catch(() => { /* already closed */ });
}

// A new / removed connection URL takes effect on the next query.
configEvents.on("secret-changed", (name: string) => {
  if (name === "sharedDbUrl") void resetSharedPool();
});
