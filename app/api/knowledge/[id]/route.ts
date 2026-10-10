import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { updateKnowledge, deleteKnowledge } from "@/lib/catalog";
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
  let agent_id: number | null = null;
  if (b.agent_id !== null && b.agent_id !== undefined && b.agent_id !== "") {
    agent_id = parseId(String(b.agent_id));
    if (!agent_id) return NextResponse.json({ error: "invalid agent_id" }, { status: 400 });
    if (!getDb().prepare("SELECT id FROM agents WHERE id=?").get(agent_id)) {
      return NextResponse.json({ error: "agent not found" }, { status: 404 });
    }
  }
  try {
    const found = await updateKnowledge(id, {
      title: clampStr(b.title, 500) || "Untitled",
      content: clampStr(b.content ?? "", 500_000),
      agent_id,
    });
    if (!found) return NextResponse.json({ error: "not found" }, { status: 404 });
    return NextResponse.json({ ok: true });
  } catch (e) {
    return catalogErrorResponse(e, `Knowledge update failed (id=${id})`);
  }
}

export async function DELETE(_: NextRequest, { params }: { params: { id: string } }) {
  const id = parseId(params.id);
  if (!id) return NextResponse.json({ error: "invalid id" }, { status: 400 });
  try {
    await deleteKnowledge(id);
    return NextResponse.json({ ok: true });
  } catch (e) {
    return catalogErrorResponse(e, `Knowledge delete failed (id=${id})`);
  }
}
