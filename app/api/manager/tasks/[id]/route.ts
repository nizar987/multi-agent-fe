/**
 * GET /api/manager/tasks/:id — full task detail: task row, all assignments with
 * their status, and the event history.
 */
import { NextRequest, NextResponse } from "next/server";
import { tasksRepo, assignmentsRepo, taskEventsRepo } from "@/lib/manager-db";

export const dynamic = "force-dynamic";

export async function GET(_req: NextRequest, { params }: { params: { id: string } }) {
  const id = Number(params.id);
  const task = tasksRepo.get(id);
  if (!task) return NextResponse.json({ error: "not found" }, { status: 404 });
  return NextResponse.json({
    task,
    assignments: assignmentsRepo.listByTask(id),
    events: taskEventsRepo.listByTask(id),
  });
}
