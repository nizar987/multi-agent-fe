/**
 * GET    /api/tasks/[id]          → get task by id
 * PATCH  /api/tasks/[id]          → update task
 * DELETE /api/tasks/[id]          → delete task
 * POST   /api/tasks/[id]/toggle   → toggle completion
 */
import { NextRequest, NextResponse } from "next/server";
import { getTaskById, updateTask, deleteTask, toggleTaskCompletion, initTasksTable } from "@/lib/tasks-db";
import { logger } from "@/lib/logger";

export const dynamic = "force-dynamic";

const MAX_TITLE = 200;
const MAX_DESCRIPTION = 2000;
const MAX_PROJECT = 60;
const VALID_PRIORITIES = ["low", "medium", "high"];

function badRequest(message: string) {
  return NextResponse.json({ ok: false, error: message }, { status: 400 });
}

function notFound() {
  return NextResponse.json({ ok: false, error: "task_not_found" }, { status: 404 });
}

export async function GET(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    initTasksTable();
    const id = Number(params.id);
    if (!Number.isFinite(id) || id <= 0) return badRequest("invalid_id");

    const task = getTaskById(id);
    if (!task) return notFound();

    return NextResponse.json({ ok: true, data: task });
  } catch (err) {
    logger.error(`GET /api/tasks/[id] failed: ${(err as Error).message}`);
    return NextResponse.json({ ok: false, error: "internal_error" }, { status: 500 });
  }
}

export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    initTasksTable();
    const id = Number(params.id);
    if (!Number.isFinite(id) || id <= 0) return badRequest("invalid_id");

    let body: any;
    try {
      body = await req.json();
    } catch {
      return badRequest("invalid_json");
    }

    const task = getTaskById(id);
    if (!task) return notFound();

    // Validate partial updates
    const updates: any = {};

    if (body.title !== undefined) {
      const title = typeof body.title === "string" ? body.title.trim() : "";
      if (!title) return badRequest("title_required");
      if (title.length > MAX_TITLE) return badRequest("title_too_long");
      updates.title = title;
    }

    if (body.description !== undefined) {
      const desc = typeof body.description === "string" ? body.description.trim() : "";
      if (desc.length > MAX_DESCRIPTION) return badRequest("description_too_long");
      updates.description = desc;
    }

    if (body.project !== undefined) {
      const project = typeof body.project === "string" ? body.project.trim() : "";
      if (!project) return badRequest("project_required");
      if (project.length > MAX_PROJECT) return badRequest("project_too_long");
      updates.project = project;
    }

    if (body.priority !== undefined) {
      if (!VALID_PRIORITIES.includes(body.priority)) return badRequest("invalid_priority");
      updates.priority = body.priority;
    }

    if (body.due_date !== undefined) {
      const dueDate = body.due_date === null ? null : String(body.due_date).trim();
      if (dueDate && !/^\d{4}-\d{2}-\d{2}$/.test(dueDate)) return badRequest("invalid_due_date");
      updates.due_date = dueDate;
    }

    if (body.calendar_event_id !== undefined) {
      updates.calendar_event_id =
        body.calendar_event_id === null ? null : String(body.calendar_event_id).trim();
    }

    if (body.completed !== undefined) {
      if (typeof body.completed !== "boolean") return badRequest("invalid_completed");
      updates.completed = body.completed;
    }

    if (Object.keys(updates).length === 0) {
      return NextResponse.json({ ok: true, data: task });
    }

    const updated = updateTask(id, updates);
    return NextResponse.json({ ok: true, data: updated });
  } catch (err) {
    logger.error(`PATCH /api/tasks/[id] failed: ${(err as Error).message}`);
    return NextResponse.json({ ok: false, error: "internal_error" }, { status: 500 });
  }
}

export async function DELETE(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    initTasksTable();
    const id = Number(params.id);
    if (!Number.isFinite(id) || id <= 0) return badRequest("invalid_id");

    const task = getTaskById(id);
    if (!task) return notFound();

    deleteTask(id);
    return NextResponse.json({ ok: true, message: "deleted" });
  } catch (err) {
    logger.error(`DELETE /api/tasks/[id] failed: ${(err as Error).message}`);
    return NextResponse.json({ ok: false, error: "internal_error" }, { status: 500 });
  }
}
