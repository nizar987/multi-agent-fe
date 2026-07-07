/**
 * PATCH  /api/connections/:id — { active?: true, name?, config?, secret? }
 * DELETE /api/connections/:id — remove a connection (and its secret).
 */
import { NextRequest, NextResponse } from "next/server";
import { updateConnection, removeConnection, setActive, listConnections } from "@/lib/connections-db";

export const dynamic = "force-dynamic";

export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  const id = Number(params.id);
  const conn = listConnections().find((c) => c.id === id);
  if (!conn) return NextResponse.json({ error: "not found" }, { status: 404 });

  const body = await req.json();
  if (body?.active === true) setActive(conn.kind, id);
  if (body?.name !== undefined || body?.config !== undefined || body?.secret !== undefined) {
    updateConnection(id, {
      name: body?.name,
      config: body?.config,
      secret: body?.secret ? String(body.secret) : undefined,
    });
  }
  return NextResponse.json({ ok: true });
}

export async function DELETE(_req: NextRequest, { params }: { params: { id: string } }) {
  removeConnection(Number(params.id));
  return NextResponse.json({ ok: true });
}
