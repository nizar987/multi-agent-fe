import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";

export const dynamic = "force-dynamic";

export async function GET() {
  return NextResponse.json(getDb().prepare("SELECT * FROM skills ORDER BY id").all());
}

export async function POST(req: NextRequest) {
  const b = await req.json();
  const r = getDb()
    .prepare("INSERT INTO skills(name,description,content) VALUES(?,?,?)")
    .run(b.name ?? "New skill", b.description ?? "", b.content ?? "");
  return NextResponse.json({ id: Number(r.lastInsertRowid) });
}
