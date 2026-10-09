/**
 * Simple file-based logger. Writes to data/logs/app.log.
 * Keeps last 5000 lines to prevent unbounded growth.
 */
import fs from "fs";
import path from "path";
import { getDataDir } from "./paths";

const MAX_LINES = 5000;

function logDir(): string {
  const dir = path.join(getDataDir(), "logs");
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  return dir;
}

function logFile(): string {
  return path.join(logDir(), "app.log");
}

function ts(): string {
  return new Date().toISOString().replace("T", " ").replace("Z", "");
}

/** How often to check if the log file needs trimming (every 100 writes). */
let writeCount = 0;
const TRIM_INTERVAL = 100;

function write(level: "INFO" | "WARN" | "ERROR", msg: string) {
  const line = `[${ts()}] [${level}] ${msg}\n`;
  try {
    fs.appendFileSync(logFile(), line);
    // 🟠 MAJOR: trim was reading+writing the entire file on every log call.
    // Now only trim every TRIM_INTERVAL writes to avoid O(n) I/O per log line.
    writeCount++;
    if (writeCount % TRIM_INTERVAL === 0) trim();
  } catch {
    /* swallow — logging must never crash the app */
  }
}

/** Keep log file under MAX_LINES. Called periodically, not on every write. */
function trim() {
  try {
    const file = logFile();
    const stat = fs.statSync(file);
    // Skip trim if file is small (< 512 KB) — not worth the read cost.
    if (stat.size < 512 * 1024) return;
    const content = fs.readFileSync(file, "utf8");
    const lines = content.split("\n");
    if (lines.length > MAX_LINES) {
      const trimmed = lines.slice(lines.length - MAX_LINES).join("\n");
      fs.writeFileSync(file, trimmed);
    }
  } catch {
    /* ignore */
  }
}

export const logger = {
  info: (msg: string) => write("INFO", msg),
  warn: (msg: string) => write("WARN", msg),
  error: (msg: string, err?: unknown) => {
    const detail = err instanceof Error ? err.message : typeof err === "string" ? err : "";
    write("ERROR", detail ? `${msg}: ${detail}` : msg);
  },
};

/** Read last N lines from the log file. */
export function tailLog(n = 200): string[] {
  try {
    const content = fs.readFileSync(logFile(), "utf8");
    const lines = content.trim().split("\n");
    return lines.slice(-n);
  } catch {
    return [];
  }
}
