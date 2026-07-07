import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";

export const dynamic = "force-dynamic";

export async function GET(_: NextRequest, { params }: { params: { id: string } }) {
  const rows = getDb()
    .prepare("SELECT * FROM conversations WHERE agent_id=? AND title != '__workspace__' ORDER BY id DESC")
    .all(params.id);
  return NextResponse.json(rows);
}

export async function POST(_: NextRequest, { params }: { params: { id: string } }) {
  const r = getDb()
    .prepare("INSERT INTO conversations(agent_id) VALUES(?)")
    .run(params.id);
  return NextResponse.json({ id: Number(r.lastInsertRowid) });
}
