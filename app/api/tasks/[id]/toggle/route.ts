/**
 * POST /api/tasks/[id]/toggle  → toggle completion
 */
import { NextRequest, NextResponse } from "next/server";
import { getTaskById, toggleTaskCompletion, initTasksTable } from "@/lib/tasks-db";
import { logger } from "@/lib/logger";

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    initTasksTable();
    const id = Number(params.id);
    if (!Number.isFinite(id) || id <= 0) {
      return NextResponse.json({ ok: false, error: "invalid_id" }, { status: 400 });
    }

    const task = getTaskById(id);
    if (!task) {
      return NextResponse.json({ ok: false, error: "task_not_found" }, { status: 404 });
    }

    const updated = toggleTaskCompletion(id);
    return NextResponse.json({ ok: true, data: updated });
  } catch (err) {
    logger.error(`POST /api/tasks/[id]/toggle failed: ${(err as Error).message}`);
    return NextResponse.json({ ok: false, error: "internal_error" }, { status: 500 });
  }
}
