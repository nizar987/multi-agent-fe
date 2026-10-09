/**
 * AI provider preset catalog — a curated list of known providers, ported from
 * 9router's provider registry (github.com/decolua/9router).
 *
 * The AI client (lib/ai.ts) already speaks three wire formats — anthropic,
 * openai and gemini — and reaches each endpoint by appending a fixed path
 * (/v1/messages, /v1/chat/completions, /v1beta/models/…) to a base URL.
 * These presets simply pre-fill that base URL, the correct wire format and a
 * few starter models, so connecting to another provider is one click instead
 * of hunting down the right host and API shape.
 *
 * `baseUrl` follows lib/ai.ts's joinUrl convention: it is the segment BEFORE
 * the endpoint path, and a single trailing /v1 (or /v1beta) is de-duplicated.
 * Only API-key providers with an OpenAI-/Anthropic-/Gemini-compatible surface
 * are included — 9router's OAuth, browser-cookie and media-only providers need
 * machinery this app doesn't have, so they're deliberately left out.
 */
import type { AiProvider } from "./ai";

export interface AiProviderPreset {
  /** Stable key used by the connection form's preset dropdown. */
  id: string;
  /** Human-readable name shown in the dropdown. */
  label: string;
  /** Wire format the AI client should speak to this endpoint. */
  format: AiProvider;
  /** Base URL in lib/ai.ts's joinUrl convention (endpoint path is appended). */
  baseUrl: string;
  /** Where the user obtains an API key. */
  apiKeyUrl?: string;
  /** Starter models — prefilled into the "Default model" field. */
  models: string[];
  /** True when the provider offers a usable free tier. */
  free?: boolean;
  /** Short hint shown under the picker. */
  note?: string;
}

export const AI_PROVIDER_PRESETS: AiProviderPreset[] = [
  {
    id: "anthropic",
    label: "Anthropic (Claude)",
    format: "anthropic",
    baseUrl: "https://api.anthropic.com",
    apiKeyUrl: "https://console.anthropic.com/settings/keys",
    models: ["claude-sonnet-4-20250514", "claude-opus-4-20250514", "claude-3-5-sonnet-20241022"],
  },
  {
    id: "openai",
    label: "OpenAI",
    format: "openai",
    baseUrl: "https://api.openai.com/v1",
    apiKeyUrl: "https://platform.openai.com/api-keys",
    models: ["gpt-4o", "gpt-4o-mini", "gpt-4.1", "o3", "o4-mini"],
  },
  {
    id: "gemini",
    label: "Google Gemini",
    format: "gemini",
    baseUrl: "https://generativelanguage.googleapis.com",
    apiKeyUrl: "https://aistudio.google.com/apikey",
    models: ["gemini-2.5-pro", "gemini-2.5-flash", "gemini-2.0-flash"],
  },
  {
    id: "openrouter",
    label: "OpenRouter",
    format: "openai",
    baseUrl: "https://openrouter.ai/api/v1",
    apiKeyUrl: "https://openrouter.ai/settings/keys",
    models: ["openai/gpt-4o", "anthropic/claude-3.5-sonnet", "deepseek/deepseek-chat", "meta-llama/llama-3.3-70b-instruct"],
    free: true,
    note: "Aggregator — hundreds of models, many free ones (no card needed).",
  },
  {
    id: "groq",
    label: "Groq",
    format: "openai",
    baseUrl: "https://api.groq.com/openai/v1",
    apiKeyUrl: "https://console.groq.com/keys",
    models: ["llama-3.3-70b-versatile", "openai/gpt-oss-120b", "qwen/qwen3-32b"],
    free: true,
  },
  {
    id: "deepseek",
    label: "DeepSeek",
    format: "openai",
    baseUrl: "https://api.deepseek.com/v1",
    apiKeyUrl: "https://platform.deepseek.com/api_keys",
    models: ["deepseek-chat", "deepseek-reasoner"],
  },
  {
    id: "xai",
    label: "xAI (Grok)",
    format: "openai",
    baseUrl: "https://api.x.ai/v1",
    apiKeyUrl: "https://console.x.ai",
    models: ["grok-4", "grok-4-fast-reasoning", "grok-code-fast-1", "grok-3"],
  },
  {
    id: "mistral",
    label: "Mistral",
    format: "openai",
    baseUrl: "https://api.mistral.ai/v1",
    apiKeyUrl: "https://console.mistral.ai/api-keys",
    models: ["mistral-large-latest", "mistral-medium-latest", "codestral-latest"],
  },
  {
    id: "moonshot",
    label: "Moonshot (Kimi)",
    format: "openai",
    baseUrl: "https://api.moonshot.ai/v1",
    apiKeyUrl: "https://platform.moonshot.ai/console/api-keys",
    models: ["kimi-k2-0711-preview", "moonshot-v1-128k", "moonshot-v1-32k"],
  },
  {
    id: "zai",
    label: "Z.AI (GLM)",
    format: "anthropic",
    baseUrl: "https://api.z.ai/api/anthropic",
    apiKeyUrl: "https://open.bigmodel.cn/usercenter/apikeys",
    models: ["glm-4.6", "glm-4.5", "glm-4.5-air"],
    note: "GLM coding models exposed over the Anthropic-compatible endpoint.",
  },
  {
    id: "together",
    label: "Together AI",
    format: "openai",
    baseUrl: "https://api.together.xyz/v1",
    apiKeyUrl: "https://api.together.xyz/settings/api-keys",
    models: ["meta-llama/Llama-3.3-70B-Instruct-Turbo", "deepseek-ai/DeepSeek-R1", "Qwen/Qwen3-235B-A22B"],
  },
  {
    id: "cerebras",
    label: "Cerebras",
    format: "openai",
    baseUrl: "https://api.cerebras.ai/v1",
    apiKeyUrl: "https://cloud.cerebras.ai/platform",
    models: ["llama-3.3-70b", "gpt-oss-120b", "qwen-3-32b"],
    free: true,
  },
  {
    id: "fireworks",
    label: "Fireworks AI",
    format: "openai",
    baseUrl: "https://api.fireworks.ai/inference/v1",
    apiKeyUrl: "https://fireworks.ai/account/api-keys",
    models: ["accounts/fireworks/models/deepseek-v3p1", "accounts/fireworks/models/llama-v3p3-70b-instruct", "accounts/fireworks/models/qwen3-235b-a22b"],
  },
  {
    id: "nvidia",
    label: "NVIDIA NIM",
    format: "openai",
    baseUrl: "https://integrate.api.nvidia.com/v1",
    apiKeyUrl: "https://build.nvidia.com/settings/api-keys",
    models: ["openai/gpt-oss-120b", "deepseek-ai/deepseek-r1", "meta/llama-3.3-70b-instruct", "qwen/qwen3-235b-a22b"],
    free: true,
    note: "openai/gpt-oss-120b supports reasoning_content for chain-of-thought outputs.",
  },
  {
    id: "siliconflow",
    label: "SiliconFlow",
    format: "openai",
    baseUrl: "https://api.siliconflow.com/v1",
    apiKeyUrl: "https://cloud.siliconflow.com/account/ak",
    models: ["deepseek-ai/DeepSeek-V3", "Qwen/Qwen2.5-72B-Instruct", "zai-org/GLM-4.5"],
  },
  {
    id: "nebius",
    label: "Nebius AI",
    format: "openai",
    baseUrl: "https://api.studio.nebius.ai/v1",
    apiKeyUrl: "https://studio.nebius.com/settings/api-keys",
    models: ["meta-llama/Llama-3.3-70B-Instruct", "deepseek-ai/DeepSeek-V3", "Qwen/Qwen3-235B-A22B"],
  },
  {
    id: "hyperbolic",
    label: "Hyperbolic",
    format: "openai",
    baseUrl: "https://api.hyperbolic.xyz/v1",
    apiKeyUrl: "https://app.hyperbolic.xyz/settings",
    models: ["deepseek-ai/DeepSeek-R1", "meta-llama/Llama-3.3-70B-Instruct", "Qwen/Qwen2.5-Coder-32B-Instruct"],
  },
  {
    id: "chutes",
    label: "Chutes AI",
    format: "openai",
    baseUrl: "https://llm.chutes.ai/v1",
    apiKeyUrl: "https://chutes.ai/app/api",
    models: ["deepseek-ai/DeepSeek-V3", "Qwen/Qwen3-235B-A22B"],
    free: true,
  },
  {
    id: "venice",
    label: "Venice AI",
    format: "openai",
    baseUrl: "https://api.venice.ai/api/v1",
    apiKeyUrl: "https://venice.ai/settings/api",
    models: ["llama-3.3-70b", "qwen3-235b-a22b-instruct-2507", "deepseek-v4-pro"],
  },
  {
    id: "genfity",
    label: "Genfity AI",
    format: "openai",
    baseUrl: "https://ai.genfity.com",
    models: ["genfity/claude-opus-4.8", "genfity/claude-sonnet-4", "genfity/gpt-4o"],
    note: "Genfity AI gateway — OpenAI-compatible endpoint.",
  },
  {
    // 9router (github.com/decolua/9router) — self-hosted router. Its documented
    // public API is OpenAI-compatible at http://localhost:20128/v1, so this is
    // the correct default. Model availability depends on your 9router plan.
    id: "9router",
    label: "9router (local · OpenAI format)",
    format: "openai",
    baseUrl: "http://localhost:20128/v1",
    apiKeyUrl: "http://localhost:20128/dashboard",
    models: [],
    note: "Local 9router proxy — OpenAI-compatible. Models depend on your 9router plan/accounts.",
  },
  {
    // Same router reached over its Anthropic-compatible surface (/v1/messages).
    id: "9router-anthropic",
    label: "9router (local · Anthropic format)",
    format: "anthropic",
    baseUrl: "http://localhost:20128/v1",
    apiKeyUrl: "http://localhost:20128/dashboard",
    models: [],
    note: "Local 9router proxy via the Anthropic-compatible endpoint (/v1/messages).",
  },
];

/** Look up a preset by its id. */
export function getProviderPreset(id: string): AiProviderPreset | undefined {
  return AI_PROVIDER_PRESETS.find((p) => p.id === id);
}
