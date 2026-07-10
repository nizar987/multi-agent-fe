/**
 * GET    /api/kanban/[id]  — get single ticket
 * PATCH  /api/kanban/[id]  — update ticket (status, assign, etc.)
 * DELETE /api/kanban/[id]  — delete ticket
 */
import { NextRequest, NextResponse } from "next/server";
import { kanbanRepo } from "@/lib/kanban-db";

export const dynamic = "force-dynamic";

type Params = { params: { id: string } };

export async function GET(_req: NextRequest, { params }: Params) {
  const id = Number(params.id);
  if (!Number.isFinite(id)) {
    return NextResponse.json({ error: "invalid id" }, { status: 400 });
  }
  const ticket = kanbanRepo.get(id);
  if (!ticket) return NextResponse.json({ error: "not_found" }, { status: 404 });
  return NextResponse.json(ticket);
}

export async function PATCH(req: NextRequest, { params }: Params) {
  try {
    const id = Number(params.id);
    if (!Number.isFinite(id)) {
      return NextResponse.json({ error: "invalid id" }, { status: 400 });
    }
    const ticket = kanbanRepo.get(id);
    if (!ticket) return NextResponse.json({ error: "not_found" }, { status: 404 });

    const body = await req.json();
    const validStatuses = new Set(["todo", "in_progress", "done"]);
    const validPriorities = new Set(["low", "medium", "high"]);

    const patch: Record<string, unknown> = {};

    if (body?.title !== undefined) {
      const title = body.title.toString().trim();
      if (!title) return NextResponse.json({ error: "title cannot be empty" }, { status: 400 });
      if (title.length > 500) return NextResponse.json({ error: "title too long" }, { status: 400 });
      patch.title = title;
    }
    if (body?.description !== undefined) {
      patch.description = body.description
        ? body.description.toString().trim().slice(0, 2000)
        : null;
    }
    if (body?.status !== undefined) {
      if (!validStatuses.has(body.status)) {
        return NextResponse.json({ error: "invalid status" }, { status: 400 });
      }
      patch.status = body.status;
    }
    if (body?.priority !== undefined) {
      if (!validPriorities.has(body.priority)) {
        return NextResponse.json({ error: "invalid priority" }, { status: 400 });
      }
      patch.priority = body.priority;
    }
    if (body?.assigned_agent_id !== undefined) {
      patch.assigned_agent_id = body.assigned_agent_id != null ? Number(body.assigned_agent_id) : null;
    }
    if (body?.assigned_agent_name !== undefined) {
      patch.assigned_agent_name = body.assigned_agent_name
        ? body.assigned_agent_name.toString().trim().slice(0, 200)
        : null;
    }
    if (body?.manager_agent_id !== undefined) {
      patch.manager_agent_id = body.manager_agent_id != null ? Number(body.manager_agent_id) : null;
    }
    if (body?.manager_agent_name !== undefined) {
      patch.manager_agent_name = body.manager_agent_name
        ? body.manager_agent_name.toString().trim().slice(0, 200)
        : null;
    }

    kanbanRepo.update(id, patch as any);
    return NextResponse.json(kanbanRepo.get(id));
  } catch (err: any) {
    return NextResponse.json({ error: err?.message ?? "internal_error" }, { status: 500 });
  }
}

export async function DELETE(_req: NextRequest, { params }: Params) {
  try {
    const id = Number(params.id);
    if (!Number.isFinite(id)) {
      return NextResponse.json({ error: "invalid id" }, { status: 400 });
    }
    const ticket = kanbanRepo.get(id);
    if (!ticket) return NextResponse.json({ error: "not_found" }, { status: 404 });
    kanbanRepo.delete(id);
    return NextResponse.json({ ok: true });
  } catch (err: any) {
    return NextResponse.json({ error: err?.message ?? "internal_error" }, { status: 500 });
  }
}
