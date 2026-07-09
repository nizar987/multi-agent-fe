/**
 * POST /api/manager/tasks  — create a task from an original_request and start
 *                            the manager (runs to the first pause in background).
 * GET  /api/manager/tasks  — list all tasks (dashboard).
 */
import { NextRequest, NextResponse } from "next/server";
import { tasksRepo } from "@/lib/manager-db";
import { startTask } from "@/lib/manager";
import { hasSecret } from "@/lib/config";
import type { Attachment } from "@/lib/attachments";

export const dynamic = "force-dynamic";

export async function GET() {
  return NextResponse.json(tasksRepo.list());
}

export async function POST(req: NextRequest) {
  const body = await req.json();
  const request: string = (body?.original_request ?? "").toString();
  if (!request.trim()) {
    return NextResponse.json({ error: "original_request is required" }, { status: 400 });
  }
  if (!hasSecret("aiApiKey")) {
    return NextResponse.json({ error: "no_api_key" }, { status: 428 });
  }
  const agentIds: number[] = Array.isArray(body?.agent_ids)
    ? body.agent_ids.map((n: unknown) => Number(n)).filter((n: number) => Number.isFinite(n))
    : [];
  const model = typeof body?.model === "string" && body.model.trim() ? body.model.trim() : null;
  const attachments: Attachment[] = Array.isArray(body?.attachments)
    ? body.attachments.filter((a: any) => a && typeof a.name === "string" && typeof a.data === "string")
    : [];
  const id = startTask(request, body?.title, agentIds, model, attachments);
  return NextResponse.json({ id });
}
