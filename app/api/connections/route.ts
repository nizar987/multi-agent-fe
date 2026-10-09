/**
 * GET  /api/connections — list saved connections (grouped-friendly, no secrets).
 * POST /api/connections — create a connection { kind, name, config, secret? }.
 */
import { NextRequest, NextResponse } from "next/server";
import {
  listConnections,
  createConnection,
  toView,
  CONN_KINDS,
  ConnKind,
} from "@/lib/connections-db";
import { logger } from "@/lib/logger";
import { invalidateModelsCache } from "@/lib/model-cache";
import { isConfigObject, sanitizeConnectionConfig } from "@/lib/connection-config";

export const dynamic = "force-dynamic";

export async function GET() {
  return NextResponse.json(listConnections().map(toView));
}

export async function POST(req: NextRequest) {
  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid JSON" }, { status: 400 });
  }

  const kind = body?.kind as ConnKind;
  if (!CONN_KINDS.includes(kind)) {
    return NextResponse.json({ error: "invalid kind" }, { status: 400 });
  }

  const name = String(body?.name ?? "").trim().slice(0, 200);

  // config must be a plain object, reject arrays and primitives
  const rawConfig = body?.config;
  if (rawConfig !== undefined && !isConfigObject(rawConfig)) {
    return NextResponse.json({ error: "config must be an object" }, { status: 400 });
  }
  const safeConfig = sanitizeConnectionConfig(rawConfig ?? {});

  // secret must be a string if provided; reject non-strings
  const rawSecret = body?.secret;
  if (rawSecret !== undefined && rawSecret !== null && typeof rawSecret !== "string") {
    return NextResponse.json({ error: "secret must be a string" }, { status: 400 });
  }
  const secret = typeof rawSecret === "string" && rawSecret.trim() ? rawSecret : null;

  // Reject excessively large secrets (> 8 KB)
  if (secret && secret.length > 8192) {
    return NextResponse.json({ error: "secret too long" }, { status: 400 });
  }

  const id = createConnection({ kind, name, config: safeConfig, secret });
  invalidateModelsCache();
  logger.info(`Connection created: id=${id}, kind=${kind}, name=${name}`);
  return NextResponse.json({ id });
}
