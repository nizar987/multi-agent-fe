/**
 * Catalog tools — let agents create and edit agents, skills and knowledge
 * through the catalog repository (lib/catalog.ts). When a shared database is
 * configured (Railway Postgres) everything lands there; otherwise in SQLite.
 *
 * These replace the old habit of writing scripts that INSERT straight into the
 * local SQLite file, which bypassed validation and never reached the shared DB.
 *
 * Approval: creating/editing an AGENT, global knowledge, knowledge for another
 * agent, or attaching skills to other agents goes through the run's approval
 * gate (`confirm`). Creating a skill or knowledge for yourself does not.
 */
import { getDb } from "./db";
import { AiTool } from "./ai";
import * as catalog from "./catalog";
import {
  KNOWN_AGENT_TOOLS, MAX_AGENT_TEXT, clampStr, sanitizeTools, sanitizeSkillIds, sanitizeColor,
} from "./agent-fields";
import type { ConfirmFn } from "./tools-learning";
import { logger } from "./logger";

type Owner = { id: number; name: string };
type Input = Record<string, unknown>;

const MAX_TITLE = 200;
const MAX_BODY = 100_000;
const LIST_LIMIT = 100;

const AGENT_PROPS = {
  name: { type: "string" },
  description: { type: "string", description: "one line: what the agent does / when to delegate to it" },
  system_prompt: { type: "string", description: "full instructions for the agent" },
  tools: {
    type: "array",
    items: { type: "string", enum: [...KNOWN_AGENT_TOOLS] },
    description: "tool groups the agent may use",
  },
  skill_ids: { type: "array", items: { type: "number" }, description: "ids of library skills to attach (see catalog_list)" },
  model_override: { type: "string", description: "optional model id; omit to use the default model" },
  avatar: { type: "string", description: "one emoji" },
  color: { type: "string", description: "hex color like #2b6cb0" },
  category: { type: "string", description: "group label, e.g. coding, content, ops" },
};

export const catalogToolDefs: AiTool[] = [
  {
    name: "catalog_list",
    description: "List agents, library skills or knowledge documents with their ids (from the shared catalog database when configured).",
    input_schema: {
      type: "object",
      properties: { kind: { type: "string", enum: ["agents", "skills", "knowledge"] } },
      required: ["kind"],
    },
  },
  {
    name: "agent_create",
    description:
      "Create a NEW AGENT in the platform catalog (saved to the shared database when configured). " +
      "Use this — never scripts or SQL against the local app.db — whenever the user wants a new agent. The user approves it.",
    input_schema: { type: "object", properties: AGENT_PROPS, required: ["name", "system_prompt"] },
  },
  {
    name: "agent_update",
    description: "Update an existing agent by id; only the fields you pass change. The user approves it.",
    input_schema: {
      type: "object",
      properties: { id: { type: "number" }, ...AGENT_PROPS },
      required: ["id"],
    },
  },
  {
    name: "skill_create",
    description:
      "Create a skill in the library (a reusable instruction snippet) and optionally attach it to agents. " +
      "Attaching to agents other than yourself needs user approval.",
    input_schema: {
      type: "object",
      properties: {
        name: { type: "string" },
        description: { type: "string", description: "one line: when to use this skill" },
        content: { type: "string", description: "the instructions in markdown" },
        attach_to_agent_ids: { type: "array", items: { type: "number" } },
      },
      required: ["name", "content"],
    },
  },
  {
    name: "knowledge_create",
    description:
      "Create a knowledge document. agent_id = the agent it belongs to; omit/null = GLOBAL (all agents). " +
      "Global knowledge or knowledge for another agent needs user approval.",
    input_schema: {
      type: "object",
      properties: {
        title: { type: "string" },
        content: { type: "string" },
        agent_id: { type: ["number", "null"] },
      },
      required: ["title", "content"],
    },
  },
];

export const CATALOG_PROMPT =
  "\n\n# Agents, skills & knowledge\n" +
  "To create or change agents, library skills or knowledge, ALWAYS use the catalog tools " +
  "(agent_create, agent_update, skill_create, knowledge_create, catalog_list) or the learn_* tools. " +
  "NEVER write scripts, SQL or files that modify the local database file (app.db): it is only a local copy — " +
  "changes made that way are lost and never reach the shared database.";

/* ---------- helpers ---------- */

function where(): string {
  return catalog.catalogMode() === "shared" ? "the shared database" : "the local database";
}

async function gate(confirm: ConfirmFn, detail: string): Promise<void> {
  const blocked = await confirm(detail);
  if (blocked) throw new Error(blocked);
}

function agentExists(id: number): boolean {
  return !!getDb().prepare("SELECT 1 FROM agents WHERE id=?").get(id);
}

function idOf(v: unknown): number | null {
  const n = Number(v);
  return v !== null && v !== undefined && v !== "" && Number.isInteger(n) && n > 0 ? n : null;
}

function textOf(v: unknown): string {
  return Buffer.isBuffer(v) ? v.toString("utf8") : v == null ? "" : String(v);
}

type AgentRow = {
  id: number; name: string; description: string; system_prompt: string; model_override: string | null;
  tools: string; skill_ids: string; avatar: string; color: string; category: string;
};

/** Full agent fields from tool input, falling back to `base` for omitted ones. */
function agentFields(input: Input, base?: AgentRow): catalog.AgentFields {
  const has = (k: string) => input[k] !== undefined;
  const name = has("name") ? clampStr(input.name).trim() : base?.name ?? "";
  if (!name) throw new Error("'name' is required.");
  const skillIds = has("skill_ids") ? sanitizeSkillIds(input.skill_ids) : null;
  if (skillIds) {
    const missing = skillIds.filter((id) => !getDb().prepare("SELECT 1 FROM skills WHERE id=?").get(id));
    if (missing.length) throw new Error(`Unknown skill id(s): ${missing.join(", ")} (see catalog_list).`);
  }
  return {
    name,
    description: has("description") ? clampStr(input.description) : base?.description ?? "",
    system_prompt: has("system_prompt") ? clampStr(input.system_prompt, MAX_AGENT_TEXT) : base?.system_prompt ?? "",
    model_override: has("model_override") ? (clampStr(input.model_override).trim() || null) : base?.model_override ?? null,
    tools: has("tools") ? JSON.stringify(sanitizeTools(input.tools)) : base?.tools ?? "[]",
    skill_ids: skillIds ? JSON.stringify(skillIds) : base?.skill_ids ?? "[]",
    avatar: has("avatar") ? clampStr(input.avatar, 16) || "🤖" : base?.avatar ?? "🤖",
    color: has("color") ? sanitizeColor(input.color) : base?.color ?? sanitizeColor(null),
    category: has("category") ? clampStr(input.category) : base?.category ?? "",
  };
}

function describeAgent(f: catalog.AgentFields): string {
  return `${f.avatar} ${f.name} — ${f.description || "(no description)"}\nTools: ${JSON.parse(f.tools).join(", ") || "none"}\n\n${f.system_prompt.slice(0, 600)}`;
}

/* ---------- tools ---------- */

async function listCatalog(input: Input): Promise<string> {
  await catalog.syncShared(0);
  const d = getDb();
  if (input.kind === "agents") {
    const rows = d.prepare("SELECT id, name, description, category FROM agents ORDER BY id LIMIT ?").all(LIST_LIMIT) as AgentRow[];
    return rows.map((r) => `#${r.id} ${r.name}${r.category ? ` [${r.category}]` : ""} — ${r.description}`).join("\n") || "(no agents)";
  }
  if (input.kind === "skills") {
    const rows = d.prepare("SELECT id, name, description FROM skills ORDER BY id LIMIT ?").all(LIST_LIMIT) as Array<{ id: number; name: unknown; description: unknown }>;
    return rows.map((r) => `#${r.id} ${textOf(r.name)} — ${textOf(r.description)}`).join("\n") || "(no skills)";
  }
  const rows = d.prepare(`SELECT k.id, k.title, a.name AS agent FROM knowledge k LEFT JOIN agents a ON a.id = k.agent_id ORDER BY k.id LIMIT ?`)
    .all(LIST_LIMIT) as Array<{ id: number; title: unknown; agent: string | null }>;
  return rows.map((r) => `#${r.id} ${textOf(r.title)} — ${r.agent ? `only ${r.agent}` : "global"}`).join("\n") || "(no knowledge)";
}

async function createAgentTool(owner: Owner, input: Input, confirm: ConfirmFn): Promise<string> {
  const fields = agentFields(input);
  await gate(confirm, `Create agent:\n${describeAgent(fields)}`);
  const id = await catalog.createAgent(fields);
  logger.info(`Agent "${owner.name}" created agent #${id} "${fields.name}" in ${where()}`);
  return `Agent created: #${id} ${fields.name} — saved to ${where()}.`;
}

async function updateAgentTool(owner: Owner, input: Input, confirm: ConfirmFn): Promise<string> {
  const id = idOf(input.id);
  if (!id) throw new Error("'id' is required.");
  await catalog.syncShared();
  const base = getDb().prepare("SELECT * FROM agents WHERE id=?").get(id) as AgentRow | undefined;
  if (!base) throw new Error(`Agent #${id} not found (see catalog_list).`);
  const fields = agentFields(input, base);
  await gate(confirm, `Update agent #${id} "${base.name}":\n${describeAgent(fields)}`);
  if (!(await catalog.updateAgent(id, fields))) throw new Error(`Agent #${id} not found.`);
  logger.info(`Agent "${owner.name}" updated agent #${id} "${fields.name}" in ${where()}`);
  return `Agent updated: #${id} ${fields.name} — saved to ${where()}.`;
}

async function createSkillTool(owner: Owner, input: Input, confirm: ConfirmFn): Promise<string> {
  const name = clampStr(input.name, MAX_TITLE).trim();
  const content = clampStr(input.content, MAX_BODY).trim();
  if (!name || !content) throw new Error("'name' and 'content' are required.");
  const attach = sanitizeSkillIds(input.attach_to_agent_ids).filter(agentExists);
  if (attach.some((id) => id !== owner.id)) {
    await gate(confirm, `Create skill "${name}" and attach it to agent(s) #${attach.join(", #")}\n\n${content.slice(0, 500)}`);
  }
  const skillId = await catalog.createSkill({ name, description: clampStr(input.description, 1000), content, created_by_agent: owner.id });
  for (const agentId of attach) {
    const row = getDb().prepare("SELECT skill_ids FROM agents WHERE id=?").get(agentId) as { skill_ids: string | null };
    const ids = sanitizeSkillIds(JSON.parse(row?.skill_ids || "[]"));
    if (!ids.includes(skillId)) await catalog.setAgentSkillIds(agentId, [...ids, skillId]);
  }
  logger.info(`Agent "${owner.name}" created skill #${skillId} "${name}" in ${where()}`);
  return `Skill created: #${skillId} ${name}${attach.length ? ` (attached to #${attach.join(", #")})` : ""} — saved to ${where()}.`;
}

async function createKnowledgeTool(owner: Owner, input: Input, confirm: ConfirmFn): Promise<string> {
  const title = clampStr(input.title, MAX_TITLE).trim();
  const content = clampStr(input.content, MAX_BODY).trim();
  if (!title || !content) throw new Error("'title' and 'content' are required.");
  const agentId = idOf(input.agent_id);
  if (agentId && !agentExists(agentId)) throw new Error(`Agent #${agentId} not found (see catalog_list).`);
  if (agentId !== owner.id) {
    await gate(confirm, `Create ${agentId ? `knowledge for agent #${agentId}` : "GLOBAL knowledge (all agents)"}: "${title}"\n\n${content.slice(0, 500)}`);
  }
  const id = await catalog.createKnowledge({ title, content, agent_id: agentId, created_by_agent: owner.id });
  logger.info(`Agent "${owner.name}" created knowledge #${id} "${title}" in ${where()}`);
  return `Knowledge created: #${id} ${title} (${agentId ? `agent #${agentId}` : "global"}) — saved to ${where()}.`;
}

export async function callCatalogTool(owner: Owner, name: string, rawInput: unknown, confirm: ConfirmFn): Promise<string> {
  const input = (rawInput && typeof rawInput === "object" ? rawInput : {}) as Input;
  switch (name) {
    case "catalog_list": return listCatalog(input);
    case "agent_create": return createAgentTool(owner, input, confirm);
    case "agent_update": return updateAgentTool(owner, input, confirm);
    case "skill_create": return createSkillTool(owner, input, confirm);
    case "knowledge_create": return createKnowledgeTool(owner, input, confirm);
    default: throw new Error(`Unknown catalog tool: ${name}`);
  }
}

/** Tool calls that would touch the local SQLite file directly — refused with a pointer to the catalog tools. */
export function touchesLocalDb(text: string): boolean {
  return /\bapp\.db\b/i.test(text);
}

export const LOCAL_DB_BLOCKED =
  "Refused: this accesses the local database file (app.db) directly. That file is only a local copy — " +
  "use agent_create / agent_update / skill_create / knowledge_create (or the learn_* tools) instead, " +
  "so the change is validated and saved to the shared database.";
