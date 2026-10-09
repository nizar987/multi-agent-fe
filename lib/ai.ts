/**
 * Multi-provider AI client. Speaks three wire formats:
 *   - anthropic : Messages API (/v1/messages) — Claude, or Anthropic-compatible gateways
 *   - openai    : Chat Completions (/v1/chat/completions) — OpenAI, Kimi/Moonshot,
 *                 DeepSeek, OpenRouter, Groq, and other OpenAI-compatible gateways
 *   - gemini    : Google Generative Language API (:generateContent)
 *
 * Whatever the provider, responses are normalized to the Anthropic shape
 * ({ content: [{type:"text"|"tool_use"}], stop_reason }) so the agent runtime
 * works unchanged — including native tool calling and streaming.
 */
import { getConfig, getSecret, getConnectionSecret } from "./config";
import { getModelRoute } from "./model-routes";
import { hasDocumentBlock } from "./attachments";
import { logger } from "./logger";
import { recordUsage } from "./usage-db";
import { AI_PROVIDER_PRESETS } from "./ai-provider-presets";
import {
  promptCacheEnabled, disablePromptCache, isCacheRejection,
  joinSystem, anthropicSystem, withToolCache, withMessageCache,
} from "./prompt-cache";

export type AiMessage = { role: "user" | "assistant"; content: any };
export type AiTool = {
  name: string;
  description: string;
  input_schema: Record<string, any>;
};
export type AiProvider = "anthropic" | "openai" | "gemini";

export class AiConfigError extends Error {}

/* ------------------------------------------------------------------ */
/* Provider detection & endpoints                                      */
/* ------------------------------------------------------------------ */

export function detectProvider(baseUrl: string): AiProvider {
  const u = baseUrl.toLowerCase();
  // Gemini check first — hostname is unique enough.
  if (u.includes("generativelanguage") || u.includes("gemini")) return "gemini";
  // Match against known preset base URLs — most reliable signal because it
  // uses the exact same URL the user configured via the presets dropdown.
  for (const p of AI_PROVIDER_PRESETS) {
    if (u.startsWith(p.baseUrl.toLowerCase())) return p.format;
  }
  // Heuristic hostname matching as fallback for custom / unlisted endpoints.
  if (u.includes("anthropic")) return "anthropic";
  if (
    u.includes("openai") || u.includes("moonshot") || u.includes("kimi") ||
    u.includes("deepseek") || u.includes("openrouter") || u.includes("groq") ||
    u.includes("together") || u.includes("mistral") || u.includes("siliconflow") ||
    u.includes("dashscope") || u.includes("x.ai") || u.includes("cerebras") ||
    u.includes("fireworks") || u.includes("nebius") || u.includes("hyperbolic") ||
    u.includes("nvidia") || u.includes("chutes") || u.includes("venice") ||
    u.includes("perplexity") || u.includes("sambanova") || u.includes("genfity") ||
    u.includes("z.ai")
  ) return "openai";
  return "anthropic";
}

/** Join base + path without duplicating a trailing /v1 or /v1beta segment. */
function joinUrl(base: string, path: string): string {
  const b = base.replace(/\/+$/, "");
  const seg = path.match(/^\/(v1beta|v1)\//)?.[1];
  if (seg && b.endsWith(`/${seg}`)) return b + path.slice(seg.length + 1);
  return b + path;
}

export function humanizeAiError(status: number | null, detail: string, baseUrl: string, model: string): string {
  if (status === 401 || status === 403) {
    // Surface the upstream error body — "invalid api key" vs "wrong region" vs
    // "insufficient balance" need different fixes, so don't hide the detail.
    const hint = detail ? ` Server says: ${detail.slice(0, 200)}` : "";
    return `Authentication failed (${status}).${hint}`;
  }
  if (status === 404) {
    if (/model/i.test(detail)) return `Model '${model}' is not recognized by this endpoint.`;
    return `Endpoint not found at ${baseUrl} — check the base URL (and the provider setting).`;
  }
  if (status === 402) {
    // Payment/plan gate — the key is valid but the model isn't in the user's
    // plan (common with router gateways). Surface the upstream detail verbatim.
    const hint = detail ? ` Server says: ${detail.slice(0, 300)}` : "";
    return `Payment required (402) — model '${model}' isn't included in your plan, or your balance is empty. Pick a different model or top up.${hint}`;
  }
  if (status === 429) return "Rate limit reached — try again in a moment.";
  if (status === 529 || status === 503) return "The AI server is overloaded — try again.";
  if (status === null) return `Could not reach ${baseUrl} — check your connection or gateway URL.`;
  return `Request failed (${status}): ${detail.slice(0, 200)}`;
}

export function getAiSettings() {
  const cfg = getConfig();
  const apiKey = getSecret("aiApiKey");
  const provider: AiProvider =
    cfg.ai.provider && cfg.ai.provider !== "auto" ? cfg.ai.provider : detectProvider(cfg.ai.baseUrl);
  return { baseUrl: cfg.ai.baseUrl, model: cfg.ai.model, apiKey, provider };
}

/* ------------------------------------------------------------------ */
/* OpenAI format conversion                                            */
/* ------------------------------------------------------------------ */

function toOpenAiMessages(system: string | undefined, messages: AiMessage[]): any[] {
  const out: any[] = [];
  if (system) out.push({ role: "system", content: system });
  for (const m of messages) {
    if (typeof m.content === "string") { out.push({ role: m.role, content: m.content }); continue; }
    const blocks = m.content as any[];
    if (m.role === "assistant") {
      const text = blocks.filter((b) => b.type === "text").map((b) => b.text).join("\n");
      const toolCalls = blocks.filter((b) => b.type === "tool_use").map((b) => ({
        id: b.id,
        type: "function",
        function: { name: b.name, arguments: JSON.stringify(b.input ?? {}) },
      }));
      const msg: any = { role: "assistant", content: text || null };
      if (toolCalls.length) msg.tool_calls = toolCalls;
      out.push(msg);
    } else {
      // tool results must come first, each as its own `tool` message
      for (const b of blocks.filter((x) => x.type === "tool_result")) {
        out.push({
          role: "tool",
          tool_call_id: b.tool_use_id,
          content: typeof b.content === "string" ? b.content : JSON.stringify(b.content),
        });
      }
      const rest = blocks.filter((x) => x.type !== "tool_result");
      if (rest.length) {
        const parts = rest.map((b) => {
          if (b.type === "text") return { type: "text", text: b.text };
          if (b.type === "image" && b.source?.type === "base64")
            return { type: "image_url", image_url: { url: `data:${b.source.media_type};base64,${b.source.data}` } };
          if (b.type === "document")
            return { type: "text", text: "[PDF attachment omitted — this provider does not accept PDFs in chat]" };
          return { type: "text", text: "" };
        }).filter((p) => p.type !== "text" || p.text);
        if (parts.length === 0) continue;
        const onlyText = parts.every((p: any) => p.type === "text");
        // Image parts go FIRST (matches NVIDIA NIM's expected payload order:
        // [{type:"image_url"},{type:"text"}]); text order stays stable.
        const orderedParts = [
          ...parts.filter((p: any) => p.type === "image_url"),
          ...parts.filter((p: any) => p.type !== "image_url"),
        ];
        out.push({ role: "user", content: onlyText ? parts.map((p: any) => p.text).join("\n") : orderedParts });
      }
    }
  }
  return out;
}

function toOpenAiTools(tools?: AiTool[]): any[] | undefined {
  if (!tools?.length) return undefined;
  return tools.map((t) => ({
    type: "function",
    function: { name: t.name, description: t.description, parameters: t.input_schema },
  }));
}

function fromOpenAi(json: any): any {
  const choice = json.choices?.[0] ?? {};
  const msg = choice.message ?? {};
  const content: any[] = [];
  // Thinking models (Kimi k2.6, DeepSeek R1, …) may put the answer in
  // reasoning_content while content stays empty — fall back to it.
  const text = (typeof msg.content === "string" && msg.content)
    || (typeof msg.reasoning_content === "string" && msg.reasoning_content)
    || "";
  if (text) content.push({ type: "text", text });
  for (const tc of msg.tool_calls ?? []) {
    let input: any = {};
    try { input = JSON.parse(tc.function?.arguments || "{}"); } catch { /* keep {} */ }
    content.push({
      type: "tool_use",
      id: tc.id || `call_${Math.random().toString(36).slice(2, 10)}`,
      name: tc.function?.name,
      input,
    });
  }
  const hasTool = content.some((c) => c.type === "tool_use");
  return {
    content,
    stop_reason: choice.finish_reason === "tool_calls" || hasTool
      ? "tool_use"
      : choice.finish_reason === "length" ? "max_tokens" : "end_turn", // "length" = truncated output
  };
}

/* ------------------------------------------------------------------ */
/* Gemini format conversion                                            */
/* ------------------------------------------------------------------ */

const GEMINI_TYPES: Record<string, string> = {
  string: "STRING", number: "NUMBER", integer: "INTEGER",
  boolean: "BOOLEAN", array: "ARRAY", object: "OBJECT",
};

/** Gemini accepts an OpenAPI-style schema subset — strip anything else. */
function geminiSchema(s: any): any {
  if (!s || typeof s !== "object") return { type: "OBJECT" };
  const allowed = ["type", "format", "description", "nullable", "enum", "items", "properties", "required", "minimum", "maximum", "minItems", "maxItems"];
  const out: any = {};
  for (const k of allowed) if (s[k] !== undefined) out[k] = s[k];
  if (typeof out.type === "string") out.type = GEMINI_TYPES[out.type.toLowerCase()] ?? "OBJECT";
  if (out.properties && typeof out.properties === "object") {
    const props: any = {};
    for (const [k, v] of Object.entries(out.properties)) props[k] = geminiSchema(v);
    out.properties = props;
  }
  if (out.items) out.items = geminiSchema(out.items);
  return out;
}

function toGeminiBody(system: string | undefined, messages: AiMessage[], tools: AiTool[] | undefined, maxTokens: number): any {
  const idToName = new Map<string, string>();
  const contents: any[] = [];
  for (const m of messages) {
    const role = m.role === "assistant" ? "model" : "user";
    const parts: any[] = [];
    if (typeof m.content === "string") {
      if (m.content) parts.push({ text: m.content });
    } else {
      for (const b of m.content as any[]) {
        if (b.type === "text" && b.text) parts.push({ text: b.text });
        else if (b.type === "tool_use") {
          idToName.set(b.id, b.name);
          parts.push({ functionCall: { name: b.name, args: b.input ?? {} } });
        } else if (b.type === "tool_result") {
          const name = idToName.get(b.tool_use_id) ?? "tool";
          parts.push({
            functionResponse: {
              name,
              response: { result: typeof b.content === "string" ? b.content : JSON.stringify(b.content) },
            },
          });
        } else if ((b.type === "image" || b.type === "document") && b.source?.type === "base64") {
          parts.push({ inlineData: { mimeType: b.source.media_type ?? "application/pdf", data: b.source.data } });
        }
      }
    }
    if (parts.length) contents.push({ role, parts });
  }
  return {
    contents,
    ...(system ? { systemInstruction: { parts: [{ text: system }] } } : {}),
    ...(tools?.length
      ? { tools: [{ functionDeclarations: tools.map((t) => ({ name: t.name, description: t.description, parameters: geminiSchema(t.input_schema) })) }] }
      : {}),
    // Gemini rejects maxOutputTokens above the model limit — 8192 is safe everywhere.
    generationConfig: { maxOutputTokens: Math.min(maxTokens, 8192) },
  };
}

function fromGemini(json: any): any {
  const parts = json.candidates?.[0]?.content?.parts ?? [];
  const content: any[] = [];
  parts.forEach((p: any, i: number) => {
    if (typeof p.text === "string" && p.text) content.push({ type: "text", text: p.text });
    else if (p.functionCall) {
      content.push({
        type: "tool_use",
        id: `gem_${p.functionCall.name}_${i}_${Date.now()}`,
        name: p.functionCall.name,
        input: p.functionCall.args ?? {},
      });
    }
  });
  return {
    content,
    stop_reason: content.some((c) => c.type === "tool_use")
      ? "tool_use"
      : json.candidates?.[0]?.finishReason === "MAX_TOKENS" ? "max_tokens" : "end_turn",
  };
}

/* ------------------------------------------------------------------ */
/* Request building                                                    */
/* ------------------------------------------------------------------ */

interface CallOpts {
  /** Stable system prompt — cached across calls (prompt caching). */
  system?: string;
  /**
   * Per-run system text that changes between runs (journal, checklist, memory
   * notes). Sent AFTER the stable part so it does not invalidate its cache.
   */
  systemDynamic?: string;
  messages: AiMessage[];
  tools?: AiTool[];
  model?: string;
  maxTokens?: number;
  apiKeyOverride?: string;
  baseUrlOverride?: string;
  providerOverride?: AiProvider;
  /** Label recorded with token usage (agent | workspace | manager | vision | test). */
  usageSource?: string;
}

/**
 * input_tokens is the TOTAL prompt size (cached + uncached) for every provider;
 * cache_read_tokens / cache_write_tokens are the parts of it served from /
 * written to the provider's prompt cache.
 */
export interface TokenUsage {
  input_tokens: number;
  output_tokens: number;
  cache_read_tokens?: number;
  cache_write_tokens?: number;
}

/** Anthropic reports input_tokens EXCLUDING cache reads/writes — fold them in. */
function anthropicUsage(u: any): TokenUsage {
  const read = Number(u?.cache_read_input_tokens) || 0;
  const write = Number(u?.cache_creation_input_tokens) || 0;
  return {
    input_tokens: (Number(u?.input_tokens) || 0) + read + write,
    output_tokens: Number(u?.output_tokens) || 0,
    cache_read_tokens: read,
    cache_write_tokens: write,
  };
}

/** OpenAI-compatible cached prompt tokens (OpenAI/Kimi: prompt_tokens_details; DeepSeek: prompt_cache_hit_tokens). */
function openAiCachedTokens(u: any): number {
  return Number(u?.prompt_tokens_details?.cached_tokens) || Number(u?.prompt_cache_hit_tokens) || 0;
}

/** Pull token counts out of a provider's raw JSON response (best-effort). */
function extractUsage(provider: AiProvider, json: any): TokenUsage {
  if (!json || typeof json !== "object") return { input_tokens: 0, output_tokens: 0 };
  if (provider === "openai") {
    const u = json.usage ?? {};
    return {
      input_tokens: Number(u.prompt_tokens) || 0,
      output_tokens: Number(u.completion_tokens) || 0,
      cache_read_tokens: openAiCachedTokens(u),
    };
  }
  if (provider === "gemini") {
    const u = json.usageMetadata ?? {};
    return {
      input_tokens: Number(u.promptTokenCount) || 0,
      output_tokens: Number(u.candidatesTokenCount) || 0,
      cache_read_tokens: Number(u.cachedContentTokenCount) || 0,
    };
  }
  return anthropicUsage(json.usage ?? {});
}

/** Write a usage record for one completed call. Best-effort; never throws. */
function logUsage(req: { provider: AiProvider; model: string }, usage: TokenUsage | undefined, source?: string): void {
  if (!usage) return;
  recordUsage({
    provider: req.provider,
    model: req.model,
    source: source || "other",
    input_tokens: usage.input_tokens,
    output_tokens: usage.output_tokens,
    cache_read_tokens: usage.cache_read_tokens ?? 0,
    cache_write_tokens: usage.cache_write_tokens ?? 0,
  });
}

function resolveSettings(opts: CallOpts) {
  const { baseUrl, model, apiKey, provider } = getAiSettings();
  const maxTokens = opts.maxTokens ?? 40000;

  // Cross-provider model routing: when the requested model belongs to a saved
  // (non-active) AI connection, use that connection's endpoint & key.
  if (opts.model && !opts.baseUrlOverride && !opts.apiKeyOverride && !opts.providerOverride) {
    const route = getModelRoute(opts.model);
    if (route) {
      const routeKey = getConnectionSecret(route.connId);
      if (routeKey) {
        return { baseUrl: route.baseUrl, model: opts.model, apiKey: routeKey, provider: route.provider, maxTokens };
      }
    }
  }

  const useBase = opts.baseUrlOverride ?? baseUrl;
  return {
    baseUrl: useBase,
    model: opts.model ?? model,
    apiKey: opts.apiKeyOverride ?? apiKey,
    provider: opts.providerOverride ?? (opts.baseUrlOverride ? detectProvider(useBase) : provider),
    maxTokens,
  };
}

function buildRequest(opts: CallOpts, stream: boolean) {
  const { baseUrl, model, apiKey, provider, maxTokens } = resolveSettings(opts);
  // openai/gemini cache the longest matching prefix automatically — keeping the
  // stable system text first (dynamic part last) is all they need.
  const flatSystem = joinSystem(opts.system, opts.systemDynamic);
  if (!apiKey) throw new AiConfigError("The AI API key is not configured.");

  // Diagnostic: surface when vision content is being sent, and via which format.
  const imageCount = opts.messages.reduce(
    (n, m) => n + (Array.isArray(m.content) ? m.content.filter((b: any) => b?.type === "image" || b?.type === "document").length : 0),
    0
  );
  if (imageCount > 0) {
    logger.info(`AI request contains ${imageCount} image/document block(s) → provider=${provider}, model=${model}`);
  }

  if (provider === "openai") {
    const oaHeaders: Record<string, string> = { "content-type": "application/json", authorization: `Bearer ${apiKey}` };
    return {
      provider, baseUrl, model, cached: false,
      url: joinUrl(baseUrl, "/v1/chat/completions"),
      headers: oaHeaders,
      body: {
        model,
        // OpenAI-compatible endpoints (OpenAI, Kimi/Moonshot, …) reject
        // max_tokens above the model's output limit — 16384 is safe everywhere.
        max_tokens: Math.min(maxTokens, 16384),
        messages: toOpenAiMessages(flatSystem, opts.messages),
        ...(toOpenAiTools(opts.tools) ? { tools: toOpenAiTools(opts.tools) } : {}),
        // Ask for a final usage chunk so token counts are captured while streaming.
        ...(stream ? { stream: true, stream_options: { include_usage: true } } : {}),
      },
    };
  }

  if (provider === "gemini") {
    const method = stream ? ":streamGenerateContent?alt=sse" : ":generateContent";
    const gmHeaders: Record<string, string> = { "content-type": "application/json", "x-goog-api-key": apiKey };
    return {
      provider, baseUrl, model, cached: false,
      url: joinUrl(baseUrl, `/v1beta/models/${encodeURIComponent(model)}${method}`),
      headers: gmHeaders,
      body: toGeminiBody(flatSystem, opts.messages, opts.tools, maxTokens),
    };
  }

  // anthropic (default)
  // Send both auth styles: the official API reads x-api-key, while local
  // routers (9router, claude-code-router, …) expect ANTHROPIC_AUTH_TOKEN
  // as `Authorization: Bearer`. Anthropic ignores the extra header.
  const headers: Record<string, string> = {
    "content-type": "application/json",
    "x-api-key": apiKey,
    authorization: `Bearer ${apiKey}`,
    "anthropic-version": "2023-06-01",
  };
  if (hasDocumentBlock(opts.messages)) headers["anthropic-beta"] = "pdfs-2024-09-25";
  // Prompt caching: breakpoints on the tool list, the stable system text and
  // the latest message (≤4 allowed; we use 3). Skipped when this endpoint
  // already rejected cache_control once.
  const cached = promptCacheEnabled(baseUrl);
  const tools = opts.tools && opts.tools.length ? (cached ? withToolCache(opts.tools) : opts.tools) : undefined;
  const system = cached ? anthropicSystem(opts.system, opts.systemDynamic) : flatSystem;
  return {
    provider, baseUrl, model, cached,
    url: joinUrl(baseUrl, "/v1/messages"),
    headers,
    body: {
      model,
      max_tokens: maxTokens,
      ...(system ? { system } : {}),
      messages: cached ? withMessageCache(opts.messages) : opts.messages,
      ...(tools ? { tools } : {}),
      ...(stream ? { stream: true } : {}),
    },
  };
}

async function fetchWithRetry(url: string, init: RequestInit, baseUrl: string, model: string): Promise<Response> {
  const MAX_RETRIES = 3;
  let lastErr: unknown;
  for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
    try {
      return await fetch(url, { ...init, signal: AbortSignal.timeout(300_000) }); // 5 minutes
    } catch (e: unknown) {
      lastErr = e;
      if (attempt < MAX_RETRIES - 1) {
        const delay = 2000 * Math.pow(2, attempt); // 2s, 4s, 8s
        logger.warn(`AI request failed (attempt ${attempt + 1}/${MAX_RETRIES}), retrying in ${delay}ms: ${e instanceof Error ? e.message : e}`);
        await new Promise((r) => setTimeout(r, delay));
      }
    }
  }
  throw new Error(humanizeAiError(null, lastErr instanceof Error ? lastErr.message : String(lastErr), baseUrl, model));
}

/**
 * NVIDIA NIM async pattern: a POST may answer `202 Accepted` with an
 * `NVCF-REQID` header instead of the result. The result must then be fetched
 * via GET {base}/v1/status/{requestId}, polling while it keeps returning 202.
 */
async function resolve202(first: Response, baseUrl: string, headers: Record<string, string>): Promise<Response> {
  if (first.status !== 202) return first;
  const reqId = first.headers.get("nvcf-reqid") ?? first.headers.get("NVCF-REQID");
  if (!reqId) return first; // nothing to poll — let the caller surface it
  logger.info(`AI request accepted async (202) — polling /v1/status/${reqId}`);

  const pollHeaders: Record<string, string> = { accept: "application/json" };
  if (headers.authorization) pollHeaders.authorization = headers.authorization;
  if (headers["x-api-key"]) pollHeaders["x-api-key"] = headers["x-api-key"];

  const deadline = Date.now() + 300_000; // 5 minutes, same budget as the request itself
  while (Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, 1200));
    const res = await fetch(joinUrl(baseUrl, `/v1/status/${encodeURIComponent(reqId)}`), {
      headers: pollHeaders,
      signal: AbortSignal.timeout(60_000),
    });
    if (res.status !== 202) return res; // done (200) or a real error
  }
  throw new Error(`The AI request is still pending after 5 minutes (requestId ${reqId}).`);
}

function normalize(provider: AiProvider, json: any): any {
  if (provider === "openai") return fromOpenAi(json);
  if (provider === "gemini") return fromGemini(json);
  return json; // anthropic is already the canonical shape
}

/* ------------------------------------------------------------------ */
/* Non-streaming call                                                  */
/* ------------------------------------------------------------------ */

/**
 * Build + send one request and return the successful response. When the
 * endpoint rejects prompt-caching fields, caching is switched off for that
 * base URL and the request is re-sent once without them.
 */
async function sendRequest(opts: CallOpts, stream: boolean): Promise<{ req: ReturnType<typeof buildRequest>; res: Response }> {
  for (let attempt = 0; ; attempt++) {
    const req = buildRequest(opts, stream);
    const headers = stream ? { ...req.headers, accept: "text/event-stream" } : req.headers;
    let res = await fetchWithRetry(
      req.url,
      { method: "POST", headers, body: JSON.stringify(req.body) },
      req.baseUrl, req.model
    );
    // NVIDIA NIM may answer 202 → poll for the final (non-streamed) result.
    res = await resolve202(res, req.baseUrl, req.headers);
    if (res.ok && res.status !== 202) return { req, res };

    const detail = await res.text().catch(() => "");
    if (req.cached && attempt === 0 && isCacheRejection(res.status, detail)) {
      disablePromptCache(req.baseUrl, detail);
      continue;
    }
    throw new Error(humanizeAiError(res.status, detail, req.baseUrl, req.model));
  }
}

/** One AI call (non-streaming) — response normalized to the Anthropic shape. */
export async function callAi(opts: CallOpts): Promise<any> {
  const { req, res } = await sendRequest(opts, false);
  const json = await res.json();
  logUsage(req, extractUsage(req.provider, json), opts.usageSource);
  return normalize(req.provider, json);
}

/* ------------------------------------------------------------------ */
/* Streaming call                                                      */
/* ------------------------------------------------------------------ */

/**
 * Streaming AI call — parses each provider's SSE format, calls `onText` with
 * the accumulated text after every delta, and returns the assembled response
 * in the Anthropic shape ({ content, stop_reason }).
 * Falls back transparently when the gateway replies with plain JSON.
 */
export async function callAiStream(opts: CallOpts & { onText?: (fullText: string) => void }): Promise<any> {
  const { req, res } = await sendRequest(opts, true);

  // Some gateways ignore `stream` and reply with plain JSON — handle both.
  const ctype = res.headers.get("content-type") ?? "";
  if (!ctype.includes("event-stream")) {
    const json = await res.json();
    logUsage(req, extractUsage(req.provider, json), opts.usageSource);
    const normalized = normalize(req.provider, json);
    const t = (normalized.content ?? []).filter((c: any) => c.type === "text").map((c: any) => c.text).join("\n");
    if (t && opts.onText) opts.onText(t);
    return normalized;
  }

  const events = sseEvents(res.body!);
  const result =
    req.provider === "openai" ? await streamOpenAi(events, opts.onText)
    : req.provider === "gemini" ? await streamGemini(events, opts.onText)
    : await streamAnthropic(events, opts.onText, req.baseUrl, req.model);
  logUsage(req, result.usage, opts.usageSource);
  return result;
}

/** Async iterator over `data:` payloads of an SSE byte stream. */
async function* sseEvents(body: ReadableStream<Uint8Array>): AsyncGenerator<any> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buf = "";
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += decoder.decode(value, { stream: true });
    const chunks = buf.split("\n\n");
    buf = chunks.pop() ?? "";
    for (const chunk of chunks) {
      const dataLine = chunk.split("\n").find((l) => l.startsWith("data:"));
      if (!dataLine) continue;
      const payload = dataLine.slice(5).trim();
      if (!payload || payload === "[DONE]") continue;
      try { yield JSON.parse(payload); } catch { /* skip malformed chunk */ }
    }
  }
}

async function streamAnthropic(events: AsyncGenerator<any>, onText?: (t: string) => void, baseUrl = "", model = ""): Promise<any> {
  const content: any[] = [];
  const partialJson: Record<number, string> = {};
  let stopReason: string | null = null;
  let usage: TokenUsage = { input_tokens: 0, output_tokens: 0 };

  const emitText = () => {
    if (!onText) return;
    const t = content.filter((c) => c?.type === "text").map((c) => c.text).join("\n");
    if (t) onText(t);
  };

  for await (const ev of events) {
    if (ev.type === "message_start") {
      const u = ev.message?.usage;
      if (u) usage = anthropicUsage(u);
    } else if (ev.type === "content_block_start") {
      content[ev.index] = { ...ev.content_block };
      if (ev.content_block?.type === "tool_use") {
        content[ev.index].input = ev.content_block.input ?? {};
        partialJson[ev.index] = "";
      }
    } else if (ev.type === "content_block_delta") {
      if (ev.delta?.type === "text_delta") {
        if (!content[ev.index]) content[ev.index] = { type: "text", text: "" };
        content[ev.index].text = (content[ev.index].text ?? "") + ev.delta.text;
        emitText();
      } else if (ev.delta?.type === "input_json_delta") {
        partialJson[ev.index] = (partialJson[ev.index] ?? "") + ev.delta.partial_json;
      }
    } else if (ev.type === "content_block_stop") {
      const block = content[ev.index];
      if (block?.type === "tool_use" && partialJson[ev.index] !== undefined) {
        try { block.input = partialJson[ev.index] ? JSON.parse(partialJson[ev.index]) : {}; }
        catch { /* keep {} — the agent loop reports the tool error */ }
      }
    } else if (ev.type === "message_delta") {
      if (ev.delta?.stop_reason) stopReason = ev.delta.stop_reason;
      // Anthropic reports the running output token count on message_delta.
      if (ev.usage?.output_tokens) usage.output_tokens = Number(ev.usage.output_tokens) || usage.output_tokens;
    } else if (ev.type === "error") {
      throw new Error(humanizeAiError(null, ev.error?.message ?? "stream error", baseUrl, model));
    }
  }
  return { content: content.filter(Boolean), stop_reason: stopReason, usage };
}

async function streamOpenAi(events: AsyncGenerator<any>, onText?: (t: string) => void): Promise<any> {
  let text = "";
  let reasoning = "";
  let finish: string | null = null;
  const usage: TokenUsage = { input_tokens: 0, output_tokens: 0 };
  const toolAcc: Record<number, { id: string; name: string; args: string }> = {};

  for await (const ev of events) {
    // With stream_options.include_usage the final chunk carries usage and an
    // empty choices array — capture it before the `!choice` skip below.
    if (ev.usage) {
      usage.input_tokens = Number(ev.usage.prompt_tokens) || usage.input_tokens;
      usage.output_tokens = Number(ev.usage.completion_tokens) || usage.output_tokens;
      usage.cache_read_tokens = openAiCachedTokens(ev.usage) || usage.cache_read_tokens;
    }
    const choice = ev.choices?.[0];
    if (!choice) continue;
    if (choice.finish_reason) finish = choice.finish_reason;
    const delta = choice.delta ?? {};
    if (typeof delta.content === "string" && delta.content) {
      text += delta.content;
      if (onText) onText(text);
    }
    // Thinking models stream their reasoning separately — keep it as a
    // fallback in case no regular content ever arrives.
    if (typeof delta.reasoning_content === "string" && delta.reasoning_content) {
      reasoning += delta.reasoning_content;
    }
    for (const tc of delta.tool_calls ?? []) {
      const idx = tc.index ?? 0;
      const acc = (toolAcc[idx] ??= { id: "", name: "", args: "" });
      if (tc.id) acc.id = tc.id;
      if (tc.function?.name) acc.name += tc.function.name;
      if (tc.function?.arguments) acc.args += tc.function.arguments;
    }
  }

  if (!text && reasoning) {
    text = reasoning;
    if (onText) onText(text);
  }
  const content: any[] = [];
  if (text) content.push({ type: "text", text });
  for (const acc of Object.values(toolAcc)) {
    let input: any = {};
    try { input = JSON.parse(acc.args || "{}"); } catch { /* keep {} */ }
    content.push({
      type: "tool_use",
      id: acc.id || `call_${Math.random().toString(36).slice(2, 10)}`,
      name: acc.name,
      input,
    });
  }
  const hasTool = content.some((c) => c.type === "tool_use");
  return {
    content,
    stop_reason: finish === "tool_calls" || hasTool
      ? "tool_use"
      : finish === "length" ? "max_tokens" : "end_turn", // "length" = truncated output
    usage,
  };
}

async function streamGemini(events: AsyncGenerator<any>, onText?: (t: string) => void): Promise<any> {
  let text = "";
  const calls: { name: string; args: any }[] = [];
  const usage: TokenUsage = { input_tokens: 0, output_tokens: 0 };
  let finishReason = "";

  for await (const ev of events) {
    if (ev.usageMetadata) {
      usage.input_tokens = Number(ev.usageMetadata.promptTokenCount) || usage.input_tokens;
      usage.output_tokens = Number(ev.usageMetadata.candidatesTokenCount) || usage.output_tokens;
      usage.cache_read_tokens = Number(ev.usageMetadata.cachedContentTokenCount) || usage.cache_read_tokens;
    }
    if (ev.candidates?.[0]?.finishReason) finishReason = ev.candidates[0].finishReason;
    const parts = ev.candidates?.[0]?.content?.parts ?? [];
    for (const p of parts) {
      if (typeof p.text === "string" && p.text) {
        text += p.text;
        if (onText) onText(text);
      } else if (p.functionCall) {
        calls.push({ name: p.functionCall.name, args: p.functionCall.args ?? {} });
      }
    }
  }

  const content: any[] = [];
  if (text) content.push({ type: "text", text });
  calls.forEach((c, i) =>
    content.push({ type: "tool_use", id: `gem_${c.name}_${i}_${Date.now()}`, name: c.name, input: c.args })
  );
  return {
    content,
    stop_reason: content.some((c) => c.type === "tool_use")
      ? "tool_use"
      : finishReason === "MAX_TOKENS" ? "max_tokens" : "end_turn",
    usage,
  };
}

/* ------------------------------------------------------------------ */
/* Model listing & connection test                                     */
/* ------------------------------------------------------------------ */

/** List models available at the configured (active) endpoint. */
export async function listModels(): Promise<{ ok: boolean; models: string[]; error?: string }> {
  const { baseUrl, apiKey, provider } = getAiSettings();
  if (!apiKey) return { ok: false, models: [], error: "The AI API key is not configured." };
  return listModelsFor({ baseUrl, apiKey, provider });
}

/** List models at an arbitrary endpoint (used to aggregate all saved AI connections). */
export async function listModelsFor(params: {
  baseUrl: string; apiKey: string; provider: AiProvider;
}): Promise<{ ok: boolean; models: string[]; error?: string }> {
  const { baseUrl, apiKey, provider } = params;
  try {
    let url: string;
    let headers: Record<string, string>;
    if (provider === "openai") {
      url = joinUrl(baseUrl, "/v1/models");
      headers = { authorization: `Bearer ${apiKey}` };
    } else if (provider === "gemini") {
      url = joinUrl(baseUrl, "/v1beta/models?pageSize=200");
      headers = { "x-goog-api-key": apiKey };
    } else {
      url = joinUrl(baseUrl, "/v1/models?limit=100");
      headers = { "x-api-key": apiKey, "anthropic-version": "2023-06-01" };
    }
    const res = await fetch(url, { headers, signal: AbortSignal.timeout(15_000) });
    if (!res.ok) {
      const detail = await res.text().catch(() => "");
      return { ok: false, models: [], error: humanizeAiError(res.status, detail, baseUrl, "") };
    }
    const json: any = await res.json();
    // anthropic/openai: { data: [{id}] } · gemini: { models: [{name:"models/…"}] } · gateways: bare arrays
    const arr: any[] = Array.isArray(json?.data) ? json.data
      : Array.isArray(json?.models) ? json.models
      : Array.isArray(json) ? json : [];
    const models = arr
      .map((m) => (typeof m === "string" ? m : m?.id ?? m?.name))
      .filter((m): m is string => typeof m === "string" && m.length > 0)
      .map((m) => m.replace(/^models\//, ""));
    return { ok: true, models };
  } catch (e: unknown) {
    return { ok: false, models: [], error: humanizeAiError(null, e instanceof Error ? e.message : String(e), baseUrl, "") };
  }
}

/** 24×24 solid-red PNG used by the vision passthrough test. */
const VISION_TEST_PNG =
  "iVBORw0KGgoAAAANSUhEUgAAABgAAAAYCAIAAABvFaqvAAAAIElEQVR4nGP8z0AdwEQlc0YNGjVo1KBRg0YNGjWIAgAAe6oBL3tV+KMAAAAASUVORK5CYII=";

/**
 * Vision passthrough test — sends a tiny red image and asks the model what it
 * sees. Catches gateways that advertise vision but silently drop image blocks:
 * in that case the model reports seeing no image at all.
 */
export async function testAiVision(params: {
  baseUrl: string; apiKey: string; model: string; provider?: AiProvider;
}): Promise<{ ok: boolean; message: string }> {
  try {
    const resp = await callAi({
      messages: [{
        role: "user",
        content: [
          { type: "text", text: "How many images are attached to this message, and what solid color is it? Answer in the form: <count> <color>" },
          { type: "image", source: { type: "base64", media_type: "image/png", data: VISION_TEST_PNG } },
        ],
      }],
      maxTokens: 50,
      usageSource: "test",
      apiKeyOverride: params.apiKey,
      baseUrlOverride: params.baseUrl,
      model: params.model,
      ...(params.provider ? { providerOverride: params.provider } : {}),
    });
    const text = (resp?.content ?? [])
      .filter((c: any) => c.type === "text")
      .map((c: any) => c.text)
      .join(" ")
      .toLowerCase();
    if (/\b(1|one|satu)\b/.test(text) && /\b(red|merah)\b/.test(text)) {
      return { ok: true, message: "vision OK — the model saw the test image" };
    }
    if (/\b(0|zero|no image|tidak ada|can't see|cannot see)\b/.test(text)) {
      return { ok: false, message: "vision FAILED — the image was dropped before reaching the model (gateway does not pass images through)" };
    }
    return { ok: false, message: `vision unclear — model replied: "${text.slice(0, 120)}"` };
  } catch (e: unknown) {
    return { ok: false, message: `vision test error: ${e instanceof Error ? e.message : String(e)}` };
  }
}

/** Test connection — one tiny request (DESIGN 2.2). */
export async function testAiConnection(params: {
  baseUrl: string; apiKey: string; model: string; provider?: AiProvider;
}): Promise<{ ok: true; message: string } | { ok: false; message: string }> {
  try {
    await callAi({
      messages: [{ role: "user", content: "ping" }],
      maxTokens: 8,
      usageSource: "test",
      apiKeyOverride: params.apiKey,
      baseUrlOverride: params.baseUrl,
      model: params.model,
      ...(params.provider ? { providerOverride: params.provider } : {}),
    });
    return { ok: true, message: `Connected — model ${params.model} is available` };
  } catch (e: any) {
    logger.warn(`AI connection test failed: ${e.message}`);
    return { ok: false, message: e.message };
  }
}
