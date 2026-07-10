import { NextRequest, NextResponse } from "next/server";
import { shellCwd } from "@/lib/shell";
import { getGitInfo, checkoutBranch } from "@/lib/git";
import { getDb } from "@/lib/db";
import { logger } from "@/lib/logger";

export const dynamic = "force-dynamic";

/** Resolve the agent id from the route, or null when malformed. */
function agentIdOf(id: string): number | null {
  const n = Number(id);
  return Number.isFinite(n) && n > 0 ? n : null;
}

function agentExists(agentId: number): boolean {
  return !!getDb().prepare("SELECT 1 FROM agents WHERE id=?").get(agentId);
}

/**
 * GET /api/agents/[id]/git
 * Returns the git branch state of the agent's resolved working directory.
 */
export async function GET(_req: NextRequest, { params }: { params: { id: string } }) {
  const agentId = agentIdOf(params.id);
  if (agentId === null) return NextResponse.json({ error: "Invalid agent id." }, { status: 400 });
  if (!agentExists(agentId)) return NextResponse.json({ error: "Agent not found." }, { status: 404 });

  const dir = shellCwd(agentId);
  const info = await getGitInfo(dir);
  return NextResponse.json({ dir, ...info });
}

/**
 * POST /api/agents/[id]/git  { branch: string }
 * Switches the agent's working directory to an existing local branch.
 */
export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const agentId = agentIdOf(params.id);
  if (agentId === null) return NextResponse.json({ error: "Invalid agent id." }, { status: 400 });
  if (!agentExists(agentId)) return NextResponse.json({ error: "Agent not found." }, { status: 404 });

  const body = await req.json().catch(() => ({}));
  const branch = typeof body.branch === "string" ? body.branch.trim() : "";
  if (!branch) return NextResponse.json({ error: "A branch name is required." }, { status: 400 });

  const dir = shellCwd(agentId);
  const result = await checkoutBranch(dir, branch);
  if (!result.ok) {
    return NextResponse.json({ error: result.error, dir, ...(result.info ?? {}) }, { status: 409 });
  }
  logger.info(`Agent ${agentId} switched branch → ${branch} (${dir})`);
  return NextResponse.json({ ok: true, dir, ...result.info });
}
