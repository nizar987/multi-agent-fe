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

function write(level: "INFO" | "WARN" | "ERROR", msg: string) {
  const line = `[${ts()}] [${level}] ${msg}\n`;
  try {
    fs.appendFileSync(logFile(), line);
    trim();
  } catch {
    /* swallow — logging must never crash the app */
  }
}

/** Keep log file under MAX_LINES. */
function trim() {
  try {
    const content = fs.readFileSync(logFile(), "utf8");
    const lines = content.split("\n");
    if (lines.length > MAX_LINES) {
      const trimmed = lines.slice(lines.length - MAX_LINES).join("\n");
      fs.writeFileSync(logFile(), trimmed);
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
