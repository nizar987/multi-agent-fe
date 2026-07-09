/**
 * Agent runtime — tool-use loop, agent-to-agent delegation (with a depth
 * limit), shared memory tools, skills injected into the system prompt.
 */
import { getDb } from "./db";
import { callAiStream, AiTool, AiMessage } from "./ai";
import { listMcpTools, callMcpTool, McpServerName } from "./mcp";
import { githubToolDefs, callGithubTool } from "./tools-github";
import { tavilyToolDefs, callTavilyTool } from "./tools-tavily";
import { monitoringToolDefs, callMonitoringTool } from "./tools-monitoring";
import { memoryRead, memoryWrite, memoryDelete, memoryList } from "./memory";
import { databaseToolDefs, redisToolDefs, callDatabaseTool, callRedisTool, isReadOnlySql, redisWriteDetail } from "./tools-db";
import { envToolDefs, callEnvTool, resolveEnvPath } from "./tools-env";
import { shellToolDef, runShell, awaitApproval } from "./shell";
import { cronToolDefs, callCronTool } from "./tools-cron";
import { visionToolDef, callVisionTool } from "./tools-vision";
import { awaitAnswer, AskOption } from "./ask";
import { logger } from "./logger";

export const MAX_DELEGATION_DEPTH = 2;
const MAX_LOOP_ITERATIONS = 100;

export type AgentRow = {
  id: number; name: string; description: string; system_prompt: string;
  model_override: string | null; tools: string; skill_ids: string;
};

/** Action types that require user approval in chat before execution. */
export type ApprovalKind = "shell" | "database" | "redis" | "env";

/**
 * Execution mode (picked by the user in chat):
 * - approval : risky actions ask for permission via a card in chat (default)
 * - act      : risky actions run immediately without asking
 * - plan     : risky actions are NOT executed — the agent only drafts a plan
 */
export type RunMode = "approval" | "act" | "plan";

export type RunEvent =
  | { type: "text"; text: string }
  | { type: "tool_call"; tool: string; args: any }
  | { type: "tool_result"; tool: string; ok: boolean; preview: string }
  | { type: "system_notice"; text: string }
  | { type: "approval_request"; id: string; kind: ApprovalKind; detail: string }
  | { type: "approval_resolved"; id: string; approved: boolean }
  | { type: "ask_user"; id: string; question: string; options: AskOption[] }
  | { type: "ask_resolved"; id: string; answer: string }
  | { type: "delegate_start"; agent: string }
  | { type: "delegate_end"; agent: string }
  | { type: "done"; finalText: string }
  | { type: "error"; message: string };

export function getAgent(id: number): AgentRow | null {
  return (getDb().prepare("SELECT * FROM agents WHERE id=?").get(id) as AgentRow) ?? null;
}

function sanitizeToolName(s: string) {
  return s.replace(/[^a-zA-Z0-9_-]/g, "_").slice(0, 64);
}

const REJECTED_MSG = "Action NOT executed — rejected by the user or the approval timed out.";
const SQL_WRITE_BLOCKED_MSG =
  "Write SQL (INSERT / UPDATE / DELETE / DDL, etc.) is NOT permitted in this run — only read-only " +
  "SELECT / SHOW / EXPLAIN / DESCRIBE queries can execute. Do not attempt to modify data. Analyze with " +
  "read-only queries and leave any data changes for the user to run themselves.";

/** Extra restrictions / overrides for a run. */
export interface RunOptions {
  /** When true, only read-only SQL runs; write statements are blocked outright. */
  readOnlySql?: boolean;
  /** Force a specific model for this run (and delegated sub-agents). */
  modelOverride?: string;
  /**
   * True when a user is live in chat: enables ask_user (multiple-choice
   * questions) and the agent's own schedule (cron) tools. Autonomous runs
   * (cron / manager workers) leave this off so nothing blocks on user input.
   */
  interactive?: boolean;
}
const PLAN_MSG =
  "Plan mode is active — the action was NOT executed. Explain to the user the plan/actions you intend to take; " +
  "they can switch to Approval or Act mode to execute it.";

/** Ask the user for approval via a card in chat; resolved by POST /api/shell/approve. */
async function requestApproval(
  onEvent: (e: RunEvent) => void,
  id: string,
  kind: ApprovalKind,
  detail: string
): Promise<boolean> {
  onEvent({ type: "approval_request", id, kind, detail });
  const decision = await awaitApproval(id);
  if (decision === "always") {
    const { addAllowed } = await import("./allowlist");
    addAllowed(kind, detail);
  }
  const approved = decision !== "deny";
  onEvent({ type: "approval_resolved", id, approved });
  return approved;
}

/** Gate a risky action according to the mode. Returns null = allowed, string = blocking message. */
async function gateRiskyAction(
  mode: RunMode,
  onEvent: (e: RunEvent) => void,
  id: string,
  kind: ApprovalKind,
  detail: string
): Promise<string | null> {
  if (mode === "act") return null;
  if (mode === "plan") return PLAN_MSG;
  // Allowlisted actions ("Always allow") skip the approval card.
  const { isAllowed } = await import("./allowlist");
  if (isAllowed(kind, detail)) {
    onEvent({ type: "system_notice", text: `✓ Auto-allowed (${kind}) — in the allowed list: ${detail.slice(0, 120)}` });
    return null;
  }
  return (await requestApproval(onEvent, id, kind, detail)) ? null : REJECTED_MSG;
}

const memoryToolDefs: AiTool[] = [
  {
    name: "memory_read",
    description: "Read a single value from shared memory by key.",
    input_schema: { type: "object", properties: { key: { type: "string" } }, required: ["key"] },
  },
  {
    name: "memory_write",
    description: "Write/update a value in shared memory (readable by all agents).",
    input_schema: {
      type: "object",
      properties: { key: { type: "string" }, value: { type: "string" } },
      required: ["key", "value"],
    },
  },
  {
    name: "memory_delete",
    description: "Delete a single key from shared memory.",
    input_schema: { type: "object", properties: { key: { type: "string" } }, required: ["key"] },
  },
  {
    name: "memory_list",
    description: "List all keys currently in shared memory.",
    input_schema: { type: "object", properties: {} },
  },
];

const askUserToolDef: AiTool = {
  name: "ask_user",
  description:
    "Ask the user a question with 2–4 answer options rendered as clickable buttons in chat. " +
    "ALWAYS use this instead of a plain-text question when you need the user to make a decision. " +
    "Mark the best option with recommended=true and clearly inferior ones with recommended=false. " +
    "The user can always type a custom answer, so never add an 'Other' option yourself. " +
    "Returns the user's answer as text.",
  input_schema: {
    type: "object",
    properties: {
      question: { type: "string", description: "the question to ask" },
      options: {
        type: "array",
        minItems: 2,
        maxItems: 4,
        items: {
          type: "object",
          properties: {
            label: { type: "string", description: "short answer text (1–6 words)" },
            description: { type: "string", description: "what this choice means / its trade-offs" },
            recommended: { type: "boolean", description: "true = recommended, false = not recommended, omit = neutral" },
          },
          required: ["label"],
        },
      },
    },
    required: ["question", "options"],
  },
};

function delegateToolDef(exceptAgentId: number): AiTool {
  const agents = getDb()
    .prepare("SELECT name, description FROM agents WHERE id != ?")
    .all(exceptAgentId) as any[];
  const list = agents.map((a) => `- ${a.name}: ${a.description}`).join("\n") || "(no other agents)";
  return {
    name: "delegate_to_agent",
    description: `Delegate a sub-task to another agent. Available agents:\n${list}`,
    input_schema: {
      type: "object",
      properties: {
        agent_name: { type: "string", description: "exact name of the target agent" },
        task: { type: "string", description: "task instructions for that agent" },
      },
      required: ["agent_name", "task"],
    },
  };
}

async function assembleTools(agent: AgentRow): Promise<{
  defs: AiTool[];
  route: Map<string, { kind: "mcp"; server: McpServerName; tool: string } | { kind: "github" } | { kind: "tavily" } | { kind: "memory" } | { kind: "delegate" } | { kind: "shell" } | { kind: "database" } | { kind: "redis" } | { kind: "env" } | { kind: "monitoring" } | { kind: "ask" } | { kind: "cron" } | { kind: "vision" }>;
  notices: string[];
}> {
  const enabled: string[] = JSON.parse(agent.tools || "[]");
  const defs: AiTool[] = [];
  const route = new Map<string, any>();
  const notices: string[] = [];

  for (const t of enabled) {
    if (t === "github") {
      for (const d of githubToolDefs) { defs.push(d); route.set(d.name, { kind: "github" }); }
    } else if (t === "tavily") {
      for (const d of tavilyToolDefs) { defs.push(d); route.set(d.name, { kind: "tavily" }); }
    } else if (t === "tavily_mcp") {
      // Tavily hosted remote MCP (Streamable HTTP) — tools prefixed to avoid
      // colliding with the built-in REST `tavily_*` tools above.
      try {
        const tools = await listMcpTools("tavily");
        if (tools.length === 0) notices.push("Tavily MCP is unavailable — the answer was produced without it.");
        for (const mt of tools) {
          const name = sanitizeToolName(`tvmcp_${mt.name}`);
          defs.push({ name, description: mt.description ?? mt.name, input_schema: mt.inputSchema ?? { type: "object", properties: {} } });
          route.set(name, { kind: "mcp", server: "tavily", tool: mt.name });
        }
      } catch (e: any) {
        notices.push(`Tavily MCP disconnected (${String(e?.message ?? e).slice(0, 100)}) — the answer was produced without it.`);
      }
    } else if (t === "vision") {
      // read_image — forwards attached images to the configured vision model.
      defs.push(visionToolDef);
      route.set(visionToolDef.name, { kind: "vision" });
    } else if (t === "memory") {
      for (const d of memoryToolDefs) { defs.push(d); route.set(d.name, { kind: "memory" }); }
    } else if (t === "delegate") {
      const d = delegateToolDef(agent.id);
      defs.push(d); route.set(d.name, { kind: "delegate" });
    } else if (t === "shell") {
      defs.push(shellToolDef); route.set(shellToolDef.name, { kind: "shell" });
    } else if (t === "database") {
      for (const d of databaseToolDefs) { defs.push(d); route.set(d.name, { kind: "database" }); }
    } else if (t === "redis") {
      for (const d of redisToolDefs) { defs.push(d); route.set(d.name, { kind: "redis" }); }
    } else if (t === "env") {
      for (const d of envToolDefs) { defs.push(d); route.set(d.name, { kind: "env" }); }
    } else if (t === "monitoring") {
      // Prometheus/Loki: direct REST tools.
      for (const d of monitoringToolDefs) { defs.push(d); route.set(d.name, { kind: "monitoring" }); }
      // Grafana: official mcp-grafana MCP server (only when a grafana connection is active).
      try {
        const { getActive } = await import("./connections-db");
        if (getActive("grafana")) {
          const tools = await listMcpTools("grafana");
          if (tools.length === 0) notices.push("Grafana (mcp-grafana) is unavailable — the answer was produced without it.");
          for (const mt of tools) {
            const name = sanitizeToolName(`grafana_${mt.name}`);
            defs.push({ name, description: mt.description ?? mt.name, input_schema: mt.inputSchema ?? { type: "object", properties: {} } });
            route.set(name, { kind: "mcp", server: "grafana", tool: mt.name });
          }
        }
      } catch (e: any) {
        notices.push(`Grafana disconnected (${String(e?.message ?? e).slice(0, 100)}) — the answer was produced without it.`);
      }
    } else if (t === "gitlab" || t === "filesystem") {
      try {
        const tools = await listMcpTools(t as McpServerName);
        if (tools.length === 0) notices.push(`Tool ${t} is unavailable — the answer was produced without it.`);
        for (const mt of tools) {
          const name = sanitizeToolName(`${t === "filesystem" ? "fs" : "gitlab"}_${mt.name}`);
          defs.push({ name, description: mt.description ?? mt.name, input_schema: mt.inputSchema ?? { type: "object", properties: {} } });
          route.set(name, { kind: "mcp", server: t, tool: mt.name });
        }
      } catch (e: any) {
        notices.push(`Tool ${t} disconnected (${String(e?.message ?? e).slice(0, 100)}) — the answer was produced without it.`);
      }
    }
  }
  return { defs, route, notices };
}

function buildSystemPrompt(agent: AgentRow): string {
  let sys = agent.system_prompt || `You are an agent named ${agent.name}.`;
  const skillIds: number[] = JSON.parse(agent.skill_ids || "[]");
  if (skillIds.length) {
    const qs = skillIds.map(() => "?").join(",");
    const skills = getDb().prepare(`SELECT name, content FROM skills WHERE id IN (${qs})`).all(...skillIds) as any[];
    if (skills.length) {
      sys += "\n\n# Skills\nFollow these skill guides when relevant:\n";
      for (const s of skills) sys += `\n## ${s.name}\n${s.content}\n`;
    }
  }
  // Knowledge: global (agent_id NULL) + this agent's own
  const knowledge = getDb()
    .prepare("SELECT title, content FROM knowledge WHERE agent_id IS NULL OR agent_id=? ORDER BY id")
    .all(agent.id) as any[];
  if (knowledge.length) {
    sys += "\n\n# Knowledge\nUse the following as trusted context:\n";
    for (const k of knowledge) sys += `\n## ${k.title}\n${k.content}\n`;
  }
  return sys;
}

/**
 * Fallback for models that write tool calls as plain text instead of using
 * native tool_use — e.g. `<answer>{"tool_name": "ask_user", "params": {...}}</answer>`.
 * Extracts the call so the loop can execute it for real, and returns the
 * reply text with the JSON blob stripped out.
 */
function extractTextToolCall(
  text: string,
  isKnownTool: (name: string) => boolean
): { name: string; input: Record<string, unknown>; cleanedText: string } | null {
  const keyMatch = text.match(/"(?:tool_name|tool|function|name)"\s*:/);
  if (!keyMatch || keyMatch.index === undefined) return null;

  // Find the JSON object enclosing that key (string-aware brace matching).
  const start = text.lastIndexOf("{", keyMatch.index);
  if (start < 0) return null;
  let depth = 0, end = -1, inStr = false, esc = false;
  for (let i = start; i < text.length; i++) {
    const ch = text[i];
    if (esc) { esc = false; continue; }
    if (ch === "\\") { esc = true; continue; }
    if (ch === '"') { inStr = !inStr; continue; }
    if (inStr) continue;
    if (ch === "{") depth++;
    else if (ch === "}") { depth--; if (depth === 0) { end = i; break; } }
  }
  if (end < 0) return null;

  let obj: any;
  try { obj = JSON.parse(text.slice(start, end + 1)); } catch { return null; }
  const name = obj?.tool_name ?? obj?.tool ?? obj?.function ?? obj?.name;
  if (typeof name !== "string" || !isKnownTool(name)) return null;
  const rawInput = obj.params ?? obj.parameters ?? obj.arguments ?? obj.input ?? {};
  const input = rawInput && typeof rawInput === "object" ? rawInput : {};

  const cleanedText = (text.slice(0, start) + text.slice(end + 1))
    .replace(/<\/?(answer|tool_call|function_call|tool_use|tool)>/gi, "")
    .replace(/```(?:json)?\s*```/g, "")
    .trim();
  return { name, input, cleanedText };
}

export async function runAgent(
  agentId: number,
  history: AiMessage[],
  onEvent: (e: RunEvent) => void,
  depth = 0,
  mode: RunMode = "approval",
  opts: RunOptions = {}
): Promise<string> {
  const agent = getAgent(agentId);
  if (!agent) throw new Error("Agent not found.");
  logger.info(`Agent run started: "${agent.name}" (id=${agentId}, mode=${mode}, depth=${depth})`);

  const { defs, route, notices } = await assembleTools(agent);
  for (const n of notices) onEvent({ type: "system_notice", text: n });

  // Interactive-only built-ins: multiple-choice questions + the agent's own schedules.
  if (opts.interactive && depth === 0) {
    defs.push(askUserToolDef);
    route.set(askUserToolDef.name, { kind: "ask" });
    for (const d of cronToolDefs) { defs.push(d); route.set(d.name, { kind: "cron" }); }
  }


  const messages: AiMessage[] = [...history];
  let finalText = "";

  let system = buildSystemPrompt(agent);
  if (mode === "plan") {
    system +=
      "\n\n# Plan mode\nThe user selected Plan mode: do NOT execute actions that change the system " +
      "(shell, data-modifying SQL, Redis writes, reading .env files) — those actions are blocked automatically. " +
      "Produce a clear step-by-step plan, then suggest the user switch to Approval/Act mode to execute it.";
  }
  if (opts.interactive && depth === 0) {
    system +=
      "\n\n# Interactive tools\n" +
      "- When you need the user to make a decision, use the ask_user tool: give 2–4 concrete options, " +
      "mark the best one recommended=true and clearly worse ones recommended=false, with a short description of trade-offs. " +
      "Do not ask decision questions in plain text.\n" +
      "- When the user wants something to run on a schedule (e.g. 'every morning', 'weekly report'), " +
      "use schedule_task_create. First confirm the schedule with ask_user (offer a few sensible schedule options). " +
      "Use schedule_task_list / schedule_task_delete to review or remove your schedules.";
  }
  if (defs.length > 0) {
    system +=
      "\n\n# Tool calling\nAlways call tools through the native tool-use mechanism. " +
      "NEVER write a tool call as JSON, XML, or wrapper tags (like <answer> or <tool_call>) in your reply text.";
  }
  if (route.has("read_image")) {
    system +=
      "\n\n# Images\nYou CAN understand attached images: whenever the user refers to an attached " +
      "image/photo/screenshot, call the read_image tool with a specific question about it. " +
      "NEVER claim you cannot see images — even if earlier messages in this conversation say so, " +
      "the read_image tool is available NOW and overrides those earlier statements.";
  }

  let iter = 0;
  for (; iter < MAX_LOOP_ITERATIONS; iter++) {
    const resp = await callAiStream({
      system,
      messages,
      tools: defs,
      model: opts.modelOverride ?? agent.model_override ?? undefined,
      // stream partial text to the chatbox as the AI generates it
      onText: (t) => onEvent({ type: "text", text: t }),
    });

    const textParts = (resp.content ?? []).filter((c: any) => c.type === "text").map((c: any) => c.text);
    if (textParts.length) {
      finalText = textParts.join("\n");
      onEvent({ type: "text", text: finalText });
    }

    // Fallback: some models write the tool call as plain text (e.g.
    // `<answer>{"tool_name": "ask_user", ...}</answer>`) instead of native
    // tool_use. Detect it, strip the blob from the visible text, and inject
    // a real tool_use block so the normal execution path below handles it.
    if (resp.stop_reason !== "tool_use" && finalText && route.size > 0) {
      const parsed = extractTextToolCall(finalText, (n) => route.has(n));
      if (parsed) {
        logger.warn(`Agent "${agent.name}" emitted a text-based tool call for "${parsed.name}" — recovered.`);
        finalText = parsed.cleanedText;
        onEvent({ type: "text", text: finalText }); // replace the raw blob in the UI
        resp.content = [
          ...(parsed.cleanedText ? [{ type: "text", text: parsed.cleanedText }] : []),
          { type: "tool_use", id: `texttool_${Date.now()}_${iter}`, name: parsed.name, input: parsed.input },
        ];
        resp.stop_reason = "tool_use";
      }
    }

    if (resp.stop_reason !== "tool_use") break;

    messages.push({ role: "assistant", content: resp.content });
    const results: any[] = [];

    for (const block of resp.content.filter((c: any) => c.type === "tool_use")) {
      onEvent({ type: "tool_call", tool: block.name, args: block.input });
      let resultStr = "";
      let isError = false;
      const r = route.get(block.name);
      try {
        if (!r) throw new Error("Unknown tool.");
        if (r.kind === "github") {
          resultStr = await callGithubTool(block.name, block.input);
        } else if (r.kind === "tavily") {
          // Read-only web search/extract/crawl/map — no approval gating needed.
          resultStr = await callTavilyTool(block.name, block.input);
        } else if (r.kind === "monitoring") {
          // Read-only queries (PromQL/LogQL/Grafana search) — no approval gating needed.
          resultStr = await callMonitoringTool(block.name, block.input);
        } else if (r.kind === "mcp") {
          resultStr = await callMcpTool(r.server, r.tool, block.input);
        } else if (r.kind === "memory") {
          const inp: any = block.input;
          if (block.name === "memory_read") resultStr = memoryRead(inp.key, agent.id, agent.name) ?? "(empty)";
          else if (block.name === "memory_write") { memoryWrite(inp.key, inp.value, agent.id, agent.name); resultStr = "OK"; }
          else if (block.name === "memory_delete") { memoryDelete(inp.key, agent.id, agent.name); resultStr = "OK"; }
          else resultStr = (memoryList() as any[]).map((m) => m.key).join(", ") || "(empty)";
        } else if (r.kind === "database") {
          const sql = String((block.input as any)?.sql ?? "");
          let denied: string | null;
          if (isReadOnlySql(sql)) {
            denied = null;
          } else if (opts.readOnlySql) {
            denied = SQL_WRITE_BLOCKED_MSG; // autonomous run: never execute writes
          } else {
            denied = await gateRiskyAction(mode, onEvent, block.id, "database", sql);
          }
          resultStr = denied ?? (await callDatabaseTool(block.name, block.input));
        } else if (r.kind === "redis") {
          const detail = redisWriteDetail(block.name, block.input);
          const denied = detail
            ? await gateRiskyAction(mode, onEvent, block.id, "redis", detail)
            : null;
          resultStr = denied ?? (await callRedisTool(block.name, block.input));
        } else if (r.kind === "env") {
          const file = resolveEnvPath((block.input as any)?.filename);
          const denied = await gateRiskyAction(mode, onEvent, block.id, "env", `read ${file}`);
          resultStr = denied ?? (await callEnvTool(block.name, block.input));
        } else if (r.kind === "shell") {
          const cmd = String((block.input as any).command ?? "");
          const denied = await gateRiskyAction(mode, onEvent, block.id, "shell", cmd);
          resultStr = denied ?? (await runShell(cmd, agentId));
        } else if (r.kind === "ask") {
          const inp: any = block.input;
          const options: AskOption[] = Array.isArray(inp?.options)
            ? inp.options.filter((o: any) => typeof o?.label === "string" && o.label.trim())
            : [];
          onEvent({ type: "ask_user", id: block.id, question: String(inp?.question ?? ""), options });
          const answer = await awaitAnswer(block.id);
          const finalAnswer = answer ?? "(no answer from the user — proceed with the recommended option)";
          onEvent({ type: "ask_resolved", id: block.id, answer: finalAnswer });
          resultStr = `User answered: ${finalAnswer}`;
        } else if (r.kind === "cron") {
          resultStr = await callCronTool(agent.id, block.name, block.input);
        } else if (r.kind === "vision") {
          resultStr = await callVisionTool(messages, block.input);
        } else if (r.kind === "delegate") {
          const inp: any = block.input;
          if (depth >= MAX_DELEGATION_DEPTH) {
            throw new Error(`Delegation depth limit (${MAX_DELEGATION_DEPTH}) reached — handle it yourself.`);
          }
          const target = getDb().prepare("SELECT id,name FROM agents WHERE name=?").get(inp.agent_name) as any;
          if (!target) throw new Error(`Agent '${inp.agent_name}' not found.`);
          onEvent({ type: "delegate_start", agent: target.name });
          resultStr = await runAgent(target.id, [{ role: "user", content: inp.task }], onEvent, depth + 1, mode, opts);
          onEvent({ type: "delegate_end", agent: target.name });
        }
      } catch (e: any) {
        isError = true;
        resultStr = String(e?.message ?? e);
      }
      onEvent({ type: "tool_result", tool: block.name, ok: !isError, preview: resultStr.slice(0, 200) });
      results.push({
        type: "tool_result",
        tool_use_id: block.id,
        content: resultStr.slice(0, 50_000),
        ...(isError ? { is_error: true } : {}),
      });
    }
    messages.push({ role: "user", content: results });
  }

  if (!finalText.trim()) {
    logger.warn(`Agent "${agent.name}" finished with an EMPTY answer (iterations=${iter}) — check the provider/model response.`);
  }
  logger.info(`Agent run completed: "${agent.name}" (id=${agentId}, iterations=${iter})`);
  return finalText;
}
