/**
 * Agent Manager — a supervisor that sits *above* the normal agents.
 *
 * Unlike synchronous delegation (`delegate_to_agent`), the manager owns a task
 * with live state: it clarifies ambiguous requests with the user, plans the
 * work into per-agent sub-tasks, dispatches each to the best worker agent,
 * checks that the agent actually *finished*, reviews the *quality* of the
 * result (asking for revisions when needed), and finally writes a structured
 * report. All bounded by explicit guards so it never loops forever.
 *
 * It is NOT registered as an agent and cannot be reached via delegation — it is
 * a separate entry point (its own routes/pages). Worker agents it dispatches to
 * may still delegate further through the existing MAX_DELEGATION_DEPTH machinery.
 *
 * Because there is no external graph engine, "pause for clarification" is just a
 * persisted status: `runManager` returns early with status `clarifying`, and the
 * clarify endpoint resumes by calling `runManager` again once the user answers.
 */
import { getDb } from "./db";
import { callAi } from "./ai";
import { runAgent, RunEvent, RunOptions } from "./agent-runtime";
import { Attachment, buildUserContent } from "./attachments";
import { logger } from "./logger";
import {
  tasksRepo,
  assignmentsRepo,
  taskEventsRepo,
  ManagerTask,
  TaskAssignment,
} from "./manager-db";

/* ---------- Guards (section 10 of TASK.md) ---------- */
export const MAX_CLARIFICATION_ROUNDS = 2; // don't nag the user forever
export const MAX_COMPLETION_ATTEMPTS = 3; // per assignment, "is it finished?"
export const MAX_REVISIONS = 2; // per assignment, "is it correct?"
/** Hard ceiling on total dispatches so completion+revision combined stay bounded. */
const MAX_TOTAL_DISPATCHES = 5;

/**
 * Worker dispatch is two-phase: the agent first drafts an approach in PLAN mode
 * (risky actions blocked, nothing executed), then carries it out in ACT mode
 * (autonomous — no human is watching to approve each step). The plan pass runs
 * once per assignment (first attempt); retries and revisions go straight to act.
 *
 * Worker runs are also SQL read-only: agents may run SELECT queries to analyze,
 * but INSERT / UPDATE / DELETE are blocked outright — data changes are left for
 * the user to execute themselves.
 */
const WORKER_OPTS: RunOptions = { readOnlySql: true };

/** Constraint appended to every worker prompt so the agent knows the boundary. */
const SQL_CONSTRAINT =
  "Constraint: for any SQL database access you may ONLY run read-only SELECT queries to analyze. " +
  "Do NOT run INSERT/UPDATE/DELETE or any data-changing statement — those are reserved for the user to run.";

interface ActiveAgent {
  id: number;
  name: string;
  description: string;
}

function activeAgents(): ActiveAgent[] {
  return getDb()
    .prepare("SELECT id, name, description FROM agents ORDER BY id")
    .all() as ActiveAgent[];
}

/**
 * The agents this task is allowed to use. When the user picked a team in the
 * workspace, planning is restricted to those; an empty scope means "all agents".
 */
function scopedAgents(task: ManagerTask): ActiveAgent[] {
  const all = activeAgents();
  let ids: number[] = [];
  try {
    ids = JSON.parse(task.agent_ids || "[]");
  } catch {
    ids = [];
  }
  if (!ids.length) return all;
  const wanted = new Set(ids);
  const filtered = all.filter((a) => wanted.has(a.id));
  return filtered.length ? filtered : all; // fall back if the team was deleted
}

/** Attachments uploaded with the task (files/photos), parsed from the JSON column. */
function taskAttachments(task: ManagerTask): Attachment[] {
  try {
    const arr = JSON.parse(task.attachments || "[]");
    return Array.isArray(arr) ? arr : [];
  } catch {
    return [];
  }
}

/** One line for the manager's reasoning prompts so it knows files exist. */
function attachmentNote(task: ManagerTask): string {
  const atts = taskAttachments(task);
  if (atts.length === 0) return "";
  return `\n\nAttached files (each worker agent receives them): ${atts.map((a) => a.name).join(", ")}`;
}

/* -------------------------------------------------------------------------- */
/* LLM helper — the manager's own reasoning, always structured JSON            */
/* -------------------------------------------------------------------------- */

function extractText(resp: any): string {
  return (resp?.content ?? [])
    .filter((c: any) => c.type === "text")
    .map((c: any) => c.text)
    .join("\n");
}

/** Pull the first JSON object/array out of a model reply (tolerates ``` fences). */
function parseJson<T>(text: string): T {
  const cleaned = text.replace(/```(?:json)?/gi, "").trim();
  const start = cleaned.search(/[[{]/);
  if (start === -1) throw new Error("Manager LLM returned no JSON: " + text.slice(0, 200));
  // Walk to the matching close bracket so trailing prose is ignored.
  const open = cleaned[start];
  const close = open === "{" ? "}" : "]";
  let depth = 0;
  let inStr = false;
  let esc = false;
  for (let i = start; i < cleaned.length; i++) {
    const ch = cleaned[i];
    if (inStr) {
      if (esc) esc = false;
      else if (ch === "\\") esc = true;
      else if (ch === '"') inStr = false;
      continue;
    }
    if (ch === '"') inStr = true;
    else if (ch === open) depth++;
    else if (ch === close) {
      depth--;
      if (depth === 0) return JSON.parse(cleaned.slice(start, i + 1)) as T;
    }
  }
  throw new Error("Manager LLM returned malformed JSON: " + text.slice(0, 200));
}

/** One manager reasoning call that must reply with a single JSON value. Retries up to 2x on bad output. */
async function managerDecide<T>(system: string, user: string, model?: string | null): Promise<T> {
  const maxAttempts = 3;
  let lastErr: any;
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    const resp = await callAi({
      system:
        system +
        "\n\nIMPORTANT: You MUST respond with ONE valid JSON value and nothing else — no prose, no markdown fences, no explanations. " +
        "The JSON must be on its own line. Never refuse or reply with natural language.",
      messages: [{ role: "user", content: user }],
      maxTokens: 15000,
      model: model ?? undefined,
    });
    const text = extractText(resp);
    try {
      return parseJson<T>(text);
    } catch (e: any) {
      lastErr = e;
      logger.warn(`Manager LLM returned non-JSON (attempt ${attempt + 1}/${maxAttempts}): ${text.slice(0, 200)}`);
      if (attempt < maxAttempts - 1) {
        // Retry with explicit correction
        user = "You MUST respond with valid JSON only. Do not refuse or explain — return the JSON object. " +
          "Previous invalid response: " + text.slice(0, 100) + "\n\n" + user;
      }
    }
  }
  throw lastErr;
}

const noop = (_e: RunEvent) => {};

/* -------------------------------------------------------------------------- */
/* Node: intake / clarification                                                */
/* -------------------------------------------------------------------------- */

interface IntakeDecision {
  clear: boolean;
  question: string; // populated only when clear=false
  suggestions: string[]; // 2 suggested answers for the user
}

/** Collect the clarification Q&A gathered so far (from the audit trail). */
function clarificationHistory(taskId: number): string {
  const events = taskEventsRepo
    .listByTask(taskId)
    .filter((e) => e.event_type === "clarification_asked" || e.event_type === "clarification_answered");
  if (events.length === 0) return "(none yet)";
  return events
    .map((e) => (e.event_type === "clarification_asked" ? `Q: ${e.content}` : `A: ${e.content}`))
    .join("\n");
}

async function intake(task: ManagerTask): Promise<IntakeDecision> {
  const agents = scopedAgents(task);
  const roster = agents.map((a) => `- ${a.name}: ${a.description || "(no description)"}`).join("\n");
  const system =
    "You are the intake node of an Agent Manager. Decide whether a user's request is clear enough " +
    "to plan and assign to worker agents, or whether one important thing is missing (which agent/scope " +
    "is unclear, ambiguous target, etc.). Prefer proceeding: only ask when a wrong assumption would " +
    "waste real work. Output shape: {\"clear\": boolean, \"question\": string, \"suggestions\": string[]}. " +
    "When clear=true, question must be empty string and suggestions must be []. " +
    "When clear=false, ask ONE concise question and provide EXACTLY 2 short suggested answers the user " +
    "could pick (different directions/options that would both make sense).";
  const user =
    `Available worker agents:\n${roster}\n\n` +
    `User request:\n${task.original_request}${attachmentNote(task)}\n\n` +
    `Clarification so far:\n${clarificationHistory(task.id)}`;
  const decision = await managerDecide<IntakeDecision>(system, user, task.model);
  // Ensure suggestions is always an array
  if (!Array.isArray(decision.suggestions)) decision.suggestions = [];
  return decision;
}

/* -------------------------------------------------------------------------- */
/* Node: plan                                                                  */
/* -------------------------------------------------------------------------- */

interface PlannedAssignment {
  agent_name: string;
  subtask_description: string;
}

async function plan(task: ManagerTask): Promise<void> {
  const agents = scopedAgents(task);
  const roster = agents.map((a) => `- ${a.name}: ${a.description || "(no description)"}`).join("\n");
  const system =
    "You are the planning node of an Agent Manager. Break the request into one or more sub-tasks and " +
    "pair each with the single most suitable worker agent (match on the agent descriptions). Keep the " +
    "number of sub-tasks minimal — one is fine if one agent can do it all. Order them so any natural " +
    "dependency comes first (they run sequentially). Output shape: an array of " +
    "{\"agent_name\": string, \"subtask_description\": string}. Use exact agent names from the roster.";
  const user =
    `Available worker agents:\n${roster}\n\n` +
    `User request:\n${task.original_request}${attachmentNote(task)}\n\n` +
    `Clarification:\n${clarificationHistory(task.id)}` +
    (task.assumptions ? `\n\nAssumptions the manager is proceeding with:\n${task.assumptions}` : "");

  let planned = await managerDecide<PlannedAssignment[]>(system, user, task.model);
  if (!Array.isArray(planned) || planned.length === 0) {
    // Fallback: hand the whole thing to the first agent rather than stalling.
    planned = [{ agent_name: agents[0]?.name ?? "", subtask_description: task.original_request }];
  }

  const byName = new Map(agents.map((a) => [a.name, a] as const));
  let position = 0;
  for (const p of planned) {
    const agent = byName.get(p.agent_name) ?? agents[0];
    if (!agent) throw new Error("No agents exist to assign work to. Create an agent first.");
    const id = assignmentsRepo.create({
      task_id: task.id,
      agent_id: agent.id,
      agent_name: agent.name,
      subtask_description: p.subtask_description,
      position: position++,
    });
    taskEventsRepo.logEvent(
      task.id,
      "assigned",
      `${agent.name}: ${p.subtask_description}`,
      id
    );
  }
}

/* -------------------------------------------------------------------------- */
/* Node: dispatch — run the worker agent                                       */
/* -------------------------------------------------------------------------- */

async function dispatch(
  task: ManagerTask,
  a: TaskAssignment,
  extraInstruction: string
): Promise<string> {
  let prompt = a.subtask_description;
  if (extraInstruction) prompt += `\n\n${extraInstruction}`;
  prompt += `\n\n${SQL_CONSTRAINT}`;

  // Worker options: read-only SQL always; force the task's model when set.
  const opts: RunOptions = { ...WORKER_OPTS, ...(task.model ? { modelOverride: task.model } : {}) };

  assignmentsRepo.update(a.id, { status: "in_progress" });

  // ---- Phase 1: PLAN (first attempt only) ----
  // The agent thinks through its approach with risky actions blocked, so the
  // plan is visible before anything runs for real.
  // Files/photos uploaded with the task go to every worker as vision/text blocks.
  const atts = taskAttachments(task);

  let planText = "";
  if (a.attempt_count === 0) {
    try {
      planText = await runAgent(
        a.agent_id,
        [
          {
            role: "user",
            content: buildUserContent(
              `${prompt}\n\nFirst, produce a short step-by-step PLAN of how you will complete this sub-task. Do NOT execute anything yet — just the plan.`,
              atts
            ),
          },
        ],
        noop,
        0,
        "plan",
        opts
      );
    } catch {
      planText = "";
    }
    assignmentsRepo.update(a.id, { last_plan: planText || null });
    taskEventsRepo.logEvent(task.id, "dispatched", `plan drafted:\n${planText.slice(0, 500)}`, a.id);
  }

  // ---- Phase 2: ACT (execute for real) ----
  const actPrompt = planText
    ? `${prompt}\n\nHere is the plan you drafted:\n${planText}\n\nNow carry it out fully and report the result.`
    : prompt;
  taskEventsRepo.logEvent(task.id, "dispatched", `executing (attempt ${a.attempt_count + 1})`, a.id);

  let result: string;
  try {
    result = await runAgent(a.agent_id, [{ role: "user", content: buildUserContent(actPrompt, atts) }], noop, 0, "act", opts);
  } catch (e: unknown) {
    result = `Agent error: ${e instanceof Error ? e.message : String(e)}`;
  }

  assignmentsRepo.update(a.id, {
    status: "submitted",
    last_result: result,
    attempt_count: a.attempt_count + 1,
  });
  taskEventsRepo.logEvent(task.id, "submitted", result.slice(0, 500), a.id);
  return result;
}

/* -------------------------------------------------------------------------- */
/* Node: completion check — did the agent actually finish?                     */
/* -------------------------------------------------------------------------- */

interface CompletionResult {
  complete: boolean;
  reason: string;
}

async function checkCompletion(a: TaskAssignment, result: string, model?: string | null): Promise<CompletionResult> {
  const system =
    "You are the completion-check node of an Agent Manager. Judge only whether the agent has actually " +
    "FINISHED the assigned sub-task — not whether the answer is correct or high quality. A half-done " +
    "answer, a promise to do it later, or a clarifying question back counts as NOT complete. " +
    'Output shape: {"complete": boolean, "reason": string}. Reason is short.';
  const user = `Sub-task:\n${a.subtask_description}\n\nAgent result:\n${result}`;
  return managerDecide<CompletionResult>(system, user, model);
}

/* -------------------------------------------------------------------------- */
/* Node: review — is the result correct / good enough?                         */
/* -------------------------------------------------------------------------- */

interface ReviewResult {
  approved: boolean;
  notes: string;
}

async function review(a: TaskAssignment, result: string, model?: string | null): Promise<ReviewResult> {
  const system =
    "You are the review/QA node of an Agent Manager. The sub-task is already finished; judge the " +
    "QUALITY and CORRECTNESS of the result against the sub-task. If the agent had tools (e.g. file/repo " +
    "reads) and you can tell the output contradicts the stated source or looks fabricated, reject it. " +
    "Be pragmatic — approve results that genuinely satisfy the sub-task even if imperfect. " +
    'Output shape: {"approved": boolean, "notes": string}. When rejecting, notes must say concretely ' +
    "what to fix so the agent can revise.";
  const user = `Sub-task:\n${a.subtask_description}\n\nAgent result:\n${result}`;
  return managerDecide<ReviewResult>(system, user, model);
}

/* -------------------------------------------------------------------------- */
/* Per-assignment loop: dispatch -> completion -> review, with guards          */
/* -------------------------------------------------------------------------- */

async function runAssignment(task: ManagerTask, assignmentId: number): Promise<void> {
  let extra = "";

  while (true) {
    let a = assignmentsRepo.get(assignmentId)!;

    // Hard ceiling so completion + revision combined can't run away.
    if (a.attempt_count >= MAX_TOTAL_DISPATCHES) {
      assignmentsRepo.update(a.id, { status: "failed" });
      taskEventsRepo.logEvent(task.id, "task_failed", "attempt ceiling reached", a.id);
      return;
    }

    const result = await dispatch(task, a, extra);
    a = assignmentsRepo.get(assignmentId)!; // refresh (attempt_count bumped)

    // ---- completion check ----
    const comp = await checkCompletion(a, result, task.model);
    if (!comp.complete) {
      taskEventsRepo.logEvent(task.id, "completion_check_failed", comp.reason, a.id);
      if (a.attempt_count >= MAX_COMPLETION_ATTEMPTS) {
        assignmentsRepo.update(a.id, {
          status: "failed",
          last_review_notes: `Not completed after ${a.attempt_count} attempts: ${comp.reason}`,
        });
        taskEventsRepo.logEvent(task.id, "task_failed", `completion: ${comp.reason}`, a.id);
        return;
      }
      extra = `This is NOT finished yet because: ${comp.reason}. Continue and complete the sub-task fully.`;
      continue; // back to dispatch
    }

    // ---- review / QA ----
    const rev = await review(a, result, task.model);
    if (rev.approved) {
      assignmentsRepo.update(a.id, { status: "approved", last_review_notes: rev.notes || null });
      taskEventsRepo.logEvent(task.id, "review_passed", rev.notes, a.id);
      taskEventsRepo.logEvent(task.id, "assignment_approved", null, a.id);
      return;
    }

    // rejected -> revision
    taskEventsRepo.logEvent(task.id, "review_failed", rev.notes, a.id);
    if (a.revision_count >= MAX_REVISIONS) {
      assignmentsRepo.update(a.id, { status: "failed", last_review_notes: rev.notes });
      taskEventsRepo.logEvent(task.id, "task_failed", `review: ${rev.notes}`, a.id);
      return;
    }
    assignmentsRepo.update(a.id, {
      status: "needs_revision",
      last_review_notes: rev.notes,
      revision_count: a.revision_count + 1,
    });
    taskEventsRepo.logEvent(task.id, "revision_requested", rev.notes, a.id);
    // Revised work must pass completion check again too — loop back to dispatch.
    extra = `A reviewer rejected the previous result. Fix these issues and redo the sub-task:\n${rev.notes}`;
  }
}

/* -------------------------------------------------------------------------- */
/* Node: report                                                                */
/* -------------------------------------------------------------------------- */

function buildReport(task: ManagerTask, assignments: TaskAssignment[]): string {
  const approved = assignments.filter((a) => a.status === "approved");
  const failed = assignments.filter((a) => a.status === "failed");
  const allOk = failed.length === 0;
  const noneOk = approved.length === 0;

  const summary = noneOk
    ? "**Task failed** — no sub-task could be completed satisfactorily."
    : allOk
    ? "**Task completed** — all sub-tasks approved."
    : `**Task partially completed** — ${approved.length} of ${assignments.length} sub-tasks approved.`;

  const perAssignment = assignments
    .map((a, i) => {
      const label =
        a.status === "approved" ? "✅ approved" : a.status === "failed" ? "❌ failed" : a.status;
      return `${i + 1}. **${a.agent_name}** — ${a.subtask_description}\n   Status: ${label}` +
        (a.status === "failed" && a.last_review_notes ? `\n   Reason: ${a.last_review_notes}` : "");
    })
    .join("\n");

  // Highlights (mandatory section).
  const highlights: string[] = [];
  for (const a of failed) {
    highlights.push(
      `⚠️ **${a.agent_name}** failed after ${a.attempt_count} attempt(s): ${a.last_review_notes ?? "see events"}`
    );
  }
  if (task.assumptions) {
    highlights.push(`ℹ️ Proceeded on assumption(s): ${task.assumptions}`);
  }
  for (const a of assignments) {
    if (a.revision_count >= 2) {
      highlights.push(`🔁 **${a.agent_name}** needed ${a.revision_count} revisions — a tricky sub-task.`);
    }
  }
  const highlightBlock = highlights.length ? highlights.map((h) => `- ${h}`).join("\n") : "- Nothing notable — clean run.";

  return (
    `${summary}\n\n` +
    `### Per assignment\n${perAssignment}\n\n` +
    `### Highlights\n${highlightBlock}\n\n` +
    `_Full per-agent output is available in the assignment details below._`
  );
}

/* -------------------------------------------------------------------------- */
/* Driver                                                                      */
/* -------------------------------------------------------------------------- */

/**
 * Advance a task from wherever it is to either a clarification pause or a
 * terminal state. Safe to call fresh (after create) or to resume (after the
 * user answers a clarification). Runs to completion in the background.
 */
export async function runManager(taskId: number): Promise<void> {
  try {
    let task = tasksRepo.get(taskId);
    if (!task) return;
    if (task.status === "done" || task.status === "failed") return;

    // ---- Intake & clarification (only before we've planned) ----
    const alreadyPlanned = assignmentsRepo.listByTask(taskId).length > 0;
    if (!alreadyPlanned) {
      const decision = await intake(task);
      if (!decision.clear && task.clarification_rounds < MAX_CLARIFICATION_ROUNDS) {
        tasksRepo.update(taskId, {
          status: "clarifying",
          clarification_question: decision.question,
          clarification_options: JSON.stringify((decision.suggestions ?? []).slice(0, 2)),
          clarification_rounds: task.clarification_rounds + 1,
        });
        taskEventsRepo.logEvent(taskId, "clarification_asked", decision.question);
        return; // pause — resumed by answerClarification()
      }

      // Clear, or out of clarification budget: record an assumption note if we
      // gave up on a still-ambiguous request, then plan.
      if (!decision.clear) {
        const note =
          task.assumptions ??
          "Request stayed ambiguous after the clarification limit; proceeded with the manager's best interpretation.";
        tasksRepo.update(taskId, { assumptions: note });
        task = tasksRepo.get(taskId)!;
      }

      tasksRepo.update(taskId, { status: "planning", clarification_question: null });
      task = tasksRepo.get(taskId)!;
      await plan(task);
    }

    // ---- Execute assignments sequentially ----
    tasksRepo.update(taskId, { status: "in_progress" });
    const assignments = assignmentsRepo.listByTask(taskId);
    for (const a of assignments) {
      if (a.status === "approved" || a.status === "failed") continue; // resume-safe
      await runAssignment(task, a.id);
    }

    // ---- Report ----
    tasksRepo.update(taskId, { status: "reporting" });
    const finalAssignments = assignmentsRepo.listByTask(taskId);
    const report = buildReport(task, finalAssignments);
    const anyApproved = finalAssignments.some((a) => a.status === "approved");
    const finalStatus = anyApproved ? "done" : "failed";
    tasksRepo.update(taskId, { status: finalStatus, report });
    taskEventsRepo.logEvent(taskId, anyApproved ? "task_completed" : "task_failed");
    logger.info(`Manager task ${taskId} finished with status: ${finalStatus}`);
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    logger.error(`Manager task ${taskId} crashed`, msg);
    tasksRepo.update(taskId, {
      status: "failed",
      report: `The manager hit an unrecoverable error: ${msg}`,
    });
    taskEventsRepo.logEvent(taskId, "task_failed", msg);
  }
}

/* -------------------------------------------------------------------------- */
/* Public entry points (used by the API routes)                                */
/* -------------------------------------------------------------------------- */

/** Create a task and kick the manager off in the background. Returns the id. */
export function startTask(
  originalRequest: string,
  title?: string,
  agentIds: number[] = [],
  model: string | null = null,
  attachments: Attachment[] = []
): number {
  const clean = originalRequest.trim();
  const id = tasksRepo.create(
    (title || clean).slice(0, 80) || "Untitled task",
    clean,
    agentIds,
    model,
    attachments.length ? JSON.stringify(attachments) : null
  );
  logger.info(`Manager task created (id=${id}): ${clean.slice(0, 100)}${attachments.length ? ` [+${attachments.length} attachment(s)]` : ""}`);
  // Fire-and-forget: the route responds immediately; the UI polls for status.
  void runManager(id);
  return id;
}

/** Record a clarification answer and resume the manager. */
export function answerClarification(taskId: number, answer: string): boolean {
  const task = tasksRepo.get(taskId);
  if (!task || task.status !== "clarifying") return false;
  taskEventsRepo.logEvent(taskId, "clarification_answered", answer.trim());
  tasksRepo.update(taskId, { status: "planning", clarification_question: null });
  void runManager(taskId);
  return true;
}
