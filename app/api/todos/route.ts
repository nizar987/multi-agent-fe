/**
 * GET /api/todos?conversationId=N          → todos of one conversation
 * GET /api/todos?sessionId=N               → { [agentId]: todos } for a workspace session
 * The right-hand Progress panel loads its initial state from here; live
 * updates arrive via the "todos" SSE event.
 */
import { NextRequest, NextResponse } from "next/server";
import { getTodos, getSessionTodos } from "@/lib/progress-db";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const convId = Number(req.nextUrl.searchParams.get("conversationId"));
  const sessionId = Number(req.nextUrl.searchParams.get("sessionId"));
  if (Number.isFinite(convId) && convId > 0) return NextResponse.json(getTodos(convId));
  if (Number.isFinite(sessionId) && sessionId > 0) return NextResponse.json(getSessionTodos(sessionId));
  return NextResponse.json({ error: "conversationId or sessionId is required" }, { status: 400 });
}
