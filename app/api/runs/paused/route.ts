/**
 * GET /api/runs/paused — agent runs currently paused on a network error,
 * waiting for the user to Retry/Cancel. Polled by the global notifier.
 */
import { NextRequest, NextResponse } from "next/server";
import { listPausedRuns } from "@/lib/net-pause";
import { assertLocalRequest } from "@/lib/local-only";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const guard = assertLocalRequest(req);
  if (guard) return guard;
  return NextResponse.json(listPausedRuns());
}
