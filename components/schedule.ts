/**
 * Friendly schedule <-> cron expression helpers, shared by CronManager
 * (Settings) and AgentCronSection (per-agent schedules).
 */

export type Freq = "hourly" | "daily" | "weekdays" | "weekly" | "monthly" | "custom";

export const DAY_NAMES = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

export interface FriendlySchedule {
  freq: Freq;
  /** "HH:MM" for the time picker */
  time: string;
  /** 0–6 (Sunday–Saturday), for weekly */
  weekday: number;
  /** 1–31, for monthly */
  monthday: number;
  /** raw expression, for custom */
  custom: string;
}

export const DEFAULT_SCHEDULE: FriendlySchedule = {
  freq: "daily", time: "09:00", weekday: 1, monthday: 1, custom: "0 9 * * *",
};

const pad = (n: number) => String(n).padStart(2, "0");

/** Turn a cron expression back into friendly fields (falls back to custom). */
export function parseSchedule(expr: string): FriendlySchedule {
  const s = { ...DEFAULT_SCHEDULE, custom: expr };
  const f = expr.trim().split(/\s+/);
  if (f.length !== 5) return { ...s, freq: "custom" };
  const [min, hour, dom, mon, dow] = f;
  const m = /^\d{1,2}$/.test(min) ? Number(min) : null;
  const h = /^\d{1,2}$/.test(hour) ? Number(hour) : null;

  if (m !== null && hour === "*" && dom === "*" && mon === "*" && dow === "*")
    return { ...s, freq: "hourly" };
  if (m === null || h === null || mon !== "*") return { ...s, freq: "custom" };
  const time = `${pad(h)}:${pad(m)}`;
  if (dom === "*" && dow === "*") return { ...s, freq: "daily", time };
  if (dom === "*" && dow === "1-5") return { ...s, freq: "weekdays", time };
  if (dom === "*" && /^[0-6]$/.test(dow)) return { ...s, freq: "weekly", time, weekday: Number(dow) };
  if (dow === "*" && /^\d{1,2}$/.test(dom)) return { ...s, freq: "monthly", time, monthday: Number(dom) };
  return { ...s, freq: "custom" };
}

/** Build the cron expression from friendly fields. */
export function buildSchedule(s: FriendlySchedule): string {
  const [h, m] = s.time.split(":").map(Number);
  switch (s.freq) {
    case "hourly":   return "0 * * * *";
    case "daily":    return `${m} ${h} * * *`;
    case "weekdays": return `${m} ${h} * * 1-5`;
    case "weekly":   return `${m} ${h} * * ${s.weekday}`;
    case "monthly":  return `${m} ${h} ${s.monthday} * *`;
    case "custom":   return s.custom.trim();
  }
}

/** Human-readable description of a cron expression. */
export function describeCron(expr: string): string {
  const s = parseSchedule(expr);
  switch (s.freq) {
    case "hourly":   return "Every hour";
    case "daily":    return `Every day at ${s.time}`;
    case "weekdays": return `Weekdays (Mon–Fri) at ${s.time}`;
    case "weekly":   return `Every ${DAY_NAMES[s.weekday]} at ${s.time}`;
    case "monthly":  return `Every month on day ${s.monthday} at ${s.time}`;
    case "custom":   return expr;
  }
}
