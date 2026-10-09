/**
 * GET    /api/approvals/allowlist        — list "Always allow" entries
 * POST   /api/approvals/allowlist        — add one  { kind, detail }
 * DELETE /api/approvals/allowlist?id=N   — remove one
 */
import { NextRequest, NextResponse } from "next/server";
import { listAllowed, addAllowed, removeAllowed } from "@/lib/allowlist";
import { assertLocalRequest } from "@/lib/local-only";
import type { ApprovalKind } from "@/lib/agent-runtime";

export const dynamic = "force-dynamic";

const KINDS: ApprovalKind[] = ["shell", "database", "redis", "env", "learning"];

/**
 * 🔴 Entries here make an action skip the approval card forever, and the list
 * itself reveals which commands the user runs — localhost only, like
 * /api/shell/approve.
 */
export async function GET(req: NextRequest) {
  const guard = assertLocalRequest(req);
  if (guard) return guard;
  return NextResponse.json(listAllowed());
}

export async function POST(req: NextRequest) {
  const guard = assertLocalRequest(req);
  if (guard) return guard;

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid JSON" }, { status: 400 });
  }
  const { kind, detail } = body;
  if (!KINDS.includes(kind as ApprovalKind) || typeof detail !== "string" || !detail.trim()) {
    return NextResponse.json({ error: "kind (shell|database|redis|env) and detail are required" }, { status: 400 });
  }
  addAllowed(kind as ApprovalKind, detail);
  return NextResponse.json({ ok: true });
}

export async function DELETE(req: NextRequest) {
  const guard = assertLocalRequest(req);
  if (guard) return guard;

  const id = Number(req.nextUrl.searchParams.get("id"));
  if (!Number.isInteger(id)) return NextResponse.json({ error: "id is required" }, { status: 400 });
  removeAllowed(id);
  return NextResponse.json({ ok: true });
}
