import { NextRequest, NextResponse } from "next/server";
import { getCacheBackend, setCacheBackend, redisDegraded, withStore, CacheBackend } from "@/lib/cache-store";
import { clearToolCache, toolCacheStats } from "@/lib/tool-cache";
import { logger } from "@/lib/logger";

export const dynamic = "force-dynamic";

const BACKENDS: CacheBackend[] = ["memory", "redis"];

export async function GET() {
  let entries: number | null = null;
  try {
    entries = await withStore((s) => s.count());
  } catch (e) {
    logger.warn(`Tool cache: count failed — ${e instanceof Error ? e.message : e}`);
  }
  return NextResponse.json({
    backend: getCacheBackend(),
    degraded: redisDegraded(),
    entries,
    stats: toolCacheStats(),
  });
}

export async function PUT(req: NextRequest) {
  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid JSON" }, { status: 400 });
  }
  const backend = body.backend as CacheBackend;
  if (!BACKENDS.includes(backend)) {
    return NextResponse.json({ error: "backend must be 'memory' or 'redis'" }, { status: 400 });
  }
  setCacheBackend(backend);
  logger.info(`Tool cache backend set to ${backend}`);
  return NextResponse.json({ ok: true, backend });
}

export async function DELETE() {
  try {
    const removed = await clearToolCache();
    logger.info(`Tool cache cleared (${removed} entries)`);
    return NextResponse.json({ ok: true, removed });
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    logger.error(`Tool cache clear failed: ${message}`);
    return NextResponse.json({ error: "Could not clear the cache." }, { status: 500 });
  }
}
