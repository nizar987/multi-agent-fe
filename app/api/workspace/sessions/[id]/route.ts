import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";

export const dynamic = "force-dynamic";

export async function GET(_: NextRequest, { params }: { params: { id: string } }) {
  const db = getDb();
  const sessionId = Number(params.id);

  // Get agents in this session
  const agents = db
    .prepare("SELECT agent_id, conversation_id FROM workspace_session_agents WHERE session_id=?")
    .all(sessionId) as { agent_id: number; conversation_id: number }[];

  if (agents.length === 0) {
    return NextResponse.json({ agents: [], messages: [] });
  }

  // Fetch all messages across all agent conversations in ONE query,
  // sorted by global message id so interleaved rounds reconstruct correctly.
  const placeholders = agents.map(() => "?").join(",");
  const convIds = agents.map((a) => a.conversation_id);

  // Build a conv_id → agent_id lookup
  const convToAgent: Record<number, number> = {};
  for (const a of agents) convToAgent[a.conversation_id] = a.agent_id;

  const rows = db
    .prepare(
      `SELECT m.id, m.conversation_id, m.role, m.content, m.meta, m.created_at
       FROM messages m
       WHERE m.conversation_id IN (${placeholders})
         AND m.role IN ('user','assistant')
       ORDER BY m.id ASC`
    )
    .all(...convIds) as any[];

  const messages = rows.map((m) => ({ ...m, agent_id: convToAgent[m.conversation_id] }));

  return NextResponse.json({ agents: agents.map((a) => a.agent_id), messages });
}

/** PATCH /api/workspace/sessions/[id] — save active agent list for this session (no conversation needed yet). */
export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  const db = getDb();
  const sessionId = Number(params.id);
  const body = await req.json().catch(() => ({}));

  // Save agent_ids list: upsert each agent with conversation_id = 0 as placeholder
  // Real conversation_id is set when the first message is sent via wsConversation()
  if (Array.isArray(body.agent_ids)) {
    const agentIds: number[] = body.agent_ids.filter((x: any) => typeof x === "number");

    db.transaction(() => {
      // Remove agents no longer in the active list
      const existing = db
        .prepare("SELECT agent_id FROM workspace_session_agents WHERE session_id=?")
        .all(sessionId) as { agent_id: number }[];
      const existingIds = existing.map((r) => r.agent_id);
      for (const eid of existingIds) {
        if (!agentIds.includes(eid)) {
          db.prepare("DELETE FROM workspace_session_agents WHERE session_id=? AND agent_id=?").run(sessionId, eid);
        }
      }
      // Insert new agents with placeholder conv id = 0 (will be replaced on first message)
      for (const aid of agentIds) {
        db.prepare(
          "INSERT OR IGNORE INTO workspace_session_agents(session_id, agent_id, conversation_id) VALUES(?,?,0)"
        ).run(sessionId, aid);
      }
    })();
  }

  // Optionally update title
  if (typeof body.title === "string" && body.title.trim()) {
    db.prepare("UPDATE workspace_sessions SET title=? WHERE id=?").run(body.title.trim().slice(0, 120), sessionId);
  }

  return NextResponse.json({ ok: true });
}

export async function DELETE(_: NextRequest, { params }: { params: { id: string } }) {
  const db = getDb();
  db.prepare("DELETE FROM workspace_sessions WHERE id=?").run(Number(params.id));
  return NextResponse.json({ ok: true });
}
