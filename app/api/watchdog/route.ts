import { NextRequest, NextResponse } from "next/server";
import { autoResumeEnabled, setAutoResume, MAX_RESUMES } from "@/lib/run-watchdog";
import { recentRuns } from "@/lib/run-registry";
import { logger } from "@/lib/logger";

export const dynamic = "force-dynamic";

/** Auto-resume setting + the latest agent runs and their status. */
export async function GET() {
  return NextResponse.json({ enabled: autoResumeEnabled(), maxResumes: MAX_RESUMES, runs: recentRuns(15) });
}

export async function PUT(req: NextRequest) {
  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid JSON" }, { status: 400 });
  }
  if (typeof body.enabled !== "boolean") {
    return NextResponse.json({ error: "'enabled' must be a boolean" }, { status: 400 });
  }
  setAutoResume(body.enabled);
  logger.info(`Auto-resume ${body.enabled ? "enabled" : "disabled"}`);
  return NextResponse.json({ ok: true, enabled: body.enabled });
}
