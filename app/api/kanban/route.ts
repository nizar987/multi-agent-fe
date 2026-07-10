/**
 * GET  /api/kanban  — list all tickets
 * POST /api/kanban  — create a ticket, or bulk-import from CSV rows
 */
import { NextRequest, NextResponse } from "next/server";
import { kanbanRepo } from "@/lib/kanban-db";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const tickets = kanbanRepo.list();
    return NextResponse.json(tickets);
  } catch (err: any) {
    return NextResponse.json({ error: err?.message ?? "internal_error" }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();

    // --- bulk import (CSV rows from client-side parsing) ---
    if (Array.isArray(body?.rows)) {
      const rows: Array<{ title: string; description?: string; status?: string; priority?: string }> =
        body.rows;
      if (rows.length === 0) {
        return NextResponse.json({ error: "rows array is empty" }, { status: 400 });
      }
      if (rows.length > 500) {
        return NextResponse.json({ error: "max 500 rows per import" }, { status: 400 });
      }
      // Validate each row has at least a title
      for (const r of rows) {
        const title = (r.title ?? "").trim();
        if (!title) {
          return NextResponse.json({ error: "Each row must have a non-empty title" }, { status: 400 });
        }
        if (title.length > 500) {
          return NextResponse.json({ error: "title must be <= 500 characters" }, { status: 400 });
        }
      }
      const count = kanbanRepo.bulkCreate(rows);
      return NextResponse.json({ imported: count }, { status: 201 });
    }

    // --- single ticket create ---
    const title = (body?.title ?? "").toString().trim();
    if (!title) {
      return NextResponse.json({ error: "title is required" }, { status: 400 });
    }
    if (title.length > 500) {
      return NextResponse.json({ error: "title must be <= 500 characters" }, { status: 400 });
    }

    const validStatuses = new Set(["todo", "in_progress", "done"]);
    const validPriorities = new Set(["low", "medium", "high"]);

    const status = validStatuses.has(body?.status) ? body.status : "todo";
    const priority = validPriorities.has(body?.priority) ? body.priority : "medium";
    const description = body?.description
      ? body.description.toString().trim().slice(0, 2000)
      : null;
    const assigned_agent_id =
      body?.assigned_agent_id != null ? Number(body.assigned_agent_id) : null;
    const assigned_agent_name =
      body?.assigned_agent_name != null
        ? body.assigned_agent_name.toString().trim().slice(0, 200)
        : null;
    const manager_agent_id =
      body?.manager_agent_id != null ? Number(body.manager_agent_id) : null;
    const manager_agent_name =
      body?.manager_agent_name != null
        ? body.manager_agent_name.toString().trim().slice(0, 200)
        : null;

    const id = kanbanRepo.create({
      title,
      description,
      status,
      priority,
      assigned_agent_id,
      assigned_agent_name,
      manager_agent_id,
      manager_agent_name,
    });
    return NextResponse.json({ id }, { status: 201 });
  } catch (err: any) {
    return NextResponse.json({ error: err?.message ?? "internal_error" }, { status: 500 });
  }
}
