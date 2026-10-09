/**
 * Key/value store behind the shared tool-result cache (lib/tool-cache.ts).
 *
 * - memory : in-process LRU with TTL (default). Shared by every agent running
 *            in this app — the workspace runs agents in parallel in one process.
 * - redis  : the Redis connection from Settings (same client the redis_* agent
 *            tools use), keys prefixed `ap:toolcache:`. Survives app restarts and
 *            can be shared with other processes/backends.
 *
 * The same backends also hold the file locks of lib/file-locks.ts, in a
 * separate key space (`ap:lock:`) so clearing the cache never drops a lock.
 *
 * If Redis errors, the store falls back to memory for a cool-down period and
 * logs it — a cache must never break an agent run.
 */
import { getMeta, setMeta } from "./db";
import { getRedis } from "./db-clients";
import { logger } from "./logger";

export type CacheBackend = "memory" | "redis";

export interface CacheStore {
  readonly kind: CacheBackend;
  get(key: string): Promise<string | null>;
  set(key: string, value: string, ttlSec: number): Promise<void>;
  /** Delete every key starting with `prefix` ("" = everything). Returns the count. */
  delPrefix(prefix: string): Promise<number>;
  count(): Promise<number>;
  /**
   * Atomic lease: take `key` for `ownerId` (value `${ownerId}\t${label}`) unless
   * another owner holds it. Re-claiming your own key renews the TTL.
   * Returns null on success, or the holder's stored value when blocked.
   */
  claim(key: string, ownerId: string, label: string, ttlSec: number): Promise<string | null>;
  /** Delete `key` only if `ownerId` holds it. */
  release(key: string, ownerId: string): Promise<void>;
  /** All live [key, value] pairs whose key starts with `prefix`. */
  entries(prefix: string): Promise<Array<[string, string]>>;
}

export type StoreSpace = "cache" | "locks";

function ownedBy(value: string, ownerId: string): boolean {
  return value.startsWith(`${ownerId}\t`);
}

const META_KEY = "tool_cache_backend";
const REDIS_PREFIXES: Record<StoreSpace, string> = { cache: "ap:toolcache:", locks: "ap:lock:" };
const REDIS_COOLDOWN_MS = 60_000;
const MEMORY_MAX_ENTRIES = 2_000;
const MEMORY_MAX_BYTES = 64 * 1024 * 1024;
/** Values larger than this are not cached at all. */
export const MAX_VALUE_BYTES = 1024 * 1024;

/* ---------- memory ---------- */

type MemEntry = { value: string; expires: number; bytes: number };

class MemoryStore implements CacheStore {
  readonly kind = "memory" as const;
  private map = new Map<string, MemEntry>();
  private bytes = 0;

  async get(key: string): Promise<string | null> {
    const e = this.map.get(key);
    if (!e) return null;
    if (e.expires <= Date.now()) {
      this.drop(key, e);
      return null;
    }
    // LRU: move to the back (most recently used).
    this.map.delete(key);
    this.map.set(key, e);
    return e.value;
  }

  async set(key: string, value: string, ttlSec: number): Promise<void> {
    const bytes = value.length * 2;
    if (bytes > MAX_VALUE_BYTES * 2) return;
    const old = this.map.get(key);
    if (old) this.drop(key, old);
    this.map.set(key, { value, expires: Date.now() + ttlSec * 1000, bytes });
    this.bytes += bytes;
    this.evict();
  }

  async delPrefix(prefix: string): Promise<number> {
    let n = 0;
    for (const [k, e] of [...this.map]) {
      if (k.startsWith(prefix)) { this.drop(k, e); n++; }
    }
    return n;
  }

  async count(): Promise<number> {
    const now = Date.now();
    for (const [k, e] of [...this.map]) if (e.expires <= now) this.drop(k, e);
    return this.map.size;
  }

  async claim(key: string, ownerId: string, label: string, ttlSec: number): Promise<string | null> {
    const current = await this.get(key);
    if (current !== null && !ownedBy(current, ownerId)) return current;
    await this.set(key, `${ownerId}\t${label}`, ttlSec);
    return null;
  }

  async release(key: string, ownerId: string): Promise<void> {
    const e = this.map.get(key);
    if (e && ownedBy(e.value, ownerId)) this.drop(key, e);
  }

  async entries(prefix: string): Promise<Array<[string, string]>> {
    const now = Date.now();
    const out: Array<[string, string]> = [];
    for (const [k, e] of [...this.map]) {
      if (e.expires <= now) this.drop(k, e);
      else if (k.startsWith(prefix)) out.push([k, e.value]);
    }
    return out;
  }

  private drop(key: string, e: MemEntry): void {
    this.map.delete(key);
    this.bytes -= e.bytes;
  }

  private evict(): void {
    while (this.map.size > MEMORY_MAX_ENTRIES || this.bytes > MEMORY_MAX_BYTES) {
      const oldest = this.map.keys().next();
      if (oldest.done) break;
      this.drop(oldest.value, this.map.get(oldest.value)!);
    }
  }
}

/* ---------- redis ---------- */

/** KEYS[1]=key ARGV[1]=ownerId ARGV[2]=value ARGV[3]=ttlSec → nil on success, else holder value. */
const CLAIM_LUA = `
local v = redis.call('GET', KEYS[1])
if v and string.sub(v, 1, string.len(ARGV[1]) + 1) ~= ARGV[1] .. '\t' then return v end
redis.call('SET', KEYS[1], ARGV[2], 'EX', ARGV[3])
return false`;
/** KEYS[1]=key ARGV[1]=ownerId → deletes only when owned. */
const RELEASE_LUA = `
local v = redis.call('GET', KEYS[1])
if v and string.sub(v, 1, string.len(ARGV[1]) + 1) == ARGV[1] .. '\t' then return redis.call('DEL', KEYS[1]) end
return 0`;

function globEscape(s: string): string {
  return s.replace(/[*?[\]\\]/g, (c) => `\\${c}`);
}

class RedisStore implements CacheStore {
  readonly kind = "redis" as const;

  constructor(private readonly prefix: string) {}

  async get(key: string): Promise<string | null> {
    return (await getRedis()).get(this.prefix + key);
  }

  async set(key: string, value: string, ttlSec: number): Promise<void> {
    if (Buffer.byteLength(value) > MAX_VALUE_BYTES) return;
    await (await getRedis()).set(this.prefix + key, value, "EX", Math.max(1, Math.round(ttlSec)));
  }

  private async scanKeys(prefix: string, limit = 100_000): Promise<string[]> {
    const r = await getRedis();
    const match = `${globEscape(this.prefix + prefix)}*`;
    const keys: string[] = [];
    let cursor = "0";
    do {
      const [next, batch] = await r.scan(cursor, "MATCH", match, "COUNT", 500);
      cursor = next;
      keys.push(...batch);
    } while (cursor !== "0" && keys.length < limit);
    return keys;
  }

  async delPrefix(prefix: string): Promise<number> {
    const r = await getRedis();
    const keys = await this.scanKeys(prefix);
    let n = 0;
    for (let i = 0; i < keys.length; i += 500) n += await r.unlink(...keys.slice(i, i + 500));
    return n;
  }

  async count(): Promise<number> {
    return (await this.scanKeys("")).length;
  }

  async claim(key: string, ownerId: string, label: string, ttlSec: number): Promise<string | null> {
    const r = await getRedis();
    const res = await r.eval(CLAIM_LUA, 1, this.prefix + key, ownerId, `${ownerId}\t${label}`, Math.max(1, Math.round(ttlSec)));
    return typeof res === "string" ? res : null;
  }

  async release(key: string, ownerId: string): Promise<void> {
    await (await getRedis()).eval(RELEASE_LUA, 1, this.prefix + key, ownerId);
  }

  async entries(prefix: string): Promise<Array<[string, string]>> {
    const keys = await this.scanKeys(prefix, 1_000);
    if (keys.length === 0) return [];
    const values = await (await getRedis()).mget(...keys);
    const out: Array<[string, string]> = [];
    keys.forEach((k, i) => { const v = values[i]; if (v !== null) out.push([k.slice(this.prefix.length), v]); });
    return out;
  }
}

/* ---------- selection + fallback ---------- */

const memory: Record<StoreSpace, MemoryStore> = { cache: new MemoryStore(), locks: new MemoryStore() };
const redis: Record<StoreSpace, RedisStore> = {
  cache: new RedisStore(REDIS_PREFIXES.cache),
  locks: new RedisStore(REDIS_PREFIXES.locks),
};
let redisDownUntil = 0;

export function getCacheBackend(): CacheBackend {
  try {
    return getMeta(META_KEY) === "redis" ? "redis" : "memory";
  } catch {
    return "memory";
  }
}

export function setCacheBackend(backend: CacheBackend): void {
  setMeta(META_KEY, backend);
  redisDownUntil = 0;
}

/** True while Redis is selected but temporarily bypassed after an error. */
export function redisDegraded(): boolean {
  return getCacheBackend() === "redis" && Date.now() < redisDownUntil;
}

function activeStore(space: StoreSpace): CacheStore {
  return getCacheBackend() === "redis" && Date.now() >= redisDownUntil ? redis[space] : memory[space];
}

/**
 * Run `op` against the active store. A Redis failure switches to the memory
 * store for REDIS_COOLDOWN_MS and retries there, so callers never see it.
 */
export async function withStore<T>(op: (s: CacheStore) => Promise<T>, space: StoreSpace = "cache"): Promise<T> {
  const store = activeStore(space);
  try {
    return await op(store);
  } catch (e) {
    if (store.kind !== "redis") throw e;
    redisDownUntil = Date.now() + REDIS_COOLDOWN_MS;
    logger.warn(`Cache store: Redis unavailable (${e instanceof Error ? e.message : e}) — using the in-memory store for ${REDIS_COOLDOWN_MS / 1000}s.`);
    return op(memory[space]);
  }
}
