import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";

export const dynamic = "force-dynamic";

export async function PUT(req: NextRequest, { params }: { params: { id: string } }) {
  const b = await req.json();
  getDb()
    .prepare("UPDATE knowledge SET title=?, content=?, agent_id=? WHERE id=?")
    .run(b.title, b.content ?? "", b.agent_id ?? null, params.id);
  return NextResponse.json({ ok: true });
}

export async function DELETE(_: NextRequest, { params }: { params: { id: string } }) {
  getDb().prepare("DELETE FROM knowledge WHERE id=?").run(params.id);
  return NextResponse.json({ ok: true });
}
