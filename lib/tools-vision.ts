/**
 * Built-in read_image tool — lets ANY agent understand attached images, even
 * when its own chat model has no vision: the image is forwarded to a
 * vision-capable model (config `ai.visionModel`, recommended:
 * `mistralai/ministral-14b-instruct-2512` via the free NVIDIA NIM
 * endpoint) and the textual answer is returned as the tool result.
 *
 * The vision model is routed through the model→connection map, so it can live
 * on a different provider than the active one (e.g. NVIDIA while chatting
 * through 9router).
 */
import { callAi, AiTool, AiMessage } from "./ai";
import { getConfig } from "./config";
import { logger } from "./logger";

export const visionToolDef: AiTool = {
  name: "read_image",
  description:
    "Read and analyze an image the user attached in this conversation (photo, screenshot, diagram, …) " +
    "using a vision-capable model. Use this whenever you need to know what an attached image contains, " +
    "including extracting text (OCR). Ask a specific question for the best answer.",
  input_schema: {
    type: "object",
    properties: {
      question: {
        type: "string",
        description: "what you want to know about the image, e.g. 'describe it in detail' or 'extract all visible text'",
      },
      image_index: {
        type: "integer",
        minimum: 1,
        description: "which attached image to read (1 = first attached). Omit to use the most recent one.",
      },
    },
    required: ["question"],
  },
};

/**
 * Auto-vision at send time: when a user message contains image blocks, each
 * image is described IMMEDIATELY by the vision model (config `ai.visionModel`,
 * e.g. via NVIDIA NIM) and the description is appended as a text block right
 * after the image. The agent's chat model then "digests" that text — no
 * read_image round-trip needed, and it works with models/gateways that drop
 * image blocks. The augmented blocks are persisted in `messages.meta`, so the
 * vision model runs only once per image.
 *
 * Failures never block the chat: on error a short note is appended instead.
 */
export async function describeImagesWithVision(
  content: unknown[] | string,
  userMessage?: string
): Promise<unknown[] | string> {
  if (!Array.isArray(content)) return content;
  const imageCount = content.filter((b: any) => b?.type === "image").length;
  if (imageCount === 0) return content;

  const visionModel = getConfig().ai.visionModel?.trim() || undefined; // undefined → active default model
  const ask = (userMessage ?? "").trim();
  const prompt =
    "Describe this image in detail and extract any visible text verbatim." +
    (ask ? ` The user sent it with this message, so focus on what's relevant to it: "${ask}"` : "");

  const out: unknown[] = [];
  let n = 0;
  for (const b of content) {
    out.push(b);
    if ((b as any)?.type !== "image") continue;
    n++;
    try {
      logger.info(`auto-vision: describing image ${n}/${imageCount} → model=${visionModel ?? "(active default)"}`);
      const resp = await callAi({
        model: visionModel,
        maxTokens: 4000,
        usageSource: "vision",
        messages: [{ role: "user", content: [b, { type: "text", text: prompt }] as any }],
      });
      const text = (resp?.content ?? [])
        .filter((c: any) => c.type === "text")
        .map((c: any) => c.text)
        .join("\n")
        .trim();
      out.push({
        type: "text",
        text: `[Image ${n} — description from the vision model]\n${text || "(the vision model returned no text)"}`,
      });
    } catch (e: any) {
      logger.error(`auto-vision failed for image ${n}`, e);
      out.push({
        type: "text",
        text: `[Image ${n} — the vision model failed to read it: ${String(e?.message ?? e)}. Use the read_image tool if you need its contents.]`,
      });
    }
  }
  return out;
}

interface VisionInput {
  question?: string;
  image_index?: number;
}

export async function callVisionTool(history: AiMessage[], input: unknown): Promise<string> {
  const inp = (input ?? {}) as VisionInput;

  // Collect image blocks from user messages, in conversation order.
  const images: any[] = [];
  for (const m of history) {
    if (m.role !== "user" || !Array.isArray(m.content)) continue;
    for (const b of m.content as any[]) {
      if (b?.type === "image") images.push(b);
    }
  }
  if (images.length === 0) {
    return "No image found in this conversation — ask the user to attach one (📎).";
  }

  const idx =
    Number.isInteger(inp.image_index) && inp.image_index! >= 1 && inp.image_index! <= images.length
      ? inp.image_index! - 1
      : images.length - 1; // default: the most recent image

  const visionModel = getConfig().ai.visionModel?.trim() || undefined; // undefined → active default model
  const question = String(inp.question ?? "").trim() || "Describe this image in detail.";

  logger.info(`read_image: image ${idx + 1}/${images.length} → model=${visionModel ?? "(active default)"}`);

  const resp = await callAi({
    model: visionModel,
    maxTokens: 4000,
    usageSource: "vision",
    // image first, then the question — matches the payload order NIM expects
    messages: [{ role: "user", content: [images[idx], { type: "text", text: question }] }],
  });

  const text = (resp?.content ?? [])
    .filter((c: any) => c.type === "text")
    .map((c: any) => c.text)
    .join("\n")
    .trim();
  return text || "(the vision model returned no text)";
}
