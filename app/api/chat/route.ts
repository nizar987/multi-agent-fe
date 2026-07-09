/**
 * POST /api/chat — SSE stream event agent runtime.
 * Body: { conversationId, message, mode? }
 */
import { NextRequest } from "next/server";
import { getDb } from "@/lib/db";
import { runAgent, RunEvent, RunMode } from "@/lib/agent-runtime";
import { hasSecret } from "@/lib/config";
import type { AiMessage } from "@/lib/ai";
import { logger } from "@/lib/logger";
import { Attachment, buildUserContent, attachmentSummary } from "@/lib/attachments";
import { describeImagesWithVision } from "@/lib/tools-vision";

export const dynamic = "force-dynamic";

/** Bangun ulang AiMessage dari baris DB: pakai blok di meta bila ada. */
function rowToAiMessage(m: { role: string; content: string; meta: string | null }): AiMessage {
  if (m.meta) {
    try {
      const parsed = JSON.parse(m.meta);
      if (parsed?.contentBlocks) return { role: m.role as any, content: parsed.contentBlocks };
    } catch { /* fallback ke teks */ }
  }
  return { role: m.role as any, content: m.content };
}

export async function POST(req: NextRequest) {
  const { conversationId, message, mode: rawMode, attachments, model } = await req.json();
  const mode: RunMode = ["approval", "act", "plan"].includes(rawMode) ? rawMode : "approval";
  const modelOverride = typeof model === "string" && model.trim() ? model.trim() : undefined;
  const atts: Attachment[] = Array.isArray(attachments) ? attachments : [];
  const db = getDb();
  const conv = db.prepare("SELECT * FROM conversations WHERE id=?").get(conversationId) as any;
  if (!conv) return new Response("conversation not found", { status: 404 });

  if (!hasSecret("aiApiKey")) {
    return Response.json({ error: "no_api_key" }, { status: 428 });
  }

  const displayContent = attachmentSummary(message, atts);
  if (atts.length > 0) {
    logger.info(`Chat attachments received: ${atts.map((a) => `${a.name} (${a.kind}/${a.mediaType})`).join(", ")}`);
  }
  // Photos are read by the vision model right away; its description is appended
  // as a text block so the agent's own model can digest it.
  const userContent = await describeImagesWithVision(buildUserContent(message, atts), message);
  const meta = Array.isArray(userContent) ? JSON.stringify({ contentBlocks: userContent }) : null;

  db.prepare("INSERT INTO messages(conversation_id,role,content,meta) VALUES(?,?,?,?)")
    .run(conversationId, "user", displayContent, meta);

  // conversation title from the first message
  const msgCount = (db.prepare("SELECT COUNT(*) c FROM messages WHERE conversation_id=?").get(conversationId) as any).c;
  if (msgCount === 1) {
    db.prepare("UPDATE conversations SET title=? WHERE id=?")
      .run((message || displayContent).slice(0, 60), conversationId);
  }

  const history = (db
    .prepare("SELECT role, content, meta FROM messages WHERE conversation_id=? AND role IN ('user','assistant') ORDER BY id")
    .all(conversationId) as any[])
    .map(rowToAiMessage);

  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      const send = (e: RunEvent) =>
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(e)}\n\n`));
      try {
        logger.info(`Chat started: conv=${conversationId}, agent=${conv.agent_id}, mode=${mode}`);
        const finalText = await runAgent(conv.agent_id, history, send, 0, mode, { interactive: true, ...(modelOverride ? { modelOverride } : {}) });
        db.prepare("INSERT INTO messages(conversation_id,role,content) VALUES(?,?,?)")
          .run(conversationId, "assistant", finalText || "(no answer)");
        send({ type: "done", finalText });
      } catch (e: any) {
        logger.error(`Chat error: conv=${conversationId}`, e);
        send({ type: "error", message: String(e?.message ?? e) });
      } finally {
        controller.close();
      }
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
