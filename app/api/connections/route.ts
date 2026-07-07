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

export const dynamic = "force-dynamic";

export async function GET() {
  return NextResponse.json(listConnections().map(toView));
}

export async function POST(req: NextRequest) {
  const body = await req.json();
  const kind = body?.kind as ConnKind;
  if (!CONN_KINDS.includes(kind)) {
    return NextResponse.json({ error: "invalid kind" }, { status: 400 });
  }
  const name = String(body?.name ?? "").trim();
  const config = typeof body?.config === "object" && body.config ? body.config : {};
  const secret = body?.secret ? String(body.secret) : null;
  const id = createConnection({ kind, name, config, secret });
  return NextResponse.json({ id });
}
