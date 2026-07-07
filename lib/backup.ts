/**
 * Backup module — exports all SQLite tables to CSV files in a user-designated
 * folder. Runs once per day automatically (checked on app startup + every
 * settings page load). Can also be triggered manually.
 */
import fs from "fs";
import path from "path";
import { getDb } from "./db";
import { getConfig } from "./config";
import { getMeta, setMeta } from "./db";
import { logger } from "./logger";

const BACKUP_TABLES = [
  "agents",
  "conversations",
  "messages",
  "memories",
  "memory_audit",
  "skills",
  "knowledge",
  "manager_tasks",
  "task_assignments",
  "task_events",
  "connections",
  "app_meta",
];

const LAST_BACKUP_KEY = "last_backup_at";
const LAST_BACKUP_STATUS = "last_backup_status";

/** Escape a CSV cell (RFC 4180). */
function csvEscape(val: unknown): string {
  if (val === null || val === undefined) return "";
  const s = String(val);
  if (s.includes('"') || s.includes(",") || s.includes("\n") || s.includes("\r")) {
    return '"' + s.replace(/"/g, '""') + '"';
  }
  return s;
}

function ensureDir(dir: string) {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

/** Export a single table to a CSV file. Returns row count. */
function exportTable(dir: string, table: string): number {
  const d = getDb();
  const rows = d.prepare(`SELECT * FROM ${table}`).all() as Record<string, unknown>[];
  if (rows.length === 0) {
    // Still create file with headers so user knows the table exists
    const cols = d.prepare(`PRAGMA table_info(${table})`).all() as { name: string }[];
    const header = cols.map((c) => csvEscape(c.name)).join(",");
    fs.writeFileSync(path.join(dir, `${table}.csv`), header + "\n", "utf8");
    return 0;
  }
  const headers = Object.keys(rows[0]);
  const lines = [headers.map(csvEscape).join(",")];
  for (const row of rows) {
    lines.push(headers.map((h) => csvEscape(row[h])).join(","));
  }
  fs.writeFileSync(path.join(dir, `${table}.csv`), lines.join("\n") + "\n", "utf8");
  return rows.length;
}

/** Run a full backup. Returns { ok, tables, rows, error? }. */
export function runBackup(): {
  ok: boolean;
  dir: string;
  tables: number;
  rows: number;
  error?: string;
} {
  const cfg = getConfig();
  const dir = cfg.backupDir;
  if (!dir) {
    const msg = "Backup folder not configured — set it in Settings > Backup.";
    logger.warn(`Backup skipped: ${msg}`);
    setMeta(LAST_BACKUP_STATUS, "skipped");
    return { ok: false, dir: "", tables: 0, rows: 0, error: msg };
  }

  try {
    ensureDir(dir);
  } catch (e: unknown) {
    const msg = `Cannot create backup folder: ${e instanceof Error ? e.message : String(e)}`;
    logger.error("Backup failed", msg);
    setMeta(LAST_BACKUP_STATUS, "error");
    return { ok: false, dir, tables: 0, rows: 0, error: msg };
  }

  let totalRows = 0;
  let tablesExported = 0;

  for (const table of BACKUP_TABLES) {
    try {
      const count = exportTable(dir, table);
      totalRows += count;
      tablesExported++;
    } catch (e: unknown) {
      logger.error(`Backup: failed to export table ${table}`, e);
    }
  }

  const now = new Date().toISOString();
  setMeta(LAST_BACKUP_KEY, now);
  setMeta(LAST_BACKUP_STATUS, "ok");
  logger.info(`Backup completed: ${tablesExported} tables, ${totalRows} rows → ${dir}`);

  return { ok: true, dir, tables: tablesExported, rows: totalRows };
}

/** Info about the last backup run. */
export function backupStatus(): {
  lastRun: string | null;
  lastStatus: string | null;
  backupDir: string;
  needsBackup: boolean;
} {
  const cfg = getConfig();
  const lastRun = getMeta(LAST_BACKUP_KEY);
  const lastStatus = getMeta(LAST_BACKUP_STATUS);
  const needsBackup = !lastRun || Date.now() - new Date(lastRun).getTime() > 86_400_000;
  return { lastRun, lastStatus, backupDir: cfg.backupDir, needsBackup };
}

/**
 * Check if a daily backup is due and run it. Safe to call on every request —
 * cheap check (one meta read), only runs the actual export once per day.
 */
export function ensureDailyBackup(): void {
  const lastRun = getMeta(LAST_BACKUP_KEY);
  if (lastRun && Date.now() - new Date(lastRun).getTime() < 86_400_000) return;
  const cfg = getConfig();
  if (!cfg.backupDir) return; // no folder configured, skip silently
  runBackup();
}
