/**
 * POST /api/manager/tasks/:id/clarify — submit the user's answer to the
 * manager's clarification question and resume the task.
 * Body: { answer: string }
 */
import { NextRequest, NextResponse } from "next/server";
import { answerClarification } from "@/lib/manager";

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const id = Number(params.id);
  const body = await req.json();
  const answer: string = (body?.answer ?? "").toString();
  if (!answer.trim()) {
    return NextResponse.json({ error: "answer is required" }, { status: 400 });
  }
  const ok = answerClarification(id, answer);
  if (!ok) {
    return NextResponse.json(
      { error: "task is not awaiting clarification" },
      { status: 409 }
    );
  }
  return NextResponse.json({ ok: true });
}
