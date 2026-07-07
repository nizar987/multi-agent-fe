import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";

export const dynamic = "force-dynamic";

export async function PUT(req: NextRequest, { params }: { params: { id: string } }) {
  const b = await req.json();
  getDb()
    .prepare("UPDATE skills SET name=?, description=?, content=? WHERE id=?")
    .run(b.name, b.description ?? "", b.content ?? "", params.id);
  return NextResponse.json({ ok: true });
}

export async function DELETE(_: NextRequest, { params }: { params: { id: string } }) {
  getDb().prepare("DELETE FROM skills WHERE id=?").run(params.id);
  return NextResponse.json({ ok: true });
}
