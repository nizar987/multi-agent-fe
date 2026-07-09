import { NextRequest, NextResponse } from "next/server";
import path from "path";
import { getBridge } from "@/lib/paths";
import { getDb } from "@/lib/db";
import { getConfig } from "@/lib/config";
import { logger } from "@/lib/logger";

export const dynamic = "force-dynamic";

/**
 * POST /api/agents/[id]/pick-folder
 *
 * Opens the native OS folder dialog (Electron only) and saves the chosen
 * path as the agent's working_dir. The picked folder is also automatically
 * added to filesystem.allowedDirs (global whitelist) so MCP filesystem and
 * shell tools can access it without a separate Settings step.
 *
 * Security: the returned path is normalised and must not escape the
 * filesystem root via path traversal sequences.
 */
export async function POST(
  _req: NextRequest,
  { params }: { params: { id: string } }
) {
  const agentId = Number(params.id);
  if (!Number.isFinite(agentId) || agentId <= 0) {
    return NextResponse.json({ error: "Invalid agent id." }, { status: 400 });
  }

  // Verify the agent exists before opening the dialog.
  const agent = getDb()
    .prepare("SELECT id, name FROM agents WHERE id=?")
    .get(agentId) as { id: number; name: string } | undefined;
  if (!agent) {
    return NextResponse.json({ error: "Agent not found." }, { status: 404 });
  }

  const bridge = getBridge();
  if (!bridge?.pickFolder) {
    return NextResponse.json(
      {
        error:
          "The native folder dialog is only available in the desktop app (Electron).",
      },
      { status: 501 }
    );
  }

  const folder = await bridge.pickFolder();
  if (!folder) return NextResponse.json({ canceled: true });

  // Normalise and basic path-traversal guard.
  const normalised = path.resolve(folder);
  if (normalised !== folder && !normalised.startsWith("/")) {
    return NextResponse.json({ error: "Invalid folder path." }, { status: 400 });
  }

  // Persist working_dir on the agent row.
  getDb()
    .prepare(
      "UPDATE agents SET working_dir=?, updated_at=datetime('now') WHERE id=?"
    )
    .run(normalised, agentId);

  // Also add to global allowedDirs so filesystem MCP / shell can reach it.
  const cfg = getConfig();
  const { updateConfig } = await import("@/lib/config");
  if (!cfg.filesystem.allowedDirs.includes(normalised)) {
    updateConfig({
      filesystem: { allowedDirs: [...cfg.filesystem.allowedDirs, normalised] },
    });
  }

  logger.info(
    `Agent "${agent.name}" (id=${agentId}) working_dir set: ${normalised}`
  );

  return NextResponse.json({ folder: normalised });
}

/**
 * DELETE /api/agents/[id]/pick-folder
 *
 * Clears the agent's working_dir (reverts to the global fallback).
 * Does NOT remove the folder from filesystem.allowedDirs — the user may
 * still want other agents or the shell tool to access it.
 */
export async function DELETE(
  _req: NextRequest,
  { params }: { params: { id: string } }
) {
  const agentId = Number(params.id);
  if (!Number.isFinite(agentId) || agentId <= 0) {
    return NextResponse.json({ error: "Invalid agent id." }, { status: 400 });
  }

  const agent = getDb()
    .prepare("SELECT id, name FROM agents WHERE id=?")
    .get(agentId) as { id: number; name: string } | undefined;
  if (!agent) {
    return NextResponse.json({ error: "Agent not found." }, { status: 404 });
  }

  getDb()
    .prepare(
      "UPDATE agents SET working_dir=NULL, updated_at=datetime('now') WHERE id=?"
    )
    .run(agentId);

  logger.info(
    `Agent "${agent.name}" (id=${agentId}) working_dir cleared.`
  );

  return NextResponse.json({ ok: true });
}
