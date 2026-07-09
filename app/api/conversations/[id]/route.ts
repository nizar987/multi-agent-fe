/**
 * DELETE /api/conversations/:id — delete one conversation and its messages.
 */
import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";

export const dynamic = "force-dynamic";

export async function DELETE(_: NextRequest, { params }: { params: { id: string } }) {
  const db = getDb();
  const conv = db.prepare("SELECT id FROM conversations WHERE id=?").get(params.id);
  if (!conv) return NextResponse.json({ error: "conversation not found" }, { status: 404 });
  // messages have ON DELETE CASCADE, but delete explicitly in case FK enforcement is off
  db.prepare("DELETE FROM messages WHERE conversation_id=?").run(params.id);
  db.prepare("DELETE FROM conversations WHERE id=?").run(params.id);
  return NextResponse.json({ ok: true });
}
