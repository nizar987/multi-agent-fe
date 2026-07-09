import { NextRequest, NextResponse } from "next/server";
import { resolveApproval, ApprovalDecision } from "@/lib/shell";

export const dynamic = "force-dynamic";

/**
 * The user's decision on one approval request (shell/SQL/Redis/.env).
 * Body: { id, decision: "always" | "once" | "deny" }
 * (legacy body { id, approved: boolean } still accepted)
 */
export async function POST(req: NextRequest) {
  const { id, decision, approved } = await req.json();
  if (typeof id !== "string") return NextResponse.json({ error: "id is required" }, { status: 400 });

  const d: ApprovalDecision = ["always", "once", "deny"].includes(decision)
    ? decision
    : approved
      ? "once"
      : "deny";

  const found = resolveApproval(id, d);
  return NextResponse.json({ ok: found });
}
