import { NextRequest, NextResponse } from "next/server";
import { listAgents, createAgent } from "@/lib/catalog";
import { catalogErrorResponse } from "@/lib/catalog-http";
import { logger } from "@/lib/logger";
import {
  clampStr, sanitizeTools, sanitizeSkillIds, sanitizeColor, MAX_AGENT_TEXT as MAX_TEXT,
} from "@/lib/agent-fields";

export const dynamic = "force-dynamic";

export async function GET() {
  // Fetched from the shared database when configured (falls back to the local copy).
  return NextResponse.json(await listAgents());
}

export async function POST(req: NextRequest) {
  let b: Record<string, unknown>;
  try {
    b = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid JSON" }, { status: 400 });
  }

  const name = clampStr(b.name ?? "New agent") || "New agent";
  const description = clampStr(b.description ?? "");
  const system_prompt = clampStr(b.system_prompt ?? "", MAX_TEXT);
  const model_override = b.model_override ? clampStr(b.model_override) : null;
  const tools = sanitizeTools(b.tools);
  const skill_ids = sanitizeSkillIds(b.skill_ids);
  const avatar = clampStr(b.avatar ?? "🤖", 16);
  const color = sanitizeColor(b.color);
  const shell_auto = b.shell_auto ? 1 : 0;
  const category = clampStr(b.category ?? "");

  try {
    const id = await createAgent(
      { name, description, system_prompt, model_override, tools: JSON.stringify(tools),
        skill_ids: JSON.stringify(skill_ids), avatar, color, category },
      { shell_auto }
    );
    logger.info(`Agent created: id=${id}, name=${name}`);
    return NextResponse.json({ id });
  } catch (e) {
    return catalogErrorResponse(e, "Agent create failed");
  }
}
