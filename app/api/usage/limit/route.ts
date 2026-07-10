/**
 * POST /api/usage/limit  { enabled?: boolean, maxTokens?: number }
 * Toggle the context limit on/off and set the token budget.
 */
import { NextRequest, NextResponse } from "next/server";
import { getConfig, updateConfig } from "@/lib/config";

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}));
  const current = getConfig().context;

  const limitEnabled = typeof body.enabled === "boolean" ? body.enabled : current.limitEnabled;
  let maxTokens = current.maxTokens;
  if (body.maxTokens !== undefined) {
    const n = Math.floor(Number(body.maxTokens));
    if (!Number.isFinite(n) || n < 1000) {
      return NextResponse.json({ error: "maxTokens must be a number ≥ 1000." }, { status: 400 });
    }
    maxTokens = n;
  }

  const cfg = updateConfig({ context: { limitEnabled, maxTokens } });
  return NextResponse.json({ ok: true, context: cfg.context });
}
