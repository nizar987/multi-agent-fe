/**
 * Agent runtime — tool-use loop, agent-to-agent delegation (with a depth
 * limit), shared memory tools, skills injected into the system prompt.
 */
import { getDb } from "./db";
import { callAiStream, AiTool, AiMessage } from "./ai";
import { applyContextLimit } from "./context-limit";
import { listMcpTools, callMcpTool, getMcpStatus, McpServerName } from "./mcp";
import { githubToolDefs, callGithubTool } from "./tools-github";
import { tavilyToolDefs, callTavilyTool } from "./tools-tavily";
import { videoToolDefs, callVideoTool, ffmpegAvailable } from "./tools-video";
import { monitoringToolDefs, callMonitoringTool } from "./tools-monitoring";
import { memoryRead, memoryWrite, memoryDelete, memoryList } from "./memory";
import { databaseToolDefs, redisToolDefs, callDatabaseTool, callRedisTool, isReadOnlySql, redisWriteDetail } from "./tools-db";
import { envToolDefs, callEnvTool, resolveEnvPath } from "./tools-env";
import { shellToolDef, runShell, awaitApproval, shellCwd } from "./shell";
import { awaitNetworkRetry, isNetworkError } from "./net-pause";
import { setTodos, getTodos, todosPrompt, journalPrompt, logAssignment, TodoInput, RunTodo } from "./progress-db";
import { cronToolDefs, callCronTool } from "./tools-cron";
import { learningToolDefs, callLearningTool, learningPrompt, learningNotesPrompt } from "./tools-learning";
import { withToolCache, invalidateAfter, RunToolMemo, CachedResult } from "./tool-cache";
import { claimForWrite, releaseFileLocks, newLockOwnerId } from "./file-locks";
import { syncShared } from "./catalog";
import {
  MAX_IDLE_NUDGES, MAX_TOTAL_NUDGES, TRANSIENT_RETRY_DELAYS_MS,
  looksUnfinished, isTransientAiError, nudgeMessage,
} from "./run-guard";
import {
  boardToolDefs, BOARD_PROMPT, boardPost, boardReadText, boardPromptNotes,
  boardNotesSince, boardLastId, formatNotes,
} from "./team-board";
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
export type ApprovalKind = "shell" | "database" | "redis" | "env" | "learning";

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
  | { type: "todos"; todos: RunTodo[] }
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
  /** Label recorded with token usage for this run (defaults to "agent"). */
  usageSource?: string;
  /**
   * Working directory for shell commands in this run (Workspace "working
   * folder"). Overrides the agent's own working_dir; inherited by delegated
   * sub-agents.
   */
  workingDir?: string;
  /**
   * Conversation this run belongs to — enables the persistent progress
   * checklist (progress_update tool + right-hand Progress panel) and the
   * work journal, so the agent can pick up where it left off after a
   * disconnect.
   */
  conversationId?: number;
  /**
   * Team board shared by agents working in parallel (`ws:<sessionId>` for a
   * Workspace session, `task:<id>` for a Manager task). Enables board_post /
   * board_read and pushes other agents' new notes into this run.
   */
  boardKey?: string;
  /**
   * File-lock owner — set once by the root run and inherited by delegated
   * sub-agents, so a parent and its helpers share their file claims.
   */
  lockOwnerId?: string;
  /** Called on every loop step / tool result — the run registry's heartbeat. */
  heartbeat?: () => void;
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
  const decision = await awaitApproval(id, { kind, detail });
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

/** Persistent checklist tool — the agent's own progress tracker per conversation. */
const progressToolDef: AiTool = {
  name: "progress_update",
  description:
    "Maintain your persistent progress checklist for this task. Send the COMPLETE list every time " +
    "(it replaces the previous one): all planned steps with their current status. Use it right after " +
    "planning a multi-step task, and update it immediately whenever a step is finished or started. " +
    "The list survives disconnects — on a new run it is shown back to you so you can continue where you left off.",
  input_schema: {
    type: "object",
    properties: {
      todos: {
        type: "array",
        description: "the FULL checklist, in order",
        items: {
          type: "object",
          properties: {
            content: { type: "string", description: "short description of the step" },
            status: { type: "string", enum: ["pending", "in_progress", "done"], description: "current status" },
          },
          required: ["content", "status"],
        },
      },
    },
    required: ["todos"],
  },
};

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
  route: Map<string, { kind: "mcp"; server: McpServerName; tool: string } | { kind: "github" } | { kind: "tavily" } | { kind: "video" } | { kind: "memory" } | { kind: "delegate" } | { kind: "shell" } | { kind: "database" } | { kind: "redis" } | { kind: "env" } | { kind: "monitoring" } | { kind: "ask" } | { kind: "cron" } | { kind: "vision" } | { kind: "progress" } | { kind: "learning" } | { kind: "board" }>;
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
    } else if (t === "video") {
      if (!ffmpegAvailable()) {
        notices.push("Video tools skipped: ffmpeg is not installed (macOS: brew install ffmpeg).");
      } else {
        for (const d of videoToolDefs) { defs.push(d); route.set(d.name, { kind: "video" }); }
      }
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
        if (tools.length === 0) {
          // Surface the REAL reason (e.g. "unconfigured: No allowed folders yet"
          // or "error: server failed to start: …") instead of a bare "unavailable".
          const st = getMcpStatus(t as McpServerName);
          const why = st.detail ? ` (${st.status}: ${st.detail})` : "";
          notices.push(`Tool ${t} is unavailable${why} — the answer was produced without it.`);
        }
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
  // Delegated sub-agents inherit the root run's lock owner (and its claims).
  if (opts.lockOwnerId) return runAgentLoop(agentId, history, onEvent, depth, mode, opts);
  // Root run: pull the latest agents/skills/knowledge from the shared DB into
  // the local copy the runtime reads (no-op without a shared DB; never throws).
  await syncShared();
  const lockOwnerId = newLockOwnerId();
  try {
    return await runAgentLoop(agentId, history, onEvent, depth, mode, { ...opts, lockOwnerId });
  } finally {
    await releaseFileLocks(lockOwnerId);
  }
}

async function runAgentLoop(
  agentId: number,
  history: AiMessage[],
  onEvent: (e: RunEvent) => void,
  depth: number,
  mode: RunMode,
  opts: RunOptions
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
  // Self-learning: every agent can save its own memory, knowledge and skills.
  for (const d of learningToolDefs) { defs.push(d); route.set(d.name, { kind: "learning" }); }
  // Team board — only when this run is part of a multi-agent session/task.
  if (opts.boardKey) {
    for (const d of boardToolDefs) { defs.push(d); route.set(d.name, { kind: "board" }); }
  }
  // Persistent progress checklist — available whenever the run belongs to a conversation.
  if (opts.conversationId && depth === 0) {
    defs.push(progressToolDef);
    route.set(progressToolDef.name, { kind: "progress" });
  }

  // Auto-memory: record what the user asked and in which folder, so the agent
  // never loses track of its assignments across sessions.
  if (depth === 0 && opts.interactive) {
    const lastUser = [...history].reverse().find((m) => m.role === "user");
    const reqText = typeof lastUser?.content === "string"
      ? lastUser.content
      : Array.isArray(lastUser?.content)
        ? (lastUser!.content as any[]).filter((b) => b?.type === "text").map((b) => b.text).join(" ")
        : "";
    if (reqText.trim()) {
      try { logAssignment(agentId, reqText, shellCwd(agentId, opts.workingDir), opts.conversationId); } catch { /* best-effort */ }
    }
  }


  const messages: AiMessage[] = [...history];
  let finalText = "";
  // Truncated-output recovery: when a reply is cut off by the token limit,
  // `carry` keeps the text produced so far so the continuation appends to it
  // (in the UI stream and in the saved answer) instead of replacing it.
  let carry = "";
  let autoContinues = 0;
  // Persistence: when the model stops before the work is done it is nudged to
  // continue. idleNudges resets whenever it actually runs a tool, so a model
  // that keeps making progress can be nudged again; one that just keeps
  // stopping gives up after MAX_IDLE_NUDGES.
  let totalNudges = 0;
  let idleNudges = 0;
  let unfinishedNudges = 0;
  let emptyNudges = 0;
  const MAX_AUTO_CONTINUES = 6;

  // Prompt caching: `system` holds text that stays identical across runs and
  // across the iterations of this run (cached by the provider). Anything that
  // changes from run to run goes in `systemDynamic`, sent after it.
  let system = buildSystemPrompt(agent) + learningPrompt();
  let systemDynamic = "";
  // Agents that can write files / run commands must EXECUTE build tasks, not
  // stop after reading inputs and replying with a summary (classic failure:
  // "read the PRD, answered with a plan, built nothing").
  const canBuild = [...route.keys()].some((n) => n.startsWith("fs_") || n === "run_shell");
  if (canBuild && mode !== "plan") {
    system +=
      "\n\n# Execution discipline\n" +
      "When the user asks you to BUILD or IMPLEMENT something (a website, app, script — e.g. from a PRD/PLAN file), " +
      "you must produce the actual artifacts in this run using your tools: create directories and write every needed file " +
      "(fs_write_file), run setup/build commands (run_shell) when available, and verify the result. " +
      "Reading the input files and replying with a summary, outline or promise is NOT task completion. " +
      "Work file by file and keep calling tools until the deliverable exists; only stop early to ask the user when you are " +
      "genuinely blocked on a decision you cannot make yourself.";
  }
  if (opts.workingDir) {
    system +=
      `\n\n# Working directory\nShell commands in this session run in: ${opts.workingDir}\n` +
      "Treat this folder as the project root for relative paths.";
  }
  // Memory of past assignments + the persistent checklist: shown at every run
  // start so the agent knows what it was doing even after a disconnect.
  if (depth === 0) {
    const journal = journalPrompt(agentId);
    if (journal) {
      systemDynamic +=
        "\n\n# Recent assignments (auto-memory)\nYour latest assignments and their folders — use these to stay oriented:\n" + journal;
    }
    if (opts.conversationId) {
      const checklist = todosPrompt(opts.conversationId);
      systemDynamic += checklist
        ? "\n\n# Progress checklist (persisted)\nCurrent state of your checklist for this task ([x]=done, [~]=in progress, [ ]=pending):\n" +
          checklist +
          "\nContinue with the unfinished items — do NOT restart completed work. Keep it updated via progress_update."
        : "\n\n# Progress checklist\nFor any multi-step task, plan your steps and record them with the progress_update tool, " +
          "then keep every status current as you work. This checklist is your recovery point if the session is interrupted.";
    }
  }
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
  if (opts.boardKey) {
    system += BOARD_PROMPT;
    systemDynamic += boardPromptNotes(opts.boardKey);
  }
  systemDynamic += learningNotesPrompt(agent.id);
  systemDynamic = systemDynamic.trim();
  // Board notes up to here are in the prompt; newer ones get pushed in later.
  let boardSeenId = opts.boardKey ? boardLastId(opts.boardKey) : 0;

  // Shared tool-result cache + per-run de-dup (lib/tool-cache.ts). `lastSent`
  // is what the model last received, so a de-dup note never points at a
  // result the context limit already trimmed away.
  let lastSent: AiMessage[] = messages;
  const toolMemo = new RunToolMemo((toolUseId) =>
    lastSent.some((m) => Array.isArray(m.content) &&
      m.content.some((b: any) => b?.type === "tool_result" && b.tool_use_id === toolUseId))
  );

  let iter = 0;
  for (; iter < MAX_LOOP_ITERATIONS; iter++) {
    // Optional context cap: drop the oldest turns when the history grows past
    // the configured token budget (Settings → Context limit).
    const { messages: sendMessages, trimmed } = applyContextLimit(system + systemDynamic, messages);
    lastSent = sendMessages;
    if (trimmed > 0) {
      onEvent({ type: "system_notice", text: `Context limit: trimmed ${trimmed} older message(s) to stay under the token budget.` });
    }
    // On a NETWORK failure (offline, DNS, refused) the run PAUSES instead of
    // dying — it waits for the user to press Retry on the notification card,
    // then re-issues the same AI call. API errors (bad key, 4xx/5xx) still throw.
    opts.heartbeat?.();
    let resp!: Awaited<ReturnType<typeof callAiStream>>;
    let transientRetries = 0;
    for (;;) {
      try {
        resp = await callAiStream({
          system,
          systemDynamic,
          messages: sendMessages,
          tools: defs,
          model: opts.modelOverride ?? agent.model_override ?? undefined,
          usageSource: opts.usageSource ?? "agent",
          // stream partial text to the chatbox as the AI generates it
          // (prefixed with `carry` so a continued-after-truncation reply appends)
          onText: (t) => onEvent({ type: "text", text: carry + t }),
        });
        break;
      } catch (e: any) {
        if (!isNetworkError(e)) {
          // Overload / rate limit / 5xx / stalled stream: wait and re-send
          // instead of ending the run. Config errors still fail fast.
          if (isTransientAiError(e) && transientRetries < TRANSIENT_RETRY_DELAYS_MS.length) {
            const wait = TRANSIENT_RETRY_DELAYS_MS[transientRetries++];
            const reason = String(e?.message ?? e);
            logger.warn(`Agent "${agent.name}": transient AI error — retry ${transientRetries}/${TRANSIENT_RETRY_DELAYS_MS.length} in ${wait / 1000}s (${reason})`);
            onEvent({ type: "system_notice", text: `AI error (${reason.slice(0, 120)}) — retrying in ${wait / 1000}s…` });
            await new Promise((r) => setTimeout(r, wait));
            opts.heartbeat?.();
            continue;
          }
          throw e;
        }
        const reason = String(e?.message ?? e);
        logger.error(`Agent "${agent.name}": network error — run paused, waiting for the user to retry. (${reason})`);
        onEvent({
          type: "system_notice",
          text: "⚠ Connection lost — the run is paused. Press Retry on the notification card (or Cancel to stop).",
        });
        const { decision } = awaitNetworkRetry(agent.name, reason);
        const action = await decision;
        if (action === "cancel") {
          throw new Error(`Run stopped while offline: ${reason}`);
        }
        onEvent({ type: "system_notice", text: "Connection retry requested — resuming the run…" });
      }
    }

    const textParts = (resp.content ?? []).filter((c: any) => c.type === "text").map((c: any) => c.text);
    if (textParts.length) {
      finalText = carry + textParts.join("\n");
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

    if (resp.stop_reason !== "tool_use") {
      // (a) Reply was CUT OFF by the output-token limit — auto-continue in the
      // same run instead of pretending the task is complete.
      if (resp.stop_reason === "max_tokens" && autoContinues < MAX_AUTO_CONTINUES) {
        autoContinues++;
        carry = finalText; // already includes previous carry
        messages.push({
          role: "assistant",
          content: (resp.content?.length ? resp.content : [{ type: "text", text: finalText || "…" }]) as any,
        });
        messages.push({
          role: "user",
          content:
            "[system] Your previous reply was CUT OFF by the output-token limit mid-way. " +
            "Continue EXACTLY where you stopped — do not repeat any earlier text, do not apologize, just continue.",
        });
        logger.warn(`Agent "${agent.name}": output truncated (max_tokens) — auto-continuing (${autoContinues}/${MAX_AUTO_CONTINUES}).`);
        onEvent({ type: "system_notice", text: "Output hit the token limit — continuing automatically…" });
        continue;
      }
      if (resp.stop_reason === "max_tokens") {
        onEvent({ type: "system_notice", text: "Output hit the token limit repeatedly — stopped. Say 'continue' to resume." });
      }

      // (b) The model ended its turn but the work is not done — nudge it to
      // keep going: open checklist items, a reply that announces work it did
      // not do, or an empty reply.
      if (depth === 0 && mode !== "plan" && totalNudges < MAX_TOTAL_NUDGES && idleNudges < MAX_IDLE_NUDGES) {
        const open = opts.conversationId ? getTodos(opts.conversationId).filter((t) => t.status !== "done") : [];
        let nudge: { content: string; notice: string } | null = null;
        if (open.length > 0) {
          nudge = {
            content: nudgeMessage("checklist", open.map((t) => `- [${t.status}] ${t.content}`).join("\n")),
            notice: `Checklist has ${open.length} unfinished item(s) — telling the agent to continue…`,
          };
        } else if (route.size > 0 && unfinishedNudges < 2 && resp.stop_reason !== "max_tokens" && looksUnfinished(finalText)) {
          unfinishedNudges++;
          nudge = { content: nudgeMessage("unfinished"), notice: "The agent stopped mid-task — telling it to continue…" };
        } else if (!finalText.trim() && emptyNudges < 1) {
          emptyNudges++;
          nudge = { content: nudgeMessage("empty"), notice: "Empty reply — asking the agent to continue…" };
        }
        if (nudge) {
          totalNudges++;
          idleNudges++;
          carry = ""; // the nudged reply is a fresh answer, not a continuation
          messages.push({
            role: "assistant",
            content: (resp.content?.length ? resp.content : [{ type: "text", text: finalText || "…" }]) as any,
          });
          messages.push({ role: "user", content: nudge.content });
          logger.warn(`Agent "${agent.name}": ${nudge.notice} (nudge ${totalNudges}/${MAX_TOTAL_NUDGES}, idle ${idleNudges}/${MAX_IDLE_NUDGES})`);
          onEvent({ type: "system_notice", text: nudge.notice });
          continue;
        }
      }
      break;
    }

    messages.push({ role: "assistant", content: resp.content });
    const results: any[] = [];
    idleNudges = 0; // the model is acting again — it earned more nudges

    for (const block of resp.content.filter((c: any) => c.type === "tool_use")) {
      onEvent({ type: "tool_call", tool: block.name, args: block.input });
      let resultStr = "";
      let isError = false;
      let cacheInfo: Pick<CachedResult, "key" | "source"> = { key: null, source: "live" };
      // Read-only tools go through the shared cache (no-op for uncacheable calls).
      const cached = async (exec: () => Promise<string>): Promise<string> => {
        const c = await withToolCache(block.name, block.input, exec);
        cacheInfo = c;
        return c.result;
      };
      const r = route.get(block.name);
      try {
        if (!r) throw new Error("Unknown tool.");
        if (r.kind === "github") {
          resultStr = await cached(() => callGithubTool(block.name, block.input));
        } else if (r.kind === "tavily") {
          // Read-only web search/extract/crawl/map — no approval gating needed.
          resultStr = await cached(() => callTavilyTool(block.name, block.input));
        } else if (r.kind === "monitoring") {
          // Read-only queries (PromQL/LogQL/Grafana search) — no approval gating needed.
          resultStr = await callMonitoringTool(block.name, block.input);
        } else if (r.kind === "progress") {
          const items: TodoInput[] = Array.isArray((block.input as any)?.todos) ? (block.input as any).todos : [];
          const todos = setTodos(opts.conversationId!, items);
          onEvent({ type: "todos", todos });
          resultStr = `Checklist saved (${todos.length} item(s), ${todos.filter((t) => t.status === "done").length} done).`;
        } else if (r.kind === "video") {
          // ffmpeg via execFile with an args array (no shell) — outputs are new
          // files next to the input, so no approval gating needed.
          resultStr = await callVideoTool(block.name, block.input, shellCwd(agentId, opts.workingDir));
        } else if (r.kind === "mcp") {
          // Writes claim the file for this run; another run's claim blocks them.
          if (r.server === "filesystem") {
            const blocked = await claimForWrite({ id: opts.lockOwnerId!, agentName: agent.name }, block.name, block.input);
            if (blocked) throw new Error(blocked);
          }
          resultStr = await cached(() => callMcpTool(r.server, r.tool, block.input));
        } else if (r.kind === "board") {
          if (block.name === "board_post") {
            boardPost(opts.boardKey!, agent.id, agent.name, (block.input as any)?.note);
            resultStr = "Posted to the team board.";
          } else {
            resultStr = await boardReadText(opts.boardKey!);
          }
        } else if (r.kind === "learning") {
          // Changes to data the agent did not create (user's knowledge/skills,
          // shared memory) go through the same approval gate as other risky actions.
          resultStr = await callLearningTool(
            { id: agent.id, name: agent.name },
            block.name,
            block.input,
            (detail) => gateRiskyAction(mode, onEvent, block.id, "learning", detail)
          );
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
          const file = resolveEnvPath((block.input as any)?.filename, agentId, opts.workingDir);
          const denied = await gateRiskyAction(mode, onEvent, block.id, "env", `read ${file}`);
          resultStr = denied ?? (await callEnvTool(block.name, block.input, agentId, opts.workingDir));
        } else if (r.kind === "shell") {
          const cmd = String((block.input as any).command ?? "");
          const denied = await gateRiskyAction(mode, onEvent, block.id, "shell", cmd);
          resultStr = denied ?? (await runShell(cmd, agentId, opts.workingDir));
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
      if (!isError) {
        await invalidateAfter(block.name);
        resultStr = toolMemo.dedupe(block.name, cacheInfo.key, block.id, resultStr);
      }
      opts.heartbeat?.();
      const cacheTag = cacheInfo.source === "live" ? "" : "(cached) ";
      onEvent({ type: "tool_result", tool: block.name, ok: !isError, preview: cacheTag + resultStr.slice(0, 200) });
      results.push({
        type: "tool_result",
        tool_use_id: block.id,
        content: resultStr.slice(0, 50_000),
        ...(isError ? { is_error: true } : {}),
      });
    }
    // Push notes other agents posted on the team board since we last looked.
    if (opts.boardKey) {
      const fresh = boardNotesSince(opts.boardKey, boardSeenId, agent.id);
      if (fresh.length) {
        results.push({ type: "text", text: `[Team board — new notes from other agents]\n${formatNotes(fresh)}` });
        boardSeenId = fresh[fresh.length - 1].id;
      }
    }
    messages.push({ role: "user", content: results });
  }

  if (!finalText.trim()) {
    logger.warn(`Agent "${agent.name}" finished with an EMPTY answer (iterations=${iter}) — check the provider/model response.`);
  }
  logger.info(`Agent run completed: "${agent.name}" (id=${agentId}, iterations=${iter})`);
  return finalText;
}
