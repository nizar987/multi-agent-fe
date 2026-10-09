import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { logger } from "@/lib/logger";

export const dynamic = "force-dynamic";

const MAX_TEXT = 100_000; // system prompt can be long
const MAX_SHORT = 500;

function clampStr(v: unknown, max = MAX_SHORT): string {
  if (typeof v !== "string") return "";
  return v.replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, "").slice(0, max);
}

/** Validate tools array — only known tool names accepted. */
const KNOWN_TOOLS = new Set([
  "github", "gitlab", "filesystem", "memory", "delegate", "shell",
  "database", "redis", "env", "monitoring", "tavily", "tavily_mcp",
  "vision", "video",
]);

function sanitizeTools(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  return (raw as unknown[])
    .filter((t): t is string => typeof t === "string" && KNOWN_TOOLS.has(t))
    .slice(0, 20);
}

function sanitizeSkillIds(raw: unknown): number[] {
  if (!Array.isArray(raw)) return [];
  return (raw as unknown[])
    .map(Number)
    .filter((n) => Number.isInteger(n) && n > 0)
    .slice(0, 50);
}

export async function GET() {
  const agents = getDb().prepare("SELECT * FROM agents ORDER BY id").all();
  return NextResponse.json(agents);
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
  const color = /^#[0-9a-fA-F]{6}$/.test(String(b.color ?? "")) ? String(b.color) : "#c15f3c";
  const shell_auto = b.shell_auto ? 1 : 0;
  const category = clampStr(b.category ?? "");

  const r = getDb()
    .prepare(
      "INSERT INTO agents(name,description,system_prompt,model_override,tools,skill_ids,avatar,color,shell_auto,category) VALUES(?,?,?,?,?,?,?,?,?,?)"
    )
    .run(name, description, system_prompt, model_override,
      JSON.stringify(tools), JSON.stringify(skill_ids),
      avatar, color, shell_auto, category);

  logger.info(`Agent created: id=${r.lastInsertRowid}, name=${name}`);
  return NextResponse.json({ id: Number(r.lastInsertRowid) });
}
