import { NextRequest, NextResponse } from "next/server";
import { memoryList, memoryDelete } from "@/lib/memory";

export const dynamic = "force-dynamic";

export async function GET() {
  return NextResponse.json(memoryList());
}

export async function DELETE(req: NextRequest) {
  const { key } = await req.json();
  memoryDelete(key, null, "user (UI)");
  return NextResponse.json({ ok: true });
}
