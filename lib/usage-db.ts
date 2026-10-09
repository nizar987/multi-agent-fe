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
  /** Total prompt tokens, cached + uncached. */
  input_tokens: number;
  output_tokens: number;
  /** Part of input_tokens served from the provider's prompt cache. */
  cache_read_tokens?: number;
  /** Part of input_tokens written to the provider's prompt cache. */
  cache_write_tokens?: number;
}

/** Insert one usage record. Never throws — usage logging must not break a call. */
export function recordUsage(row: UsageRow): void {
  try {
    // Skip empty records (some providers omit usage on errors/keepalives).
    if (!row.input_tokens && !row.output_tokens) return;
    getDb()
      .prepare(
        `INSERT INTO token_usage(provider, model, source, input_tokens, output_tokens, cache_read_tokens, cache_write_tokens)
         VALUES(?,?,?,?,?,?,?)`
      )
      .run(
        row.provider || "", row.model || "", row.source || "other",
        row.input_tokens | 0, row.output_tokens | 0,
        (row.cache_read_tokens ?? 0) | 0, (row.cache_write_tokens ?? 0) | 0
      );
  } catch {
    /* ignore — logging usage is best-effort */
  }
}

export interface UsageTotals {
  calls: number;
  input: number;
  output: number;
  total: number;
  cacheRead: number;
  cacheWrite: number;
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
  cache_read_tokens: number;
}
export interface UsageDaily {
  day: string;
  input: number;
  output: number;
  total: number;
}

const EMPTY: UsageTotals = { calls: 0, input: 0, output: 0, total: 0, cacheRead: 0, cacheWrite: 0 };

const SUM_COLS = `COUNT(*) AS calls,
              COALESCE(SUM(input_tokens),0)  AS input,
              COALESCE(SUM(output_tokens),0) AS output,
              COALESCE(SUM(cache_read_tokens),0)  AS cacheRead,
              COALESCE(SUM(cache_write_tokens),0) AS cacheWrite`;

type SumRow = { calls: number; input: number; output: number; cacheRead: number; cacheWrite: number };

function totals(where = ""): UsageTotals {
  const row = getDb()
    .prepare(`SELECT ${SUM_COLS} FROM token_usage ${where}`)
    .get() as SumRow | undefined;
  if (!row) return { ...EMPTY };
  return { ...row, total: row.input + row.output };
}

export interface UsageTrend {
  /** Average tokens per day over the recent window (days before today). */
  avgDaily: number;
  /** Number of past days the average is built from. */
  avgDays: number;
  /** Today vs the daily average, in percent (null when no past days yet). */
  pctVsAvg: number | null;
  /** Today vs yesterday, in percent (null when there is no yesterday data). */
  pctVsYesterday: number | null;
}

export interface UsageSummary {
  allTime: UsageTotals;
  today: UsageTotals;
  byModel: UsageByModel[];
  recent: UsageRecent[];
  daily: UsageDaily[];
  trend: UsageTrend;
}

function pctChange(current: number, base: number): number | null {
  if (base <= 0) return null;
  return ((current - base) / base) * 100;
}

/** Everything the Usage page needs, in one read. */
export function getUsageSummary(): UsageSummary {
  const db = getDb();

  const byModel = (db
    .prepare(
      `SELECT provider, model, ${SUM_COLS}
       FROM token_usage
       GROUP BY provider, model
       ORDER BY (COALESCE(SUM(input_tokens),0) + COALESCE(SUM(output_tokens),0)) DESC`
    )
    .all() as Array<SumRow & { provider: string; model: string }>).map((r) => ({
    ...r,
    total: r.input + r.output,
  }));

  const recent = db
    .prepare(
      `SELECT at, provider, model, source, input_tokens, output_tokens, cache_read_tokens
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

  const today = totals("WHERE substr(at,1,10) = substr(datetime('now'),1,10)");

  // Trend: today's usage vs the average of past days and vs yesterday.
  // `today.total` is UTC-dated (datetime('now')), so compare against the same
  // UTC day keys used in `daily`.
  const todayKey = (db.prepare("SELECT substr(datetime('now'),1,10) AS d").get() as { d: string }).d;
  const yesterdayKey = (db.prepare("SELECT substr(datetime('now','-1 day'),1,10) AS d").get() as { d: string }).d;
  const past = daily.filter((r) => r.day < todayKey); // newest first
  // Divide by the CALENDAR days spanned, not by the number of rows: a day with
  // no usage has no row, and skipping it would inflate the average (7 days of
  // work spread over a month must not read as a 7-day average).
  const oldestKey = past.length > 0 ? past[past.length - 1].day : null;
  const spannedDays =
    oldestKey === null
      ? 0
      : Math.max(
          past.length,
          Math.floor((Date.parse(`${yesterdayKey}T00:00:00Z`) - Date.parse(`${oldestKey}T00:00:00Z`)) / 86_400_000) + 1
        );
  const avgDaily = spannedDays > 0 ? Math.round(past.reduce((s, r) => s + r.total, 0) / spannedDays) : 0;
  const yesterday = daily.find((r) => r.day === yesterdayKey)?.total ?? 0;
  const trend: UsageTrend = {
    avgDaily,
    avgDays: spannedDays,
    pctVsAvg: pctChange(today.total, avgDaily),
    pctVsYesterday: pctChange(today.total, yesterday),
  };

  return {
    allTime: totals(),
    today,
    byModel,
    recent,
    daily,
    trend,
  };
}

/** Wipe the usage log (used by the "Reset" button on the Usage page). */
export function clearUsage(): void {
  getDb().prepare("DELETE FROM token_usage").run();
}
