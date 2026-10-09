/**
 * POST /api/runs/retry — wake a run paused on a network error.
 * Body: { id, action: "retry" | "cancel" }
 */
import { NextRequest, NextResponse } from "next/server";
import { resolveNetworkPause, PauseAction } from "@/lib/net-pause";
import { assertLocalRequest } from "@/lib/local-only";

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  // Resumes or kills a running agent — same trust level as /api/shell/approve.
  const guard = assertLocalRequest(req);
  if (guard) return guard;

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid JSON" }, { status: 400 });
  }
  const { id, action } = body;
  if (typeof id !== "string") return NextResponse.json({ error: "id is required" }, { status: 400 });
  const a: PauseAction = action === "cancel" ? "cancel" : "retry";
  const found = resolveNetworkPause(id, a);
  return NextResponse.json({ ok: found });
}
