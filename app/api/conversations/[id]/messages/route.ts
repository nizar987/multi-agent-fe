import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";

export const dynamic = "force-dynamic";

export async function GET(_: NextRequest, { params }: { params: { id: string } }) {
  const rows = getDb()
    .prepare("SELECT * FROM messages WHERE conversation_id=? ORDER BY id")
    .all(params.id);
  return NextResponse.json(rows);
}
