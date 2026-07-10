/**
 * Token-usage log — one row per AI call, written from the single choke point in
 * lib/ai.ts so every chat / workspace / manager / tool call is counted. The
 * Usage page reads the aggregates below.
 */
import { getDb } from "./db";

export interface UsageRow {
  provider: string;
  model: string;
  source: string;
  input_tokens: number;
  output_tokens: number;
}

/** Insert one usage record. Never throws — usage logging must not break a call. */
export function recordUsage(row: UsageRow): void {
  try {
    // Skip empty records (some providers omit usage on errors/keepalives).
    if (!row.input_tokens && !row.output_tokens) return;
    getDb()
      .prepare(
        "INSERT INTO token_usage(provider, model, source, input_tokens, output_tokens) VALUES(?,?,?,?,?)"
      )
      .run(row.provider || "", row.model || "", row.source || "other", row.input_tokens | 0, row.output_tokens | 0);
  } catch {
    /* ignore — logging usage is best-effort */
  }
}

export interface UsageTotals {
  calls: number;
  input: number;
  output: number;
  total: number;
}
export interface UsageByModel extends UsageTotals {
  provider: string;
  model: string;
}
export interface UsageRecent {
  at: string;
  provider: string;
  model: string;
  source: string;
  input_tokens: number;
  output_tokens: number;
}
export interface UsageDaily {
  day: string;
  input: number;
  output: number;
  total: number;
}

const EMPTY: UsageTotals = { calls: 0, input: 0, output: 0, total: 0 };

function totals(where = ""): UsageTotals {
  const row = getDb()
    .prepare(
      `SELECT COUNT(*) AS calls,
              COALESCE(SUM(input_tokens),0)  AS input,
              COALESCE(SUM(output_tokens),0) AS output
       FROM token_usage ${where}`
    )
    .get() as { calls: number; input: number; output: number } | undefined;
  if (!row) return { ...EMPTY };
  return { calls: row.calls, input: row.input, output: row.output, total: row.input + row.output };
}

export interface UsageSummary {
  allTime: UsageTotals;
  today: UsageTotals;
  byModel: UsageByModel[];
  recent: UsageRecent[];
  daily: UsageDaily[];
}

/** Everything the Usage page needs, in one read. */
export function getUsageSummary(): UsageSummary {
  const db = getDb();

  const byModel = (db
    .prepare(
      `SELECT provider, model,
              COUNT(*) AS calls,
              COALESCE(SUM(input_tokens),0)  AS input,
              COALESCE(SUM(output_tokens),0) AS output
       FROM token_usage
       GROUP BY provider, model
       ORDER BY (COALESCE(SUM(input_tokens),0) + COALESCE(SUM(output_tokens),0)) DESC`
    )
    .all() as Array<{ provider: string; model: string; calls: number; input: number; output: number }>).map((r) => ({
    ...r,
    total: r.input + r.output,
  }));

  const recent = db
    .prepare(
      `SELECT at, provider, model, source, input_tokens, output_tokens
       FROM token_usage ORDER BY id DESC LIMIT 25`
    )
    .all() as UsageRecent[];

  const daily = (db
    .prepare(
      `SELECT substr(at,1,10) AS day,
              COALESCE(SUM(input_tokens),0)  AS input,
              COALESCE(SUM(output_tokens),0) AS output
       FROM token_usage
       GROUP BY day ORDER BY day DESC LIMIT 14`
    )
    .all() as Array<{ day: string; input: number; output: number }>).map((r) => ({
    ...r,
    total: r.input + r.output,
  }));

  return {
    allTime: totals(),
    today: totals("WHERE substr(at,1,10) = substr(datetime('now'),1,10)"),
    byModel,
    recent,
    daily,
  };
}

/** Wipe the usage log (used by the "Reset" button on the Usage page). */
export function clearUsage(): void {
  getDb().prepare("DELETE FROM token_usage").run();
}
