/**
 * Anthropic-compatible client (Messages API) — baseUrl/apiKey/model come
 * from the config service. Works with any gateway that speaks the
 * Anthropic format.
 */
import { getConfig, getSecret } from "./config";
import { hasDocumentBlock } from "./attachments";
import { logger } from "./logger";

export type AiMessage = { role: "user" | "assistant"; content: any };
export type AiTool = {
  name: string;
  description: string;
  input_schema: Record<string, any>;
};

export class AiConfigError extends Error {}

function endpoint(baseUrl: string) {
  return baseUrl.replace(/\/+$/, "") + "/v1/messages";
}

export function humanizeAiError(status: number | null, detail: string, baseUrl: string, model: string): string {
  if (status === 401 || status === 403) return "The API key is invalid or has been revoked.";
  if (status === 404) {
    if (/model/i.test(detail)) return `Model '${model}' is not recognized by this endpoint.`;
    return `Endpoint not found at ${baseUrl} — check the base URL.`;
  }
  if (status === 429) return "Rate limit reached — try again in a moment.";
  if (status === 529 || status === 503) return "The AI server is overloaded — try again.";
  if (status === null) return `Could not reach ${baseUrl} — check your connection or gateway URL.`;
  return `Request failed (${status}): ${detail.slice(0, 200)}`;
}

export function getAiSettings() {
  const cfg = getConfig();
  const apiKey = getSecret("aiApiKey");
  return { baseUrl: cfg.ai.baseUrl, model: cfg.ai.model, apiKey };
}

/** One Messages API call (non-streaming) — used by the agent loop & tests. */
export async function callAi(opts: {
  system?: string;
  messages: AiMessage[];
  tools?: AiTool[];
  model?: string;
  maxTokens?: number;
  apiKeyOverride?: string;
  baseUrlOverride?: string;
}): Promise<any> {
  const { baseUrl, model, apiKey } = getAiSettings();
  const useKey = opts.apiKeyOverride ?? apiKey;
  const useBase = opts.baseUrlOverride ?? baseUrl;
  const useModel = opts.model ?? model;
  if (!useKey) throw new AiConfigError("The AI API key is not configured.");

  let res: Response;
  try {
    // Blok document (PDF) butuh header beta pada versi API tertentu.
    const headers: Record<string, string> = {
      "content-type": "application/json",
      "x-api-key": useKey,
      "anthropic-version": "2023-06-01",
    };
    if (hasDocumentBlock(opts.messages)) headers["anthropic-beta"] = "pdfs-2024-09-25";

    const body = JSON.stringify({
      model: useModel,
      max_tokens: opts.maxTokens ?? 40000,
      ...(opts.system ? { system: opts.system } : {}),
      messages: opts.messages,
      ...(opts.tools && opts.tools.length ? { tools: opts.tools } : {}),
    });

    // Retry up to 3x with exponential backoff on network errors
    const doFetch = () => fetch(endpoint(useBase), {
      method: "POST",
      headers,
      body,
      signal: AbortSignal.timeout(300_000), // 5 minutes
    });

    const MAX_RETRIES = 3;
    let lastErr: any;
    for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
      try {
        res = await doFetch();
        break; // success
      } catch (e: any) {
        lastErr = e;
        if (attempt < MAX_RETRIES - 1) {
          const delay = 2000 * Math.pow(2, attempt); // 2s, 4s, 8s
          logger.warn(`AI request failed (attempt ${attempt + 1}/${MAX_RETRIES}), retrying in ${delay}ms: ${e?.message}`);
          await new Promise((r) => setTimeout(r, delay));
        }
      }
    }
    if (!res!) throw lastErr;
  } catch (e: any) {
    throw new Error(humanizeAiError(null, String(e?.message ?? e), useBase, useModel));
  }

  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    throw new Error(humanizeAiError(res.status, detail, useBase, useModel));
  }
  return res.json();
}

/** List models available at the configured endpoint (Anthropic GET /v1/models). */
export async function listModels(): Promise<{ ok: boolean; models: string[]; error?: string }> {
  const { baseUrl, apiKey } = getAiSettings();
  if (!apiKey) return { ok: false, models: [], error: "The AI API key is not configured." };
  try {
    const res = await fetch(baseUrl.replace(/\/+$/, "") + "/v1/models?limit=100", {
      headers: { "x-api-key": apiKey, "anthropic-version": "2023-06-01" },
      signal: AbortSignal.timeout(15_000),
    });
    if (!res.ok) {
      const detail = await res.text().catch(() => "");
      return { ok: false, models: [], error: humanizeAiError(res.status, detail, baseUrl, "") };
    }
    const json: any = await res.json();
    // Anthropic returns { data: [{ id, display_name, ... }] }; gateways may
    // return { models: [...] } or a bare array of ids.
    const arr: any[] = Array.isArray(json?.data)
      ? json.data
      : Array.isArray(json?.models)
      ? json.models
      : Array.isArray(json)
      ? json
      : [];
    const models = arr
      .map((m) => (typeof m === "string" ? m : m?.id ?? m?.name))
      .filter((m): m is string => typeof m === "string" && m.length > 0);
    return { ok: true, models };
  } catch (e: any) {
    return { ok: false, models: [], error: humanizeAiError(null, String(e?.message ?? e), baseUrl, "") };
  }
}

/** Test connection — one tiny request (DESIGN 2.2). */
export async function testAiConnection(params: {
  baseUrl: string; apiKey: string; model: string;
}): Promise<{ ok: true; message: string } | { ok: false; message: string }> {
  try {
    await callAi({
      messages: [{ role: "user", content: "ping" }],
      maxTokens: 8,
      apiKeyOverride: params.apiKey,
      baseUrlOverride: params.baseUrl,
      model: params.model,
    });
    return { ok: true, message: `Connected — model ${params.model} is available` };
  } catch (e: any) {
    logger.warn(`AI connection test failed: ${e.message}`);
    return { ok: false, message: e.message };
  }
}
