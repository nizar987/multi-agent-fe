import { NextRequest, NextResponse } from "next/server";
import { resolveApproval, ApprovalDecision } from "@/lib/shell";
import { assertLocalRequest } from "@/lib/local-only";
import { logger } from "@/lib/logger";

export const dynamic = "force-dynamic";

/**
 * The user's decision on one approval request (shell/SQL/Redis/.env).
 * Body: { id, decision: "always" | "once" | "deny" }
 * (legacy body { id, approved: boolean } still accepted)
 *
 * 🔴 CRITICAL: This endpoint resolves pending shell/SQL/Redis approvals.
 * Must only be reachable from localhost — a remote caller could silently
 * approve destructive commands without the user's knowledge.
 */
export async function POST(req: NextRequest) {
  const guard = assertLocalRequest(req);
  if (guard) return guard;

  const body = await req.json();
  const { id, decision, approved } = body;

  if (typeof id !== "string" || !id.trim()) {
    return NextResponse.json({ error: "id is required" }, { status: 400 });
  }

  const VALID_DECISIONS = ["always", "once", "deny"];
  const d: ApprovalDecision = VALID_DECISIONS.includes(decision)
    ? decision
    : approved
      ? "once"
      : "deny";

  const found = resolveApproval(id, d);
  logger.info(`Approval resolved: id=${id}, decision=${d}, found=${found}`);
  return NextResponse.json({ ok: found });
}
