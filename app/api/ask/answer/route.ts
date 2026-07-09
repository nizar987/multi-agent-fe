/**
 * POST /api/ask/answer — resolves a pending ask_user question.
 * Body: { id: string, answer: string }
 */
import { NextRequest } from "next/server";
import { resolveAnswer } from "@/lib/ask";

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  const { id, answer } = await req.json();
  if (typeof id !== "string" || typeof answer !== "string" || !answer.trim()) {
    return Response.json({ error: "id and answer are required" }, { status: 400 });
  }
  const ok = resolveAnswer(id, answer.trim());
  return Response.json({ ok });
}
