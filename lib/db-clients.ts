/**
 * Ready-to-use database & Redis clients for the agent runtime.
 * Lazy singletons — created on first use, reset automatically whenever
 * config or secrets change (configEvents from lib/config).
 */
import type { Pool as PgPool } from "pg";
import type { Pool as MysqlPool } from "mysql2/promise";
import type { Redis } from "ioredis";
import { configEvents, getConfig, getSecret } from "./config";
import { logger } from "./logger";

let pgPool: PgPool | null = null;
let mysqlPool: MysqlPool | null = null;
let redisClient: Redis | null = null;

export async function resetDbClients(): Promise<void> {
  const [pg, my, rd] = [pgPool, mysqlPool, redisClient];
  pgPool = null;
  mysqlPool = null;
  redisClient = null;
  await Promise.allSettled([pg?.end(), my?.end(), rd ? Promise.resolve(rd.disconnect()) : undefined]);
}

configEvents.on("config-changed", () => { void resetDbClients(); });
configEvents.on("secret-changed", () => { void resetDbClients(); });

async function getPgPool(): Promise<PgPool> {
  if (pgPool) return pgPool;
  const cfg = getConfig().database;
  const { Pool } = await import("pg");
  pgPool = new Pool({
    host: cfg.host,
    port: cfg.port,
    user: cfg.user,
    password: getSecret("dbPassword") ?? undefined,
    database: cfg.database,
    ssl: cfg.ssl ? { rejectUnauthorized: false } : undefined,
    max: 5,
  });
  return pgPool;
}

async function getMysqlPool(): Promise<MysqlPool> {
  if (mysqlPool) return mysqlPool;
  const cfg = getConfig().database;
  const mysql = await import("mysql2/promise");
  mysqlPool = mysql.createPool({
    host: cfg.host,
    port: cfg.port,
    user: cfg.user,
    password: getSecret("dbPassword") ?? undefined,
    database: cfg.database,
    ssl: cfg.ssl ? { rejectUnauthorized: false } : undefined,
    connectionLimit: 5,
  });
  return mysqlPool;
}

/** Query the external database — automatically picks the driver from config.database.type. */
export async function dbQuery(sql: string, params: unknown[] = []): Promise<unknown[]> {
  if (getConfig().database.type === "postgres") {
    const pool = await getPgPool();
    const result = await pool.query(sql, params);
    return result.rows;
  }
  const pool = await getMysqlPool();
  const [rows] = await pool.query(sql, params);
  return rows as unknown[];
}

/** External Redis client (ioredis) per config.redis. */
export async function getRedis(): Promise<Redis> {
  if (redisClient) return redisClient;
  const cfg = getConfig().redis;
  const { default: RedisCtor } = await import("ioredis");
  redisClient = new RedisCtor({
    host: cfg.host,
    port: cfg.port,
    username: cfg.username || undefined,
    password: getSecret("redisPassword") ?? undefined,
    db: cfg.db,
    tls: cfg.tls ? {} : undefined,
    maxRetriesPerRequest: 2,
  });
  // Without a listener ioredis prints "Unhandled error event" on every
  // reconnect attempt while Redis is down. Commands still reject normally.
  let lastLogged = 0;
  redisClient.on("error", (e: Error) => {
    if (Date.now() - lastLogged < 60_000) return;
    lastLogged = Date.now();
    logger.warn(`Redis connection error (${cfg.host}:${cfg.port}): ${e.message}`);
  });
  return redisClient;
}
