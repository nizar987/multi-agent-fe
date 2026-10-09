/**
 * PATCH  /api/connections/:id — { active?: true, name?, config?, secret? }
 * DELETE /api/connections/:id — remove a connection (and its secret).
 */
import { NextRequest, NextResponse } from "next/server";
import { updateConnection, removeConnection, setActive, listConnections } from "@/lib/connections-db";
import { invalidateModelsCache } from "@/lib/model-cache";
import { isConfigObject, sanitizeConnectionConfig } from "@/lib/connection-config";

export const dynamic = "force-dynamic";

export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  const id = Number(params.id);
  if (!Number.isInteger(id) || id <= 0)
    return NextResponse.json({ error: "invalid id" }, { status: 400 });
  const conn = listConnections().find((c) => c.id === id);
  if (!conn) return NextResponse.json({ error: "not found" }, { status: 404 });

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid JSON" }, { status: 400 });
  }

  if (body?.active === true) {
    setActive(conn.kind, id);
    invalidateModelsCache();
  }
  if (body?.name !== undefined || body?.config !== undefined || body?.secret !== undefined) {
    // Same validation as POST — an edit must not be able to store a shape the
    // create path rejects.
    if (body.config !== undefined && !isConfigObject(body.config)) {
      return NextResponse.json({ error: "config must be an object" }, { status: 400 });
    }
    if (body.secret !== undefined && body.secret !== null && typeof body.secret !== "string") {
      return NextResponse.json({ error: "secret must be a string" }, { status: 400 });
    }
    const secret = typeof body.secret === "string" && body.secret.trim() ? body.secret : undefined;
    if (secret && secret.length > 8192) {
      return NextResponse.json({ error: "secret too long" }, { status: 400 });
    }
    updateConnection(id, {
      name: body.name === undefined ? undefined : String(body.name).trim().slice(0, 200),
      config: body.config === undefined ? undefined : sanitizeConnectionConfig(body.config),
      secret,
    });
    invalidateModelsCache();
  }
  return NextResponse.json({ ok: true });
}

export async function DELETE(_req: NextRequest, { params }: { params: { id: string } }) {
  removeConnection(Number(params.id));
  invalidateModelsCache();
  return NextResponse.json({ ok: true });
}
