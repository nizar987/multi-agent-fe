/**
 * POST /api/workspace/chat — runs SEVERAL agents in PARALLEL for one
 * user message. SSE; each event is tagged with agentId so the UI can
 * highlight the agent that is working.
 *
 * Each agent has its own workspace thread (a conversation titled
 * "__workspace__") so its context carries across rounds.
 */
import { NextRequest } from "next/server";
import { getDb } from "@/lib/db";
import { startRun } from "@/lib/run-registry";
import { runAgent, RunEvent, RunMode } from "@/lib/agent-runtime";
import { hasSecret } from "@/lib/config";
import type { AiMessage } from "@/lib/ai";
import { Attachment, buildUserContent, attachmentSummary } from "@/lib/attachments";
import { describeImagesWithVision } from "@/lib/tools-vision";
import { logger } from "@/lib/logger";

export const dynamic = "force-dynamic";

const WS_TITLE = "__workspace__";

function rowToAiMessage(m: { role: string; content: string; meta: string | null }): AiMessage {
  if (m.meta) {
    try {
      const parsed = JSON.parse(m.meta);
      if (parsed?.contentBlocks) return { role: m.role as any, content: parsed.contentBlocks };
    } catch { /* fallback ke teks */ }
  }
  return { role: m.role as any, content: m.content };
}

function wsConversation(agentId: number, sessionId?: number): number {
  const db = getDb();

  if (sessionId) {
    // Check if there's an existing real conversation (conv_id > 0) for this session+agent
    const link = db
      .prepare("SELECT conversation_id FROM workspace_session_agents WHERE session_id=? AND agent_id=?")
      .get(sessionId, agentId) as any;

    if (link && link.conversation_id > 0) {
      // Already has a real conversation — reuse it
      return link.conversation_id;
    }

    // Either no link yet, or placeholder (conv_id=0) — create a real conversation
    const title = `${WS_TITLE}__${sessionId}`;
    const r = db.prepare("INSERT INTO conversations(agent_id,title) VALUES(?,?)").run(agentId, title);
    const convId = Number(r.lastInsertRowid);

    if (link) {
      // Update the placeholder row with the real conv id
      db.prepare("UPDATE workspace_session_agents SET conversation_id=? WHERE session_id=? AND agent_id=?")
        .run(convId, sessionId, agentId);
    } else {
      // Insert fresh link
      db.prepare("INSERT INTO workspace_session_agents(session_id,agent_id,conversation_id) VALUES(?,?,?)")
        .run(sessionId, agentId, convId);
    }
    return convId;
  }

  // Fallback: legacy single-session behaviour (no sessionId provided)
  const row = db
    .prepare("SELECT id FROM conversations WHERE agent_id=? AND title=?")
    .get(agentId, WS_TITLE) as any;
  if (row) return row.id;
  const r = db.prepare("INSERT INTO conversations(agent_id,title) VALUES(?,?)").run(agentId, WS_TITLE);
  return Number(r.lastInsertRowid);
}

/** Team-board key of a workspace session (legacy sessionless workspace → "ws:default"). */
function boardKeyFor(sessionId: unknown): string {
  return typeof sessionId === "number" ? `ws:${sessionId}` : "ws:default";
}

export async function POST(req: NextRequest) {
  const { message, agentIds, mode: rawMode, attachments, model, sessionId, workingDir } = await req.json();
  const mode: RunMode = ["approval", "act", "plan"].includes(rawMode) ? rawMode : "approval";
  const modelOverride = typeof model === "string" && model.trim() ? model.trim() : undefined;
  const wsDir = typeof workingDir === "string" && workingDir.trim() ? workingDir.trim() : undefined;
  const atts: Attachment[] = Array.isArray(attachments) ? attachments : [];
  if (!Array.isArray(agentIds) || agentIds.length === 0) {
    return Response.json({ error: "pick at least one agent" }, { status: 400 });
  }
  if (!hasSecret("aiApiKey")) {
    return Response.json({ error: "no_api_key" }, { status: 428 });
  }

  const displayContent = attachmentSummary(message, atts);
  if (atts.length > 0) {
    logger.info(`Workspace attachments received: ${atts.map((a) => `${a.name} (${a.kind}/${a.mediaType})`).join(", ")}`);
  }
  // One vision pass shared by ALL agents: photos are described by the vision
  // model once, and the text is appended to the content every agent receives.
  const userContent = await describeImagesWithVision(buildUserContent(message, atts), message);
  const meta = Array.isArray(userContent) ? JSON.stringify({ contentBlocks: userContent }) : null;

  const db = getDb();
  const encoder = new TextEncoder();

  // Runs must SURVIVE the page being closed: `send` swallows enqueue errors
  // after the client disconnects; every agent keeps working in the background
  // and its answer is still saved to its workspace conversation.
  let clientGone = false;
  const stream = new ReadableStream({
    async start(controller) {
      const send = (agentId: number, e: RunEvent) => {
        if (clientGone) return;
        try {
          controller.enqueue(encoder.encode(`data: ${JSON.stringify({ agentId, ...e })}\n\n`));
        } catch {
          clientGone = true; // stream cancelled — keep running, drop events
        }
      };

      const runs = (agentIds as number[]).map(async (agentId) => {
        const convId = wsConversation(agentId, typeof sessionId === "number" ? sessionId : undefined);
        db.prepare("INSERT INTO messages(conversation_id,role,content,meta) VALUES(?,?,?,?)")
          .run(convId, "user", displayContent, meta);
        const history = (db
          .prepare("SELECT role, content, meta FROM messages WHERE conversation_id=? AND role IN ('user','assistant') ORDER BY id")
          .all(convId) as any[])
          .map(rowToAiMessage);

        const boardKey = boardKeyFor(sessionId);
        // Registered so the watchdog can resume it if it dies before finishing.
        const run = startRun({ agentId, conversationId: convId, surface: "workspace", mode, workingDir: wsDir, boardKey, modelOverride });
        try {
          const finalText = await runAgent(agentId, history, (e) => send(agentId, e), 0, mode, {
            interactive: true,
            conversationId: convId,
            heartbeat: run.beat,
            // Team board shared by every agent of this workspace session.
            boardKey,
            ...(modelOverride ? { modelOverride } : {}),
            ...(wsDir ? { workingDir: wsDir } : {}),
          });
          db.prepare("INSERT INTO messages(conversation_id,role,content) VALUES(?,?,?)")
            .run(convId, "assistant", finalText || "(no answer)");
          run.complete();
          send(agentId, { type: "done", finalText });
        } catch (e: any) {
          run.fail(e);
          const errMsg = `Error: ${e?.message ?? e}`;
          // Save the error to the conversation so it persists across page reloads
          db.prepare("INSERT INTO messages(conversation_id,role,content) VALUES(?,?,?)")
            .run(convId, "assistant", errMsg);
          send(agentId, { type: "error", message: String(e?.message ?? e) });
        }
      });

      await Promise.allSettled(runs);
      try { controller.close(); } catch { /* already cancelled */ }
    },
    cancel() {
      clientGone = true; // user left the page — do NOT stop the runs
    },
  });

  return new Response(stream, {
    headers: {
      "content-type": "text/event-stream",
      "cache-control": "no-cache, no-transform",
      connection: "keep-alive",
      "x-accel-buffering": "no",
    },
  });
}
