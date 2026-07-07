/**
 * GitHub tools via REST API — temporary replacement for the GitHub MCP
 * server (which required Docker). A native Go binary lands in Phase C;
 * the tool interface in the agent loop will not change.
 */
import { getSecret } from "./config";
import type { AiTool } from "./ai";

const BASE = "https://api.github.com";

async function gh(pathname: string) {
  const token = getSecret("githubToken");
  if (!token) throw new Error("GitHub token is not configured.");
  const res = await fetch(`${BASE}${pathname}`, {
    headers: {
      authorization: `Bearer ${token}`,
      accept: "application/vnd.github+json",
      "user-agent": "agent-platform-desktop",
    },
    signal: AbortSignal.timeout(20_000),
  });
  if (res.status === 401) throw new Error("GitHub token is invalid or expired.");
  if (res.status === 404) throw new Error("Not found (check owner/repo/path, or the token lacks access).");
  if (!res.ok) throw new Error(`GitHub API error ${res.status}`);
  return res.json();
}

export const githubToolDefs: AiTool[] = [
  {
    name: "github_search_repos",
    description: "Search GitHub repositories by keyword.",
    input_schema: {
      type: "object",
      properties: { query: { type: "string", description: "search keywords" } },
      required: ["query"],
    },
  },
  {
    name: "github_get_file",
    description: "Read the contents of a single file from a GitHub repo.",
    input_schema: {
      type: "object",
      properties: {
        owner: { type: "string" }, repo: { type: "string" },
        path: { type: "string" }, ref: { type: "string", description: "branch/tag, optional" },
      },
      required: ["owner", "repo", "path"],
    },
  },
  {
    name: "github_list_issues",
    description: "List open issues in a GitHub repo.",
    input_schema: {
      type: "object",
      properties: { owner: { type: "string" }, repo: { type: "string" } },
      required: ["owner", "repo"],
    },
  },
];

export async function callGithubTool(name: string, args: any): Promise<string> {
  switch (name) {
    case "github_search_repos": {
      const d: any = await gh(`/search/repositories?q=${encodeURIComponent(args.query)}&per_page=10`);
      return d.items
        .map((r: any) => `${r.full_name} ★${r.stargazers_count} — ${r.description ?? ""}`)
        .join("\n") || "No results.";
    }
    case "github_get_file": {
      const ref = args.ref ? `?ref=${encodeURIComponent(args.ref)}` : "";
      const d: any = await gh(`/repos/${args.owner}/${args.repo}/contents/${args.path}${ref}`);
      if (d.encoding === "base64") return Buffer.from(d.content, "base64").toString("utf8").slice(0, 40_000);
      return JSON.stringify(d).slice(0, 40_000);
    }
    case "github_list_issues": {
      const d: any = await gh(`/repos/${args.owner}/${args.repo}/issues?state=open&per_page=20`);
      return d.map((i: any) => `#${i.number} ${i.title} (@${i.user.login})`).join("\n") || "No open issues.";
    }
    default:
      throw new Error(`Unknown GitHub tool: ${name}`);
  }
}
