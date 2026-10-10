import { NextRequest, NextResponse } from "next/server";
import { listSkills, createSkill } from "@/lib/catalog";
import { catalogErrorResponse } from "@/lib/catalog-http";
import { logger } from "@/lib/logger";

export const dynamic = "force-dynamic";

function clampStr(v: unknown, max: number): string {
  if (typeof v !== "string") return "";
  return v.replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, "").slice(0, max);
}

export async function GET() {
  return NextResponse.json(await listSkills());
}

export async function POST(req: NextRequest) {
  let b: Record<string, unknown>;
  try {
    b = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid JSON" }, { status: 400 });
  }

  const name = clampStr(b.name ?? "New skill", 200) || "New skill";
  const description = clampStr(b.description ?? "", 1000);
  const content = clampStr(b.content ?? "", 100_000);

  try {
    const id = await createSkill({ name, description, content });
    logger.info(`Skill created: id=${id}, name=${name}`);
    return NextResponse.json({ id });
  } catch (e) {
    return catalogErrorResponse(e, "Skill create failed");
  }
}
