import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";

export const dynamic = "force-dynamic";

export async function GET() {
  const agents = getDb().prepare("SELECT * FROM agents ORDER BY id").all();
  return NextResponse.json(agents);
}

export async function POST(req: NextRequest) {
  const b = await req.json();
  const r = getDb()
    .prepare("INSERT INTO agents(name,description,system_prompt,model_override,tools,skill_ids,avatar,color,shell_auto) VALUES(?,?,?,?,?,?,?,?,?)")
    .run(
      b.name ?? "New agent",
      b.description ?? "",
      b.system_prompt ?? "",
      b.model_override || null,
      JSON.stringify(b.tools ?? []),
      JSON.stringify(b.skill_ids ?? []),
      b.avatar ?? "🤖",
      b.color ?? "#c15f3c",
      b.shell_auto ? 1 : 0
    );
  return NextResponse.json({ id: Number(r.lastInsertRowid) });
}
