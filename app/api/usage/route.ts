/**
 * GET    /api/usage        → token-usage summary + current context-limit config
 * DELETE /api/usage        → reset the usage log
 */
import { NextResponse } from "next/server";
import { getUsageSummary, clearUsage } from "@/lib/usage-db";
import { getConfig } from "@/lib/config";

export const dynamic = "force-dynamic";

export async function GET() {
  const summary = getUsageSummary();
  const context = getConfig().context;
  return NextResponse.json({ ...summary, context });
}

export async function DELETE() {
  clearUsage();
  return NextResponse.json({ ok: true });
}
