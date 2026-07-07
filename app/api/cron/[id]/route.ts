import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { reloadCronJobs } from "@/lib/cron";
import cron from "node-cron";

export const dynamic = "force-dynamic";

/** Update a cron job (PUT) or toggle enabled (PATCH). */
export async function PUT(req: NextRequest, { params }: { params: { id: string } }) {
  const db = getDb();
  const id = Number(params.id);
  const body = await req.json();
  const { agent_id, name, schedule, prompt, enabled } = body;

  if (schedule && !cron.validate(schedule)) {
    return NextResponse.json({ error: "Invalid cron expression" }, { status: 400 });
  }

  const fields: string[] = [];
  const values: any[] = [];
  if (agent_id !== undefined) { fields.push("agent_id=?"); values.push(agent_id); }
  if (name !== undefined) { fields.push("name=?"); values.push(name); }
  if (schedule !== undefined) { fields.push("schedule=?"); values.push(schedule); }
  if (prompt !== undefined) { fields.push("prompt=?"); values.push(prompt); }
  if (enabled !== undefined) { fields.push("enabled=?"); values.push(enabled ? 1 : 0); }

  if (fields.length === 0) return NextResponse.json({ error: "nothing to update" }, { status: 400 });
  db.prepare(`UPDATE cron_jobs SET ${fields.join(", ")} WHERE id=?`).run(...values, id);
  reloadCronJobs();
  return NextResponse.json({ ok: true });
}

/** Delete a cron job. */
export async function DELETE(_: NextRequest, { params }: { params: { id: string } }) {
  const db = getDb();
  db.prepare("DELETE FROM cron_jobs WHERE id=?").run(Number(params.id));
  reloadCronJobs();
  return NextResponse.json({ ok: true });
}
