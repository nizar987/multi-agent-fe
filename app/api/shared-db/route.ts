import { NextRequest, NextResponse } from "next/server";
import { catalogStatus, catalogCounts, syncShared } from "@/lib/catalog";
import { assertLocalRequest } from "@/lib/local-only";
import { logger } from "@/lib/logger";

export const dynamic = "force-dynamic";

/** Shared catalog DB status: mode, online/offline, last sync, row counts. */
export async function GET(req: NextRequest) {
  const guard = assertLocalRequest(req);
  if (guard) return guard;
  return NextResponse.json({ ...catalogStatus(), counts: await catalogCounts() });
}

/** POST { action: "sync" } — connect now (first time: upload or download the catalog) and refresh. */
export async function POST(req: NextRequest) {
  const guard = assertLocalRequest(req);
  if (guard) return guard;
  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid JSON" }, { status: 400 });
  }
  if (body.action !== "sync") return NextResponse.json({ error: "unknown action" }, { status: 400 });
  const status = await syncShared(0);
  logger.info(`Shared catalog manual sync: ${status.online ? "online" : `offline (${status.lastError})`}`);
  return NextResponse.json({ ...status, counts: await catalogCounts() });
}
