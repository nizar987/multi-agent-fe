import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { getAgentRow, updateAgent, deleteAgent } from "@/lib/catalog";
import { catalogErrorResponse } from "@/lib/catalog-http";
import { logger } from "@/lib/logger";

export const dynamic = "force-dynamic";

const MAX_TEXT = 100_000;
const MAX_SHORT = 500;

function clampStr(v: unknown, max = MAX_SHORT): string {
  if (typeof v !== "string") return "";
  return v.replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, "").slice(0, max);
}

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

export async function GET(_: NextRequest, { params }: { params: { id: string } }) {
  const id = Number(params.id);
  if (!Number.isInteger(id) || id <= 0)
    return NextResponse.json({ error: "invalid id" }, { status: 400 });
  const a = await getAgentRow(id);
  if (!a) return NextResponse.json({ error: "not found" }, { status: 404 });
  return NextResponse.json(a);
}

export async function PUT(req: NextRequest, { params }: { params: { id: string } }) {
  const id = Number(params.id);
  if (!Number.isInteger(id) || id <= 0)
    return NextResponse.json({ error: "invalid id" }, { status: 400 });

  let b: Record<string, unknown>;
  try {
    b = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid JSON" }, { status: 400 });
  }

  // Validate working_dir: must be non-empty string or null, no path traversal
  let workingDir: string | null = null;
  if (typeof b.working_dir === "string" && b.working_dir.trim()) {
    const wd = b.working_dir.trim();
    // Block obvious path traversal patterns
    if (wd.includes("..")) {
      return NextResponse.json({ error: "invalid working_dir" }, { status: 400 });
    }
    workingDir = clampStr(wd, 1024);
  }

  const name = clampStr(b.name ?? "Agent") || "Agent";
  const description = clampStr(b.description ?? "");
  const system_prompt = clampStr(b.system_prompt ?? "", MAX_TEXT);
  const model_override = b.model_override ? clampStr(b.model_override) : null;
  const tools = sanitizeTools(b.tools);
  const skill_ids = sanitizeSkillIds(b.skill_ids);
  const avatar = clampStr(b.avatar ?? "🤖", 16);
  const color = /^#[0-9a-fA-F]{6}$/.test(String(b.color ?? "")) ? String(b.color) : "#c15f3c";
  const shell_auto = b.shell_auto ? 1 : 0;
  const category = clampStr(b.category ?? "");

  let found: boolean;
  try {
    found = await updateAgent(
      id,
      { name, description, system_prompt, model_override, tools: JSON.stringify(tools),
        skill_ids: JSON.stringify(skill_ids), avatar, color, category },
      // per-machine settings — never sent to the shared database
      { shell_auto, working_dir: workingDir }
    );
  } catch (e) {
    return catalogErrorResponse(e, `Agent update failed (id=${id})`);
  }
  if (!found)
    return NextResponse.json({ error: "not found" }, { status: 404 });

  logger.info(`Agent updated: id=${id}, name=${name}`);
  return NextResponse.json({ ok: true });
}

/**
 * PATCH /api/agents/[id]
 * Partial update — currently supports: working_dir only.
 * Safer than PUT when you only want to touch one field.
 */
export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  const id = Number(params.id);
  if (!Number.isInteger(id) || id <= 0)
    return NextResponse.json({ error: "invalid id" }, { status: 400 });

  let b: Record<string, unknown>;
  try {
    b = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid JSON" }, { status: 400 });
  }

  // Only working_dir is supported for now
  if (!("working_dir" in b))
    return NextResponse.json({ error: "nothing to patch" }, { status: 400 });

  let workingDir: string | null = null;
  if (typeof b.working_dir === "string" && b.working_dir.trim()) {
    const wd = b.working_dir.trim();
    if (wd.includes(".."))
      return NextResponse.json({ error: "invalid working_dir" }, { status: 400 });
    workingDir = clampStr(wd, 1024);
  }

  const result = getDb()
    .prepare("UPDATE agents SET working_dir=?, updated_at=datetime('now') WHERE id=?")
    .run(workingDir, id);

  if (result.changes === 0)
    return NextResponse.json({ error: "not found" }, { status: 404 });

  logger.info(`Agent working_dir patched: id=${id}, working_dir=${workingDir}`);
  return NextResponse.json({ ok: true });
}

export async function DELETE(_: NextRequest, { params }: { params: { id: string } }) {
  const id = Number(params.id);
  if (!Number.isInteger(id) || id <= 0)
    return NextResponse.json({ error: "invalid id" }, { status: 400 });

  // Foreign keys are enforced (lib/db.ts), so a row still referencing this
  // agent aborts the delete. Every reference cascades, but surface a readable
  // 409 instead of an unhandled 500 if a future table forgets its ON DELETE.
  let deleted: boolean;
  try {
    deleted = await deleteAgent(id);
  } catch (e: any) {
    if (!String(e?.code ?? "").includes("SQLITE_CONSTRAINT")) return catalogErrorResponse(e, `Agent delete failed (id=${id})`);
    logger.error(`Agent delete failed: id=${id}`, e);
    return NextResponse.json(
      { error: "This agent is still referenced by other records and could not be deleted." },
      { status: 409 }
    );
  }
  if (!deleted)
    return NextResponse.json({ error: "not found" }, { status: 404 });

  logger.info(`Agent deleted: id=${id}`);
  return NextResponse.json({ ok: true });
}
