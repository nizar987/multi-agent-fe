import { NextRequest, NextResponse } from "next/server";
import { updateSkill, deleteSkill } from "@/lib/catalog";
import { catalogErrorResponse } from "@/lib/catalog-http";

export const dynamic = "force-dynamic";

function clampStr(v: unknown, max: number): string {
  if (typeof v !== "string") return "";
  return v.replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, "").slice(0, max);
}

function parseId(raw: string): number | null {
  const id = Number(raw);
  return Number.isInteger(id) && id > 0 ? id : null;
}

export async function PUT(req: NextRequest, { params }: { params: { id: string } }) {
  const id = parseId(params.id);
  if (!id) return NextResponse.json({ error: "invalid id" }, { status: 400 });
  let b: Record<string, unknown>;
  try {
    b = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid JSON" }, { status: 400 });
  }
  try {
    const found = await updateSkill(id, {
      name: clampStr(b.name, 200) || "Skill",
      description: clampStr(b.description ?? "", 1000),
      content: clampStr(b.content ?? "", 100_000),
    });
    if (!found) return NextResponse.json({ error: "not found" }, { status: 404 });
    return NextResponse.json({ ok: true });
  } catch (e) {
    return catalogErrorResponse(e, `Skill update failed (id=${id})`);
  }
}

export async function DELETE(_: NextRequest, { params }: { params: { id: string } }) {
  const id = parseId(params.id);
  if (!id) return NextResponse.json({ error: "invalid id" }, { status: 400 });
  try {
    await deleteSkill(id);
    return NextResponse.json({ ok: true });
  } catch (e) {
    return catalogErrorResponse(e, `Skill delete failed (id=${id})`);
  }
}
