/**
 * Catalog repository — agents, skills and knowledge.
 *
 * - local mode  (no shared DB configured): SQLite only, exactly as before.
 * - shared mode (sharedDbUrl set): PostgreSQL is the source of truth. Reads
 *   fetch from Postgres and MIRROR the rows into the local SQLite tables; writes
 *   go to Postgres first and then update the mirror.
 *
 * Why a mirror: conversations, runs, cron jobs, manager assignments… live in
 * SQLite and reference agents by id (foreign keys, joins), and the agent
 * runtime reads the catalog synchronously. The mirror keeps all of that
 * working unchanged, and lets agents keep running from the last copy when
 * Postgres is unreachable (offline = read-only: writes fail with
 * SharedDbUnavailableError).
 *
 * Per-machine agent fields stay local and are never sent to Postgres:
 * working_dir (a local folder) and shell_auto (auto-approve shell here).
 *
 * First connection ("adoption", once per database URL): if Postgres is empty
 * the local catalog is uploaded with the same ids; otherwise the remote catalog
 * replaces the local copy.
 */
import crypto from "crypto";
import type { PoolClient } from "pg";
import { getDb, getMeta, setMeta } from "./db";
import { getSharedPool, sharedDbConfigured, sharedDbUrl, sharedDbSource, SharedDbSource, PG_NOW } from "./shared-db";
import { logger } from "./logger";

export class SharedDbUnavailableError extends Error {
  constructor(cause: unknown) {
    super(`The shared database is unreachable — changes cannot be saved right now (${cause instanceof Error ? cause.message : cause}).`);
  }
}

type Table = "agents" | "skills" | "knowledge";
type Row = Record<string, unknown> & { id: number };

/** Columns stored in Postgres (and mirrored). id is handled separately. */
const SHARED_COLS: Record<Table, string[]> = {
  agents: ["name", "description", "system_prompt", "model_override", "tools", "skill_ids", "avatar", "color", "category", "created_at", "updated_at"],
  skills: ["name", "description", "content", "created_by_agent", "created_at"],
  knowledge: ["title", "content", "agent_id", "created_by_agent", "created_at"],
};
const TABLES: Table[] = ["agents", "skills", "knowledge"]; // FK order for inserts
const SNAPSHOT_KEY = "shared_catalog_snapshot";
const ADOPTED_KEY = "shared_catalog_adopted";
const DEFAULT_MAX_AGE_MS = 5_000;

export type CatalogMode = "local" | "shared";

export function catalogMode(): CatalogMode {
  return sharedDbConfigured() ? "shared" : "local";
}

export interface SyncStatus {
  mode: CatalogMode;
  /** Where the connection URL comes from: Settings (keychain) or .env. */
  source: SharedDbSource | null;
  online: boolean | null;
  lastSyncAt: number | null;
  lastError: string | null;
  adoptedAction: "uploaded" | "downloaded" | null;
}

const status: SyncStatus = { mode: "local", source: null, online: null, lastSyncAt: null, lastError: null, adoptedAction: null };
let inflight: Promise<SyncStatus> | null = null;
let lastWarnAt = 0;

export function catalogStatus(): SyncStatus {
  return { ...status, mode: catalogMode(), source: sharedDbSource() };
}

/* ---------- mirror (SQLite) ---------- */

function asText(v: unknown): unknown {
  return Buffer.isBuffer(v) ? v.toString("utf8") : v;
}

function mirrorUpsert(table: Table, row: Row): void {
  const cols = SHARED_COLS[table];
  const sets = cols.map((c) => `${c}=excluded.${c}`).join(", ");
  getDb()
    .prepare(`INSERT INTO ${table}(id, ${cols.join(", ")}) VALUES(?, ${cols.map(() => "?").join(", ")})
      ON CONFLICT(id) DO UPDATE SET ${sets}`)
    .run(row.id, ...cols.map((c) => (row[c] === undefined ? null : row[c])));
}

function mirrorDelete(table: Table, id: number): void {
  getDb().prepare(`DELETE FROM ${table} WHERE id=?`).run(id);
}

function readSnapshot(): Record<Table, number[]> {
  try {
    const s = JSON.parse(getMeta(SNAPSHOT_KEY) ?? "{}");
    return { agents: s.agents ?? [], skills: s.skills ?? [], knowledge: s.knowledge ?? [] };
  } catch {
    return { agents: [], skills: [], knowledge: [] };
  }
}

function writeSnapshot(snap: Record<Table, number[]>): void {
  setMeta(SNAPSHOT_KEY, JSON.stringify(snap));
}

function snapshotAdd(table: Table, id: number): void {
  const snap = readSnapshot();
  if (!snap[table].includes(id)) writeSnapshot({ ...snap, [table]: [...snap[table], id] });
}

function snapshotRemove(table: Table, id: number): void {
  const snap = readSnapshot();
  writeSnapshot({ ...snap, [table]: snap[table].filter((x) => x !== id) });
}

/**
 * Make the local tables match the remote rows. Only rows that came from the
 * shared DB before (the snapshot) are deleted when they disappear remotely —
 * rows that never left this machine are never touched.
 */
function applyMirror(remote: Record<Table, Row[]>): void {
  const db = getDb();
  const prev = readSnapshot();
  db.exec("BEGIN");
  try {
    for (const t of TABLES) for (const row of remote[t]) mirrorUpsert(t, row);
    for (const t of [...TABLES].reverse()) {
      const now = new Set(remote[t].map((r) => r.id));
      for (const id of prev[t]) if (!now.has(id)) mirrorDelete(t, id);
    }
    db.exec("COMMIT");
  } catch (e) {
    db.exec("ROLLBACK");
    throw e;
  }
  writeSnapshot({
    agents: remote.agents.map((r) => r.id),
    skills: remote.skills.map((r) => r.id),
    knowledge: remote.knowledge.map((r) => r.id),
  });
}

/* ---------- adoption (first connection to a database URL) ---------- */

function urlFingerprint(): string {
  return crypto.createHash("sha256").update(sharedDbUrl() ?? "").digest("hex").slice(0, 16);
}

/** Copy the local catalog into an EMPTY Postgres with the same ids. */
async function uploadLocal(client: PoolClient): Promise<void> {
  const db = getDb();
  await client.query("BEGIN");
  try {
    for (const t of TABLES) {
      const cols = SHARED_COLS[t];
      const rows = db.prepare(`SELECT id, ${cols.join(", ")} FROM ${t} ORDER BY id`).all() as Row[];
      for (const r of rows) {
        const values = [r.id, ...cols.map((c) => asText(r[c]) ?? null)];
        await client.query(
          `INSERT INTO ${t}(id, ${cols.join(", ")}) VALUES(${values.map((_, i) => `$${i + 1}`).join(", ")})`,
          values
        );
      }
      await client.query(`SELECT setval(pg_get_serial_sequence('${t}', 'id'), GREATEST((SELECT MAX(id) FROM ${t}), 1))`);
    }
    await client.query("COMMIT");
  } catch (e) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw e;
  }
}

async function adoptIfNeeded(client: PoolClient): Promise<void> {
  const fp = urlFingerprint();
  if (getMeta(ADOPTED_KEY) === fp) return;
  const { rows } = await client.query("SELECT (SELECT COUNT(*) FROM agents) + (SELECT COUNT(*) FROM skills) + (SELECT COUNT(*) FROM knowledge) AS n");
  if (Number(rows[0].n) === 0) {
    await uploadLocal(client);
    status.adoptedAction = "uploaded";
    logger.info("Shared catalog: local agents/skills/knowledge uploaded to the shared database.");
  } else {
    status.adoptedAction = "downloaded";
    logger.info("Shared catalog: using the existing catalog from the shared database.");
  }
  setMeta(ADOPTED_KEY, fp);
}

/* ---------- sync ---------- */

/**
 * Pull the catalog from Postgres into the local mirror. Results younger than
 * `maxAgeMs` are reused (0 = always fetch). Never throws: on failure the app
 * keeps working from the mirror and the status says offline.
 */
export async function syncShared(maxAgeMs = DEFAULT_MAX_AGE_MS): Promise<SyncStatus> {
  if (catalogMode() === "local") return catalogStatus();
  if (status.online && status.lastSyncAt && Date.now() - status.lastSyncAt < maxAgeMs) return catalogStatus();
  if (inflight) return inflight;
  inflight = (async () => {
    try {
      const pool = await getSharedPool();
      if (!pool) return catalogStatus();
      const client = await pool.connect();
      try {
        await adoptIfNeeded(client);
        const remote = {} as Record<Table, Row[]>;
        for (const t of TABLES) {
          remote[t] = (await client.query(`SELECT id, ${SHARED_COLS[t].join(", ")} FROM ${t} ORDER BY id`)).rows as Row[];
        }
        applyMirror(remote);
      } finally {
        client.release();
      }
      Object.assign(status, { online: true, lastSyncAt: Date.now(), lastError: null });
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      Object.assign(status, { online: false, lastError: msg });
      if (Date.now() - lastWarnAt > 60_000) {
        lastWarnAt = Date.now();
        logger.warn(`Shared catalog unreachable — using the local copy: ${msg}`);
      }
    } finally {
      inflight = null;
    }
    return catalogStatus();
  })();
  return inflight;
}

/* ---------- writes ---------- */

async function sharedPoolOrThrow() {
  try {
    const pool = await getSharedPool();
    if (!pool) throw new Error("not configured");
    return pool;
  } catch (e) {
    status.online = false;
    status.lastError = e instanceof Error ? e.message : String(e);
    throw new SharedDbUnavailableError(e);
  }
}

async function remoteQuery(sql: string, params: unknown[]): Promise<Row[]> {
  const pool = await sharedPoolOrThrow();
  try {
    return (await pool.query(sql, params)).rows as Row[];
  } catch (e) {
    // Connection-level failure → offline; SQL errors (constraints…) propagate as-is.
    const code = (e as { code?: string }).code ?? "";
    if (/^(ECONN|ETIMEDOUT|ENOTFOUND|EAI_AGAIN|57P0)/.test(code) || /timeout|terminated|Connection/i.test(String(e))) {
      status.online = false;
      throw new SharedDbUnavailableError(e);
    }
    throw e;
  }
}

/** Insert a row; returns its id. `fields` keys must be shared columns of `table`. */
async function insertRow(table: Table, fields: Record<string, unknown>): Promise<number> {
  const cols = Object.keys(fields);
  if (catalogMode() === "local") {
    const r = getDb()
      .prepare(`INSERT INTO ${table}(${cols.join(", ")}) VALUES(${cols.map(() => "?").join(", ")})`)
      .run(...cols.map((c) => fields[c]));
    return Number(r.lastInsertRowid);
  }
  const [row] = await remoteQuery(
    `INSERT INTO ${table}(${cols.join(", ")}) VALUES(${cols.map((_, i) => `$${i + 1}`).join(", ")})
     RETURNING id, ${SHARED_COLS[table].join(", ")}`,
    cols.map((c) => fields[c])
  );
  mirrorUpsert(table, row);
  snapshotAdd(table, row.id);
  return row.id;
}

/** Update a row; false when it does not exist. */
async function updateRow(table: Table, id: number, fields: Record<string, unknown>): Promise<boolean> {
  const cols = Object.keys(fields);
  const touch = table === "agents";
  if (catalogMode() === "local") {
    const r = getDb()
      .prepare(`UPDATE ${table} SET ${cols.map((c) => `${c}=?`).join(", ")}${touch ? ", updated_at=datetime('now')" : ""} WHERE id=?`)
      .run(...cols.map((c) => fields[c]), id);
    return r.changes > 0;
  }
  const rows = await remoteQuery(
    `UPDATE ${table} SET ${cols.map((c, i) => `${c}=$${i + 1}`).join(", ")}${touch ? `, updated_at=${PG_NOW}` : ""}
     WHERE id=$${cols.length + 1} RETURNING id, ${SHARED_COLS[table].join(", ")}`,
    [...cols.map((c) => fields[c]), id]
  );
  if (rows.length === 0) return false;
  mirrorUpsert(table, rows[0]);
  return true;
}

async function deleteRow(table: Table, id: number): Promise<boolean> {
  if (catalogMode() === "local") {
    return getDb().prepare(`DELETE FROM ${table} WHERE id=?`).run(id).changes > 0;
  }
  const rows = await remoteQuery(`DELETE FROM ${table} WHERE id=$1 RETURNING id`, [id]);
  mirrorDelete(table, id); // also removes a stale local copy
  snapshotRemove(table, id);
  return rows.length > 0;
}

/* ---------- public API ---------- */

export interface AgentFields {
  name: string;
  description: string;
  system_prompt: string;
  model_override: string | null;
  tools: string; // JSON array
  skill_ids: string; // JSON array
  avatar: string;
  color: string;
  category: string;
}

/** Per-machine agent settings — SQLite only. */
export interface AgentLocalFields {
  shell_auto?: number;
  working_dir?: string | null;
}

function setLocalAgentFields(id: number, local: AgentLocalFields): void {
  const cols = Object.keys(local) as (keyof AgentLocalFields)[];
  if (cols.length === 0) return;
  getDb()
    .prepare(`UPDATE agents SET ${cols.map((c) => `${c}=?`).join(", ")} WHERE id=?`)
    .run(...cols.map((c) => local[c] ?? null), id);
}

/** Fresh list (fetched from the shared DB when configured), with local fields merged. */
export async function listAgents(): Promise<Row[]> {
  await syncShared(0);
  return getDb().prepare("SELECT * FROM agents ORDER BY id").all() as Row[];
}

export async function getAgentRow(id: number): Promise<Row | null> {
  await syncShared();
  return (getDb().prepare("SELECT * FROM agents WHERE id=?").get(id) as Row | undefined) ?? null;
}

export async function createAgent(fields: AgentFields, local: AgentLocalFields = {}): Promise<number> {
  const id = await insertRow("agents", { ...fields });
  setLocalAgentFields(id, local);
  return id;
}

export async function updateAgent(id: number, fields: AgentFields, local: AgentLocalFields = {}): Promise<boolean> {
  const ok = await updateRow("agents", id, { ...fields });
  if (ok) setLocalAgentFields(id, local);
  return ok;
}

export async function deleteAgent(id: number): Promise<boolean> {
  return deleteRow("agents", id);
}

export async function setAgentSkillIds(agentId: number, skillIds: number[]): Promise<void> {
  await updateRow("agents", agentId, { skill_ids: JSON.stringify(skillIds) });
}

export interface SkillFields { name: string; description: string; content: string; created_by_agent?: number | null }

export async function listSkills(): Promise<Row[]> {
  await syncShared(0);
  return getDb().prepare("SELECT * FROM skills ORDER BY id").all() as Row[];
}
export const createSkill = (f: SkillFields) => insertRow("skills", { ...f });
export const updateSkill = (id: number, f: Omit<SkillFields, "created_by_agent">) => updateRow("skills", id, { ...f });
export const deleteSkill = (id: number) => deleteRow("skills", id);

export interface KnowledgeFields { title: string; content: string; agent_id: number | null; created_by_agent?: number | null }

export async function listKnowledge(): Promise<Row[]> {
  await syncShared(0);
  return getDb()
    .prepare(`SELECT k.*, a.name AS agent_name FROM knowledge k LEFT JOIN agents a ON a.id = k.agent_id ORDER BY k.id DESC`)
    .all() as Row[];
}
export const createKnowledge = (f: KnowledgeFields) => insertRow("knowledge", { ...f });
export const updateKnowledge = (id: number, f: Partial<Omit<KnowledgeFields, "created_by_agent">>) => updateRow("knowledge", id, { ...f });
export const deleteKnowledge = (id: number) => deleteRow("knowledge", id);

/** Row counts in Postgres and in the local copy (Settings status). */
export async function catalogCounts(): Promise<{ remote: Record<Table, number> | null; local: Record<Table, number> }> {
  const db = getDb();
  const local = Object.fromEntries(
    TABLES.map((t) => [t, (db.prepare(`SELECT COUNT(*) c FROM ${t}`).get() as { c: number }).c])
  ) as Record<Table, number>;
  if (catalogMode() === "local") return { remote: null, local };
  try {
    const pool = await getSharedPool();
    if (!pool) return { remote: null, local };
    const remote = {} as Record<Table, number>;
    for (const t of TABLES) remote[t] = Number((await pool.query(`SELECT COUNT(*) AS n FROM ${t}`)).rows[0].n);
    return { remote, local };
  } catch {
    return { remote: null, local };
  }
}
