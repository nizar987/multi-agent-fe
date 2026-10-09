import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { logger } from "@/lib/logger";

export const dynamic = "force-dynamic";

function clampStr(v: unknown, max: number): string {
  if (typeof v !== "string") return "";
  return v.replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, "").slice(0, max);
}

function asText(v: unknown): string {
  if (typeof v === "string") return v;
  if (Buffer.isBuffer(v)) return v.toString("utf8");
  return v == null ? "" : String(v);
}

export async function GET() {
  const rows = getDb()
    .prepare(`SELECT k.*, a.name AS agent_name FROM knowledge k
      LEFT JOIN agents a ON a.id = k.agent_id ORDER BY k.id DESC`)
    .all() as Record<string, unknown>[];
  // Defensive: a BLOB-typed cell would otherwise serialize as {type:"Buffer",…}
  // and crash the page that renders it.
  const safe = rows.map((r) => ({
    ...r,
    title: asText(r.title),
    content: asText(r.content),
  }));
  return NextResponse.json(safe);
}

export async function POST(req: NextRequest) {
  let b: Record<string, unknown>;
  try {
    b = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid JSON" }, { status: 400 });
  }

  const title = clampStr(b.title ?? "Untitled", 500) || "Untitled";
  const content = clampStr(b.content ?? "", 500_000);

  // agent_id must be a positive integer or null (global knowledge)
  let agent_id: number | null = null;
  if (b.agent_id !== null && b.agent_id !== undefined) {
    const parsed = Number(b.agent_id);
    if (!Number.isInteger(parsed) || parsed <= 0) {
      return NextResponse.json({ error: "invalid agent_id" }, { status: 400 });
    }
    // Verify agent exists
    const agent = getDb().prepare("SELECT id FROM agents WHERE id=?").get(parsed);
    if (!agent) {
      return NextResponse.json({ error: "agent not found" }, { status: 404 });
    }
    agent_id = parsed;
  }

  const r = getDb()
    .prepare("INSERT INTO knowledge(title,content,agent_id) VALUES(?,?,?)")
    .run(title, content, agent_id);

  logger.info(`Knowledge created: id=${r.lastInsertRowid}, title=${title}, agent_id=${agent_id}`);
  return NextResponse.json({ id: Number(r.lastInsertRowid) });
}
