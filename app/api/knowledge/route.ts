import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";

export const dynamic = "force-dynamic";

export async function GET() {
  const rows = getDb()
    .prepare(`SELECT k.*, a.name AS agent_name FROM knowledge k
      LEFT JOIN agents a ON a.id = k.agent_id ORDER BY k.id DESC`)
    .all();
  return NextResponse.json(rows);
}

export async function POST(req: NextRequest) {
  const b = await req.json();
  const r = getDb()
    .prepare("INSERT INTO knowledge(title,content,agent_id) VALUES(?,?,?)")
    .run(b.title ?? "Untitled", b.content ?? "", b.agent_id ?? null);
  return NextResponse.json({ id: Number(r.lastInsertRowid) });
}
