import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";

export const dynamic = "force-dynamic";

export async function GET(_: NextRequest, { params }: { params: { id: string } }) {
  const a = getDb().prepare("SELECT * FROM agents WHERE id=?").get(params.id);
  if (!a) return NextResponse.json({ error: "not found" }, { status: 404 });
  return NextResponse.json(a);
}

export async function PUT(req: NextRequest, { params }: { params: { id: string } }) {
  const b = await req.json();
  getDb()
    .prepare(`UPDATE agents SET name=?, description=?, system_prompt=?, model_override=?,
      tools=?, skill_ids=?, avatar=?, color=?, shell_auto=?, updated_at=datetime('now') WHERE id=?`)
    .run(
      b.name, b.description ?? "", b.system_prompt ?? "", b.model_override || null,
      JSON.stringify(b.tools ?? []), JSON.stringify(b.skill_ids ?? []),
      b.avatar ?? "🤖", b.color ?? "#c15f3c", b.shell_auto ? 1 : 0, params.id
    );
  return NextResponse.json({ ok: true });
}

export async function DELETE(_: NextRequest, { params }: { params: { id: string } }) {
  getDb().prepare("DELETE FROM agents WHERE id=?").run(params.id);
  return NextResponse.json({ ok: true });
}
