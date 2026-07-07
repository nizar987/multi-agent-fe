import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { reloadCronJobs } from "@/lib/cron";

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
  const body = await req.json();
  const { agent_id, name, schedule, prompt } = body;
  if (!agent_id || !name || !schedule || !prompt) {
    return NextResponse.json({ error: "agent_id, name, schedule, prompt required" }, { status: 400 });
  }
  const r = db
    .prepare("INSERT INTO cron_jobs(agent_id,name,schedule,prompt) VALUES(?,?,?,?)")
    .run(agent_id, name, schedule, prompt);
  reloadCronJobs();
  return NextResponse.json({ id: Number(r.lastInsertRowid) });
}
