/**
 * Cron scheduler — runs agent tasks on a schedule.
 * Loads jobs from DB, schedules them with node-cron, and executes the agent.
 */
import * as cron from "node-cron";
import { getDb } from "./db";
import { runAgent, RunEvent } from "./agent-runtime";
import { hasSecret } from "./config";
import { logger } from "./logger";

type CronJob = {
  id: number;
  agent_id: number;
  name: string;
  schedule: string;
  prompt: string;
  enabled: number;
  last_run: string | null;
};

type ActiveTask = {
  id: number;
  task: ReturnType<typeof cron.schedule>;
};

const activeTasks = new Map<number, ActiveTask>();

function noop(_e: RunEvent) {}

async function executeJob(job: CronJob) {
  logger.info(`Cron job ${job.id} "${job.name}" triggered for agent ${job.agent_id}`);
  if (!hasSecret("aiApiKey")) {
    logger.warn(`Cron job ${job.id} skipped — no AI API key configured`);
    return;
  }

  const db = getDb();

  // Create or find a conversation for this agent's cron runs
  const convTitle = `__cron__${job.id}`;
  let conv = db
    .prepare("SELECT id FROM conversations WHERE agent_id=? AND title=?")
    .get(job.agent_id, convTitle) as any;
  if (!conv) {
    const r = db.prepare("INSERT INTO conversations(agent_id,title) VALUES(?,?)").run(job.agent_id, convTitle);
    conv = { id: Number(r.lastInsertRowid) };
  }

  // Save user message
  db.prepare("INSERT INTO messages(conversation_id,role,content) VALUES(?,?,?)")
    .run(conv.id, "user", job.prompt);

  // Build history
  const history = (db
    .prepare("SELECT role, content, meta FROM messages WHERE conversation_id=? AND role IN ('user','assistant') ORDER BY id")
    .all(conv.id) as any[])
    .map((m) => ({ role: m.role as "user" | "assistant", content: m.content }));

  try {
    const finalText = await runAgent(job.agent_id, history, noop, 0, "act");
    db.prepare("INSERT INTO messages(conversation_id,role,content) VALUES(?,?,?)")
      .run(conv.id, "assistant", finalText || "(no answer)");
    logger.info(`Cron job ${job.id} completed`);
  } catch (e: any) {
    logger.error(`Cron job ${job.id} failed: ${e?.message ?? e}`);
  }

  // Update last_run
  db.prepare("UPDATE cron_jobs SET last_run=datetime('now') WHERE id=?").run(job.id);
}

function scheduleJob(job: CronJob) {
  // Cancel existing task if any
  const existing = activeTasks.get(job.id);
  if (existing) {
    existing.task.stop();
    activeTasks.delete(job.id);
  }

  if (!job.enabled) return;
  if (!cron.validate(job.schedule)) {
    logger.warn(`Cron job ${job.id} has invalid schedule: ${job.schedule}`);
    return;
  }

  const task = cron.schedule(job.schedule, () => executeJob(job), {
    timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
  });

  activeTasks.set(job.id, { id: job.id, task });
  logger.info(`Cron job ${job.id} "${job.name}" scheduled: ${job.schedule}`);
}

export function loadCronJobs() {
  const db = getDb();
  const jobs = db.prepare("SELECT * FROM cron_jobs").all() as CronJob[];
  for (const job of jobs) {
    scheduleJob(job);
  }
  logger.info(`Loaded ${jobs.length} cron jobs`);
}

export function reloadCronJobs() {
  // Stop all existing tasks
  for (const task of activeTasks.values()) {
    task.task.stop();
  }
  activeTasks.clear();
  loadCronJobs();
}

export function stopAllCronJobs() {
  for (const task of activeTasks.values()) {
    task.task.stop();
  }
  activeTasks.clear();
}
