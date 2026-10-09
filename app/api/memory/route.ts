import { NextRequest, NextResponse } from "next/server";
import { memoryList, memoryDelete } from "@/lib/memory";
import { logger } from "@/lib/logger";

export const dynamic = "force-dynamic";

export async function GET() {
  return NextResponse.json(memoryList());
}

export async function DELETE(req: NextRequest) {
  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid JSON" }, { status: 400 });
  }

  const { key } = body;
  if (typeof key !== "string" || !key.trim()) {
    return NextResponse.json({ error: "key is required" }, { status: 400 });
  }

  // Reject keys that are excessively long
  if (key.length > 500) {
    return NextResponse.json({ error: "key too long" }, { status: 400 });
  }

  memoryDelete(key.trim(), null, "user (UI)");
  logger.info(`Memory deleted by user: key=${key.trim()}`);
  return NextResponse.json({ ok: true });
}
