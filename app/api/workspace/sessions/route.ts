import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";

export const dynamic = "force-dynamic";

/** List all workspace sessions. */
export async function GET() {
  const db = getDb();
  db.exec(`
    CREATE TABLE IF NOT EXISTS workspace_sessions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      title TEXT NOT NULL DEFAULT 'New session',
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE TABLE IF NOT EXISTS workspace_session_agents (
      session_id INTEGER NOT NULL REFERENCES workspace_sessions(id) ON DELETE CASCADE,
      agent_id INTEGER NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
      conversation_id INTEGER NOT NULL,
      PRIMARY KEY (session_id, agent_id)
    );
  `);

  const rows = db
    .prepare("SELECT * FROM workspace_sessions ORDER BY id DESC")
    .all();
  return NextResponse.json(rows);
}

/** Create a new workspace session. */
export async function POST(req: NextRequest) {
  const db = getDb();
  db.exec(`
    CREATE TABLE IF NOT EXISTS workspace_sessions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      title TEXT NOT NULL DEFAULT 'New session',
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE TABLE IF NOT EXISTS workspace_session_agents (
      session_id INTEGER NOT NULL REFERENCES workspace_sessions(id) ON DELETE CASCADE,
      agent_id INTEGER NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
      conversation_id INTEGER NOT NULL,
      PRIMARY KEY (session_id, agent_id)
    );
  `);

  const body = await req.json().catch(() => ({}));
  const title = typeof body.title === "string" && body.title.trim() ? body.title.trim() : "New session";
  const r = db.prepare("INSERT INTO workspace_sessions(title) VALUES(?)").run(title);
  return NextResponse.json({ id: Number(r.lastInsertRowid), title });
}

/** Update session title (PATCH). */
export async function PATCH(req: NextRequest) {
  const db = getDb();
  const body = await req.json();
  if (!body.id || !body.title) return NextResponse.json({ error: "id and title required" }, { status: 400 });
  db.prepare("UPDATE workspace_sessions SET title=? WHERE id=?").run(body.title.slice(0, 120), body.id);
  return NextResponse.json({ ok: true });
}
