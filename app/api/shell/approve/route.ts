import { NextRequest, NextResponse } from "next/server";
import { resolveApproval } from "@/lib/shell";

export const dynamic = "force-dynamic";

/** The user's decision on one approval request (shell/SQL/Redis/.env). */
export async function POST(req: NextRequest) {
  const { id, approved } = await req.json();
  if (typeof id !== "string") return NextResponse.json({ error: "id is required" }, { status: 400 });
  const found = resolveApproval(id, !!approved);
  return NextResponse.json({ ok: found });
}
