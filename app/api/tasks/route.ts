/**
 * GET  /api/tasks                → list tasks (filter: project, priority, completed, from, to, view=today|week)
 * POST /api/tasks                → create task
 *
 * Used by the macOS TaskWidget (localhost) and the web task page.
 */
import { NextRequest, NextResponse } from "next/server";
import {
  getTasks,
  createTask,
  getTodayTasks,
  getWeekTasks,
  getProjects,
  initTasksTable,
  type CreateTaskInput,
} from "@/lib/tasks-db";
import { logger } from "@/lib/logger";

export const dynamic = "force-dynamic";

const MAX_TITLE = 200;
const MAX_DESCRIPTION = 2000;
const MAX_PROJECT = 60;
const VALID_PRIORITIES = ["low", "medium", "high"];

function badRequest(message: string) {
  return NextResponse.json({ ok: false, error: message }, { status: 400 });
}

export async function GET(req: NextRequest) {
  try {
    initTasksTable();
    const sp = req.nextUrl.searchParams;
    const view = sp.get("view");

    if (view === "today") return NextResponse.json({ ok: true, data: getTodayTasks() });
    if (view === "week") return NextResponse.json({ ok: true, data: getWeekTasks() });
    if (view === "projects") return NextResponse.json({ ok: true, data: getProjects() });

    const completedParam = sp.get("completed");
    const tasks = getTasks({
      project: sp.get("project") || undefined,
      priority: sp.get("priority") || undefined,
      completed: completedParam === null ? undefined : completedParam === "true",
      dueDateFrom: sp.get("from") || undefined,
      dueDateTo: sp.get("to") || undefined,
    });
    return NextResponse.json({ ok: true, data: tasks });
  } catch (err) {
    logger.error(`GET /api/tasks failed: ${(err as Error).message}`);
    return NextResponse.json({ ok: false, error: "internal_error" }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    initTasksTable();

    let body: any;
    try {
      body = await req.json();
    } catch {
      return badRequest("invalid_json");
    }

    // Validate input (manual — no Zod in this project)
    const title = typeof body.title === "string" ? body.title.trim() : "";
    const project = typeof body.project === "string" ? body.project.trim() : "";
    const priority = body.priority;
    const description = typeof body.description === "string" ? body.description.trim() : "";
    const dueDate = body.due_date === null || body.due_date === undefined ? null : String(body.due_date).trim();
    const calendarEventId =
      body.calendar_event_id === null || body.calendar_event_id === undefined
        ? null
        : String(body.calendar_event_id).trim();

    if (!title) return badRequest("title_required");
    if (title.length > MAX_TITLE) return badRequest("title_too_long");
    if (!project) return badRequest("project_required");
    if (project.length > MAX_PROJECT) return badRequest("project_too_long");
    if (description.length > MAX_DESCRIPTION) return badRequest("description_too_long");
    if (!VALID_PRIORITIES.includes(priority)) return badRequest("invalid_priority");
    if (dueDate && !/^\d{4}-\d{2}-\d{2}$/.test(dueDate)) return badRequest("invalid_due_date");

    const input: CreateTaskInput = {
      title,
      description,
      project,
      priority,
      due_date: dueDate,
      calendar_event_id: calendarEventId,
    };

    const task = createTask(input);
    return NextResponse.json({ ok: true, data: task }, { status: 201 });
  } catch (err) {
    logger.error(`POST /api/tasks failed: ${(err as Error).message}`);
    return NextResponse.json({ ok: false, error: "internal_error" }, { status: 500 });
  }
}
