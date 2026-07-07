/**
 * Tavily tools via REST API — web search, page extraction, crawling and
 * site mapping optimized for LLM agents. Same shape as tools-github.ts:
 * a set of AiTool defs plus a single dispatch function. Reads the
 * `tavilyApiKey` secret through the config gateway.
 *
 * Docs: https://docs.tavily.com/documentation/api-reference
 */
import { getSecret } from "./config";
import type { AiTool } from "./ai";

const BASE = "https://api.tavily.com";
const MAX_CHARS = 40_000;

async function tavily(pathname: string, body: unknown): Promise<any> {
  const key = getSecret("tavilyApiKey");
  if (!key) throw new Error("Tavily API key is not configured.");
  const res = await fetch(`${BASE}${pathname}`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${key}`,
      "content-type": "application/json",
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(60_000),
  });
  if (res.status === 401) throw new Error("Tavily API key is invalid or missing.");
  if (res.status === 429) throw new Error("Tavily rate limit exceeded — slow down requests.");
  if (res.status === 432 || res.status === 433) throw new Error("Tavily usage/plan limit exceeded.");
  if (!res.ok) {
    let detail = "";
    try { detail = (await res.json())?.detail?.error ?? ""; } catch { /* ignore */ }
    throw new Error(`Tavily API error ${res.status}${detail ? `: ${detail}` : ""}`);
  }
  return res.json();
}

export const tavilyToolDefs: AiTool[] = [
  {
    name: "tavily_search",
    description:
      "Search the web with Tavily, a search engine optimized for LLMs. Returns ranked results (title, URL, content snippet) and optionally a short generated answer.",
    input_schema: {
      type: "object",
      properties: {
        query: { type: "string", description: "The search query." },
        search_depth: {
          type: "string",
          enum: ["basic", "advanced", "fast", "ultra-fast"],
          description: "Latency vs. relevance tradeoff. 'advanced' costs 2 credits; others 1.",
        },
        topic: {
          type: "string",
          enum: ["general", "news", "finance"],
          description: "Search category. 'news' for real-time current events.",
        },
        max_results: { type: "number", description: "Max results to return (0-20, default 5)." },
        time_range: {
          type: "string",
          enum: ["day", "week", "month", "year"],
          description: "Filter results by how recently they were published/updated.",
        },
        include_answer: {
          type: "boolean",
          description: "Include a short LLM-generated answer to the query.",
        },
        include_domains: {
          type: "array",
          items: { type: "string" },
          description: "Only include results from these domains.",
        },
        exclude_domains: {
          type: "array",
          items: { type: "string" },
          description: "Exclude results from these domains.",
        },
      },
      required: ["query"],
    },
  },
  {
    name: "tavily_extract",
    description:
      "Extract the cleaned, parsed content of one or more web pages (up to 20 URLs) using Tavily Extract.",
    input_schema: {
      type: "object",
      properties: {
        urls: {
          type: "array",
          items: { type: "string" },
          description: "The URLs to extract content from (max 20).",
        },
        extract_depth: {
          type: "string",
          enum: ["basic", "advanced"],
          description: "'advanced' retrieves more (tables/embedded content) at higher latency/cost.",
        },
        format: {
          type: "string",
          enum: ["markdown", "text"],
          description: "Output format for extracted content (default markdown).",
        },
      },
      required: ["urls"],
    },
  },
  {
    name: "tavily_crawl",
    description:
      "Crawl a website starting from a base URL, following links and extracting page content. Optionally guided by natural-language instructions.",
    input_schema: {
      type: "object",
      properties: {
        url: { type: "string", description: "The root URL to begin the crawl." },
        instructions: {
          type: "string",
          description: "Natural-language guidance for what pages to find (e.g. 'pages about the Python SDK').",
        },
        max_depth: { type: "number", description: "How far from the base URL to explore (1-5, default 1)." },
        max_breadth: { type: "number", description: "Max links to follow per page (default 20)." },
        limit: { type: "number", description: "Total links to process before stopping (default 50)." },
        select_paths: {
          type: "array",
          items: { type: "string" },
          description: "Regex path patterns to include (e.g. '/docs/.*').",
        },
        extract_depth: {
          type: "string",
          enum: ["basic", "advanced"],
          description: "Extraction depth for crawled pages.",
        },
      },
      required: ["url"],
    },
  },
  {
    name: "tavily_map",
    description:
      "Map a website's structure starting from a base URL. Returns a list of discovered URLs without extracting full page content.",
    input_schema: {
      type: "object",
      properties: {
        url: { type: "string", description: "The root URL to begin mapping." },
        instructions: {
          type: "string",
          description: "Natural-language guidance for which pages to discover.",
        },
        max_depth: { type: "number", description: "How far from the base URL to explore (1-5, default 1)." },
        max_breadth: { type: "number", description: "Max links to follow per page (default 20)." },
        limit: { type: "number", description: "Total links to process before stopping (default 50)." },
        select_paths: {
          type: "array",
          items: { type: "string" },
          description: "Regex path patterns to include (e.g. '/docs/.*').",
        },
      },
      required: ["url"],
    },
  },
];

function clip(s: string): string {
  return s.length > MAX_CHARS ? `${s.slice(0, MAX_CHARS)}\n…(truncated)` : s;
}

export async function callTavilyTool(name: string, args: any): Promise<string> {
  switch (name) {
    case "tavily_search": {
      const d: any = await tavily("/search", {
        query: args.query,
        search_depth: args.search_depth ?? "basic",
        topic: args.topic ?? "general",
        max_results: args.max_results ?? 5,
        time_range: args.time_range ?? undefined,
        include_answer: args.include_answer ?? false,
        include_domains: args.include_domains ?? undefined,
        exclude_domains: args.exclude_domains ?? undefined,
      });
      const parts: string[] = [];
      if (d.answer) parts.push(`Answer: ${d.answer}\n`);
      const results = (d.results ?? [])
        .map((r: any, i: number) => `${i + 1}. ${r.title}\n   ${r.url}\n   ${r.content ?? ""}`)
        .join("\n");
      parts.push(results || "No results.");
      return clip(parts.join("\n"));
    }
    case "tavily_extract": {
      const urls = Array.isArray(args.urls) ? args.urls : [args.urls];
      const d: any = await tavily("/extract", {
        urls,
        extract_depth: args.extract_depth ?? "basic",
        format: args.format ?? "markdown",
      });
      const ok = (d.results ?? [])
        .map((r: any) => `# ${r.url}\n${r.raw_content ?? ""}`)
        .join("\n\n---\n\n");
      const failed = (d.failed_results ?? [])
        .map((f: any) => `- ${f.url}: ${f.error}`)
        .join("\n");
      return clip([ok || "No content extracted.", failed && `\nFailed:\n${failed}`].filter(Boolean).join("\n"));
    }
    case "tavily_crawl": {
      const d: any = await tavily("/crawl", {
        url: args.url,
        instructions: args.instructions ?? undefined,
        max_depth: args.max_depth ?? 1,
        max_breadth: args.max_breadth ?? 20,
        limit: args.limit ?? 50,
        select_paths: args.select_paths ?? undefined,
        extract_depth: args.extract_depth ?? "basic",
      });
      const out = (d.results ?? [])
        .map((r: any) => `# ${r.url}\n${(r.raw_content ?? "").slice(0, 4000)}`)
        .join("\n\n---\n\n");
      return clip(`Base: ${d.base_url}\nPages: ${(d.results ?? []).length}\n\n${out || "No pages crawled."}`);
    }
    case "tavily_map": {
      const d: any = await tavily("/map", {
        url: args.url,
        instructions: args.instructions ?? undefined,
        max_depth: args.max_depth ?? 1,
        max_breadth: args.max_breadth ?? 20,
        limit: args.limit ?? 50,
        select_paths: args.select_paths ?? undefined,
      });
      const urls = (d.results ?? []).join("\n");
      return clip(`Base: ${d.base_url}\nDiscovered ${(d.results ?? []).length} URLs:\n${urls || "(none)"}`);
    }
    default:
      throw new Error(`Unknown Tavily tool: ${name}`);
  }
}
