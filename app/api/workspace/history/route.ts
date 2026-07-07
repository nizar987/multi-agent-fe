import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";

export const dynamic = "force-dynamic";

/** Workspace history — optionally filtered by sessionId. */
export async function GET(req: NextRequest) {
  const db = getDb();
  const sessionId = req.nextUrl.searchParams.get("sessionId");

  if (sessionId) {
    // Messages from conversations tied to this session
    const rows = db
      .prepare(`SELECT m.id, m.role, m.content, m.created_at, wsa.agent_id
        FROM messages m
        JOIN workspace_session_agents wsa ON wsa.conversation_id = m.conversation_id
        WHERE wsa.session_id = ? AND m.role IN ('user','assistant')
        ORDER BY m.id`)
      .all(Number(sessionId));
    return NextResponse.json(rows);
  }

  // Legacy: cross-agent __workspace__ title
  const rows = db
    .prepare(`SELECT m.id, m.role, m.content, m.created_at, c.agent_id
      FROM messages m
      JOIN conversations c ON c.id = m.conversation_id
      WHERE c.title = '__workspace__' AND m.role IN ('user','assistant')
      ORDER BY m.id`)
    .all();
  return NextResponse.json(rows);
}

/** Clear workspace — optionally only a specific session. */
export async function DELETE(req: NextRequest) {
  const db = getDb();
  const sessionId = req.nextUrl.searchParams.get("sessionId");
  if (sessionId) {
    db.prepare("DELETE FROM workspace_sessions WHERE id=?").run(Number(sessionId));
  } else {
    db.prepare("DELETE FROM conversations WHERE title='__workspace__'").run();
  }
  return NextResponse.json({ ok: true });
}
