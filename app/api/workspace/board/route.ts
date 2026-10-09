import { NextRequest, NextResponse } from "next/server";
import { boardNotes } from "@/lib/team-board";
import { listFileLocks } from "@/lib/file-locks";

export const dynamic = "force-dynamic";

/** Team board of a workspace session + files currently locked by running agents. */
export async function GET(req: NextRequest) {
  const raw = req.nextUrl.searchParams.get("sessionId");
  const sessionId = raw === null ? null : Number(raw);
  if (sessionId !== null && (!Number.isInteger(sessionId) || sessionId <= 0)) {
    return NextResponse.json({ error: "invalid sessionId" }, { status: 400 });
  }
  const boardKey = sessionId === null ? "ws:default" : `ws:${sessionId}`;
  const [notes, locks] = [boardNotes(boardKey), await listFileLocks()];
  return NextResponse.json({ notes, locks });
}
