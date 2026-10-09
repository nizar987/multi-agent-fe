import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { reloadCronJobs } from "@/lib/cron";
import cron from "node-cron";

export const dynamic = "force-dynamic";

/** List all cron jobs with agent info. */
export async function GET() {
  const db = getDb();
  const jobs = db
    .prepare(`SELECT c.*, a.name as agent_name, a.avatar as agent_avatar, a.color as agent_color
      FROM cron_jobs c
      JOIN agents a ON a.id = c.agent_id
      ORDER BY c.id DESC`)
    .all();
  return NextResponse.json(jobs);
}

/** Create a new cron job. */
export async function POST(req: NextRequest) {
  const db = getDb();
  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid JSON" }, { status: 400 });
  }

  const { agent_id, name, schedule, prompt } = body;

  if (!agent_id || !name || !schedule || !prompt) {
    return NextResponse.json({ error: "agent_id, name, schedule, prompt required" }, { status: 400 });
  }

  // 🟡 MINOR: POST was missing schedule validation (PUT had it, POST didn't)
  if (!cron.validate(String(schedule))) {
    return NextResponse.json({ error: "Invalid cron expression" }, { status: 400 });
  }

  // Validate agent exists
  const agentId = Number(agent_id);
  if (!Number.isInteger(agentId) || agentId <= 0) {
    return NextResponse.json({ error: "invalid agent_id" }, { status: 400 });
  }
  const agent = db.prepare("SELECT id FROM agents WHERE id=?").get(agentId);
  if (!agent) {
    return NextResponse.json({ error: "agent not found" }, { status: 404 });
  }

  const safeName = String(name).trim().slice(0, 200);
  const safePrompt = String(prompt).trim().slice(0, 10_000);

  if (!safeName || !safePrompt) {
    return NextResponse.json({ error: "name and prompt must not be empty" }, { status: 400 });
  }

  const r = db
    .prepare("INSERT INTO cron_jobs(agent_id,name,schedule,prompt) VALUES(?,?,?,?)")
    .run(agentId, safeName, String(schedule).trim(), safePrompt);
  reloadCronJobs();
  return NextResponse.json({ id: Number(r.lastInsertRowid) });
}
