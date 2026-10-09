/**
 * PATCH  /api/tickets/:id — edit { title?, description?, priority?, status? }
 * DELETE /api/tickets/:id
 */
import { NextRequest, NextResponse } from "next/server";
import { updateTicket, deleteTicket } from "@/lib/tickets-db";

export const dynamic = "force-dynamic";

export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  const id = Number(params.id);
  if (!Number.isFinite(id)) return NextResponse.json({ error: "bad id" }, { status: 400 });
  const body = await req.json();
  const ok = updateTicket(id, body ?? {});
  if (!ok) return NextResponse.json({ error: "ticket not found" }, { status: 404 });
  return NextResponse.json({ ok: true });
}

export async function DELETE(_req: NextRequest, { params }: { params: { id: string } }) {
  const id = Number(params.id);
  if (!Number.isFinite(id)) return NextResponse.json({ error: "bad id" }, { status: 400 });
  deleteTicket(id);
  return NextResponse.json({ ok: true });
}
