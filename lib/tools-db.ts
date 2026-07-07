/** Tool defs + executor for the external database & Redis (used by agent-runtime). */
import { AiTool } from "./ai";
import { dbQuery, getRedis } from "./db-clients";

const MAX_ROWS = 200;
const MAX_KEYS = 500;

export const databaseToolDefs: AiTool[] = [
  {
    name: "db_query",
    description:
      "Run SQL against the external database (Settings → Database). Use parameter placeholders " +
      "($1, $2, … for PostgreSQL; ? for MySQL) — never interpolate values into the SQL string. " +
      "Data-modifying statements (INSERT/UPDATE/DELETE/DDL) are executed as-is, so use them carefully.",
    input_schema: {
      type: "object",
      properties: {
        sql: { type: "string", description: "SQL statement" },
        params: { type: "array", items: {}, description: "parameter values (optional)" },
      },
      required: ["sql"],
    },
  },
];

export const redisToolDefs: AiTool[] = [
  {
    name: "redis_get",
    description: "Get a string value from Redis by key.",
    input_schema: { type: "object", properties: { key: { type: "string" } }, required: ["key"] },
  },
  {
    name: "redis_set",
    description: "Set a string value in Redis, optionally with a TTL (seconds).",
    input_schema: {
      type: "object",
      properties: {
        key: { type: "string" },
        value: { type: "string" },
        ttl_seconds: { type: "number", description: "expiry in seconds (optional)" },
      },
      required: ["key", "value"],
    },
  },
  {
    name: "redis_del",
    description: "Delete a single key from Redis.",
    input_schema: { type: "object", properties: { key: { type: "string" } }, required: ["key"] },
  },
  {
    name: "redis_keys",
    description: `Find Redis keys matching a glob pattern (e.g. "user:*"). Max ${MAX_KEYS} keys.`,
    input_schema: { type: "object", properties: { pattern: { type: "string" } }, required: ["pattern"] },
  },
];

/**
 * Read-only SQL = allowed to run without approval. Conservative: only a
 * single statement starting with SELECT/SHOW/EXPLAIN/DESCRIBE. WITH (CTE)
 * still needs approval because it can contain UPDATE/DELETE (PostgreSQL).
 */
export function isReadOnlySql(sql: string): boolean {
  const s = sql
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/--.*$/gm, "")
    .trim();
  if (s.replace(/;\s*$/, "").includes(";")) return false; // multi-statement
  return /^(select|show|explain|describe|desc)\b/i.test(s);
}

/** Description of a data-modifying Redis action — null means read-only (no approval). */
export function redisWriteDetail(name: string, input: unknown): string | null {
  const inp = input as { key?: string; value?: string; ttl_seconds?: number };
  if (name === "redis_set") {
    const ttl = inp.ttl_seconds ? ` (TTL ${inp.ttl_seconds}s)` : "";
    return `SET ${inp.key} = ${String(inp.value).slice(0, 200)}${ttl}`;
  }
  if (name === "redis_del") return `DEL ${inp.key}`;
  return null;
}

export async function callDatabaseTool(name: string, input: unknown): Promise<string> {
  const inp = input as { sql?: string; params?: unknown[] };
  if (name !== "db_query") throw new Error("Unknown database tool.");
  if (!inp?.sql) throw new Error("The 'sql' field is required.");
  const rows = await dbQuery(inp.sql, inp.params ?? []);
  if (!Array.isArray(rows)) return JSON.stringify(rows);
  if (rows.length === 0) return "(0 rows)";
  const suffix = rows.length > MAX_ROWS ? `\n(showing ${MAX_ROWS} of ${rows.length} rows)` : "";
  return JSON.stringify(rows.slice(0, MAX_ROWS)) + suffix;
}

export async function callRedisTool(name: string, input: unknown): Promise<string> {
  const redis = await getRedis();
  const inp = input as { key?: string; value?: string; ttl_seconds?: number; pattern?: string };
  if (name === "redis_get") {
    return (await redis.get(String(inp.key))) ?? "(nil)";
  }
  if (name === "redis_set") {
    if (inp.ttl_seconds && inp.ttl_seconds > 0) {
      await redis.set(String(inp.key), String(inp.value), "EX", Math.floor(inp.ttl_seconds));
    } else {
      await redis.set(String(inp.key), String(inp.value));
    }
    return "OK";
  }
  if (name === "redis_del") {
    return `${await redis.del(String(inp.key))} key(s) deleted`;
  }
  if (name === "redis_keys") {
    const keys: string[] = [];
    let cursor = "0";
    do {
      const [next, batch] = await redis.scan(cursor, "MATCH", inp.pattern ?? "*", "COUNT", 100);
      cursor = next;
      keys.push(...batch);
    } while (cursor !== "0" && keys.length < MAX_KEYS);
    return keys.slice(0, MAX_KEYS).join("\n") || "(no matching keys)";
  }
  throw new Error("Unknown redis tool.");
}
