/**
 * GET    /api/approvals/allowlist        — list "Always allow" entries
 * POST   /api/approvals/allowlist        — add one  { kind, detail }
 * DELETE /api/approvals/allowlist?id=N   — remove one
 */
import { NextRequest, NextResponse } from "next/server";
import { listAllowed, addAllowed, removeAllowed } from "@/lib/allowlist";

export const dynamic = "force-dynamic";

const KINDS = ["shell", "database", "redis", "env"];

export async function GET() {
  return NextResponse.json(listAllowed());
}

export async function POST(req: NextRequest) {
  const { kind, detail } = await req.json();
  if (!KINDS.includes(kind) || typeof detail !== "string" || !detail.trim()) {
    return NextResponse.json({ error: "kind (shell|database|redis|env) and detail are required" }, { status: 400 });
  }
  addAllowed(kind, detail);
  return NextResponse.json({ ok: true });
}

export async function DELETE(req: NextRequest) {
  const id = Number(req.nextUrl.searchParams.get("id"));
  if (!Number.isInteger(id)) return NextResponse.json({ error: "id is required" }, { status: 400 });
  removeAllowed(id);
  return NextResponse.json({ ok: true });
}
