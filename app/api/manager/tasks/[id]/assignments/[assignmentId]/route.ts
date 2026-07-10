/**
 * GET /api/manager/tasks/:id/assignments/:assignmentId
 * Returns detail for a single assignment + its events filtered by assignment_id.
 */
import { NextRequest, NextResponse } from "next/server";
import { assignmentsRepo, taskEventsRepo } from "@/lib/manager-db";

export const dynamic = "force-dynamic";

export async function GET(
  _req: NextRequest,
  { params }: { params: { id: string; assignmentId: string } }
) {
  const taskId = Number(params.id);
  const assignmentId = Number(params.assignmentId);

  if (!Number.isFinite(taskId) || !Number.isFinite(assignmentId)) {
    return NextResponse.json({ error: "invalid params" }, { status: 400 });
  }

  const assignment = assignmentsRepo.get(assignmentId);
  if (!assignment || assignment.task_id !== taskId) {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }

  // Only return events that belong to this assignment
  const allEvents = taskEventsRepo.listByTask(taskId);
  const events = allEvents.filter(
    (e) => e.assignment_id === assignmentId
  );

  return NextResponse.json({ assignment, events });
}
