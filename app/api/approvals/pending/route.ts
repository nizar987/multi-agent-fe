/**
 * GET /api/approvals/pending — approval requests currently waiting for the
 * user (shell / SQL / Redis / .env). Polled by the global ApprovalNotifier so
 * the user is alerted even when the requesting chat isn't on screen.
 */
import { NextRequest, NextResponse } from "next/server";
import { listPendingApprovals } from "@/lib/shell";
import { assertLocalRequest } from "@/lib/local-only";

export const dynamic = "force-dynamic";

/** Exposes the exact commands/SQL awaiting approval — localhost only. */
export async function GET(req: NextRequest) {
  const guard = assertLocalRequest(req);
  if (guard) return guard;
  return NextResponse.json(listPendingApprovals());
}
