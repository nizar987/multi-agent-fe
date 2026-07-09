/**
 * Schedule tools — let an agent manage its OWN cron jobs from chat, so the
 * user can say "run this every morning" without opening the Cron settings.
 */
import { getDb } from "./db";
import type { AiTool } from "./ai";
import { buildSchedule, describeCron, DEFAULT_SCHEDULE, Freq } from "./schedule";

export const cronToolDefs: AiTool[] = [
  {
    name: "schedule_task_create",
    description:
      "Create a recurring scheduled task (cron job) that runs YOU (this agent) automatically with a given prompt. " +
      "Before creating one, use ask_user to confirm the schedule with the user — offer a few schedule options and mark the recommended one.",
    input_schema: {
      type: "object",
      properties: {
        name: { type: "string", description: "short human-readable name, e.g. 'Daily summary'" },
        frequency: {
          type: "string",
          enum: ["hourly", "daily", "weekdays", "weekly", "monthly", "custom"],
          description: "how often to run",
        },
        time: { type: "string", description: "time of day as HH:MM (24h), e.g. '09:00' — required except for hourly/custom" },
        weekday: { type: "integer", minimum: 0, maximum: 6, description: "0=Sunday … 6=Saturday — required for weekly" },
        monthday: { type: "integer", minimum: 1, maximum: 31, description: "day of the month — required for monthly" },
        custom_expression: { type: "string", description: "raw cron expression — only for frequency 'custom'" },
        prompt: { type: "string", description: "the task prompt this agent should execute on each run" },
      },
      required: ["name", "frequency", "prompt"],
    },
  },
  {
    name: "schedule_task_list",
    description: "List the scheduled tasks (cron jobs) that belong to you (this agent).",
    input_schema: { type: "object", properties: {} },
  },
  {
    name: "schedule_task_delete",
    description: "Delete one of YOUR scheduled tasks by id (see schedule_task_list). Confirm with the user first.",
    input_schema: {
      type: "object",
      properties: { id: { type: "integer", description: "the scheduled task id" } },
      required: ["id"],
    },
  },
];

interface CreateInput {
  name?: string;
  frequency?: Freq;
  time?: string;
  weekday?: number;
  monthday?: number;
  custom_expression?: string;
  prompt?: string;
}

export async function callCronTool(agentId: number, tool: string, input: unknown): Promise<string> {
  const db = getDb();

  if (tool === "schedule_task_list") {
    const jobs = db
      .prepare("SELECT id, name, schedule, prompt, enabled, last_run FROM cron_jobs WHERE agent_id=? ORDER BY id")
      .all(agentId) as any[];
    if (jobs.length === 0) return "No scheduled tasks yet.";
    return jobs
      .map((j) =>
        `#${j.id} "${j.name}" — ${describeCron(j.schedule)} ${j.enabled ? "(active)" : "(paused)"}\n` +
        `  prompt: ${String(j.prompt).slice(0, 120)}${j.prompt.length > 120 ? "…" : ""}` +
        (j.last_run ? `\n  last run: ${j.last_run}` : "")
      )
      .join("\n");
  }

  if (tool === "schedule_task_create") {
    const inp = (input ?? {}) as CreateInput;
    if (!inp.name?.trim()) throw new Error("name is required.");
    if (!inp.prompt?.trim()) throw new Error("prompt is required.");
    const freq = inp.frequency ?? "daily";
    if (["daily", "weekdays", "weekly", "monthly"].includes(freq) && !/^\d{1,2}:\d{2}$/.test(inp.time ?? ""))
      throw new Error("time must be HH:MM (24h), e.g. '09:00'.");
    if (freq === "weekly" && (inp.weekday === undefined || inp.weekday < 0 || inp.weekday > 6))
      throw new Error("weekday (0=Sunday…6=Saturday) is required for weekly.");
    if (freq === "monthly" && (inp.monthday === undefined || inp.monthday < 1 || inp.monthday > 31))
      throw new Error("monthday (1–31) is required for monthly.");
    if (freq === "custom" && !inp.custom_expression?.trim())
      throw new Error("custom_expression is required for custom frequency.");

    const expr = buildSchedule({
      ...DEFAULT_SCHEDULE,
      freq,
      time: inp.time ?? DEFAULT_SCHEDULE.time,
      weekday: inp.weekday ?? DEFAULT_SCHEDULE.weekday,
      monthday: inp.monthday ?? DEFAULT_SCHEDULE.monthday,
      custom: inp.custom_expression ?? DEFAULT_SCHEDULE.custom,
    });

    const cron = await import("node-cron");
    if (!cron.validate(expr)) throw new Error(`Invalid schedule (${expr}).`);

    const r = db
      .prepare("INSERT INTO cron_jobs(agent_id,name,schedule,prompt,enabled) VALUES(?,?,?,?,1)")
      .run(agentId, inp.name.trim(), expr, inp.prompt.trim());

    // dynamic import to avoid a circular dependency (cron.ts -> agent-runtime -> tools-cron)
    const { reloadCronJobs } = await import("./cron");
    reloadCronJobs();

    return `Scheduled task #${r.lastInsertRowid} "${inp.name.trim()}" created — runs ${describeCron(expr)}.`;
  }

  if (tool === "schedule_task_delete") {
    const id = Number((input as any)?.id);
    if (!Number.isInteger(id)) throw new Error("id is required.");
    const job = db.prepare("SELECT id, name FROM cron_jobs WHERE id=? AND agent_id=?").get(id, agentId) as any;
    if (!job) throw new Error(`Scheduled task #${id} not found (or belongs to another agent).`);
    db.prepare("DELETE FROM cron_jobs WHERE id=?").run(id);
    const { reloadCronJobs } = await import("./cron");
    reloadCronJobs();
    return `Scheduled task #${id} "${job.name}" deleted.`;
  }

  throw new Error("Unknown schedule tool.");
}
