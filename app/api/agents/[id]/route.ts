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

  // Validate working_dir: must be a non-empty string or null/undefined
  const workingDir = typeof b.working_dir === "string" && b.working_dir.trim()
    ? b.working_dir.trim()
    : null;

  getDb()
    .prepare(`UPDATE agents SET name=?, description=?, system_prompt=?, model_override=?,
      tools=?, skill_ids=?, avatar=?, color=?, shell_auto=?, working_dir=?, category=?,
      updated_at=datetime('now') WHERE id=?`)
    .run(
      b.name, b.description ?? "", b.system_prompt ?? "", b.model_override || null,
      JSON.stringify(b.tools ?? []), JSON.stringify(b.skill_ids ?? []),
      b.avatar ?? "🤖", b.color ?? "#c15f3c", b.shell_auto ? 1 : 0,
      workingDir, typeof b.category === "string" ? b.category.trim() : "", params.id
    );
  return NextResponse.json({ ok: true });
}

export async function DELETE(_: NextRequest, { params }: { params: { id: string } }) {
  getDb().prepare("DELETE FROM agents WHERE id=?").run(params.id);
  return NextResponse.json({ ok: true });
}
