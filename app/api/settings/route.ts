import { NextRequest, NextResponse } from "next/server";
import {
  getConfig, updateConfig, hasSecret, secretTail, secretBackendLabel,
  AppConfig,
  ConfigPatch,
} from "@/lib/config";
import { backupStatus, ensureDailyBackup } from "@/lib/backup";
import { loadCronJobs } from "@/lib/cron";
import { logger } from "@/lib/logger";

export const dynamic = "force-dynamic";

let cronLoaded = false;

export async function GET() {
  ensureDailyBackup();
  if (!cronLoaded) { cronLoaded = true; loadCronJobs(); }
  const cfg = getConfig();
  return NextResponse.json({
    config: cfg,
    secrets: {
      aiApiKey: { set: hasSecret("aiApiKey"), tail: secretTail("aiApiKey") },
      githubToken: { set: hasSecret("githubToken"), tail: secretTail("githubToken") },
      gitlabToken: { set: hasSecret("gitlabToken"), tail: secretTail("gitlabToken") },
      dbPassword: { set: hasSecret("dbPassword"), tail: secretTail("dbPassword") },
      redisPassword: { set: hasSecret("redisPassword"), tail: secretTail("redisPassword") },
      tavilyApiKey: { set: hasSecret("tavilyApiKey"), tail: secretTail("tavilyApiKey") },
      sharedDbUrl: { set: hasSecret("sharedDbUrl"), tail: secretTail("sharedDbUrl") },
    },
    secretBackend: secretBackendLabel(),
    backup: backupStatus(),
  });
}

/**
 * Allowed top-level keys in the config patch.
 * Prevents arbitrary key injection into config.json.
 */
const ALLOWED_CONFIG_KEYS: Array<keyof AppConfig> = [
  "ai", "gitlab", "database", "redis", "filesystem",
  "context", "backupDir", "ui", "onboardingDone",
];

const MAX_STRING_LENGTH = 2048;
const MAX_DIRS = 50;

function sanitizeString(v: unknown, maxLen = MAX_STRING_LENGTH): string {
  if (typeof v !== "string") return "";
  // Reject null bytes and control chars (except tab/newline which are valid in paths)
  return v.replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, "").slice(0, maxLen);
}

/** A section object in the patch, or null when the value isn't a plain object. */
function section(val: unknown): Record<string, unknown> | null {
  return val && typeof val === "object" && !Array.isArray(val) ? (val as Record<string, unknown>) : null;
}

/**
 * Copy `field` from `src` to `dst` ONLY when the caller actually sent it.
 * updateConfig() merges each section onto the stored one, so an absent field
 * must stay absent — writing a default here would wipe the user's value
 * whenever a page saves a partial section (e.g. `{ai:{baseUrl,model}}`).
 */
function pick<T>(
  dst: Record<string, unknown>,
  src: Record<string, unknown>,
  field: string,
  coerce: (v: unknown) => T
): void {
  if (!(field in src)) return;
  dst[field] = coerce(src[field]);
}

const oneOf = <T extends string>(allowed: readonly T[], fallback: T) => (v: unknown): T =>
  allowed.includes(v as T) ? (v as T) : fallback;

const clampNum = (min: number, max: number, fallback: number) => (v: unknown): number => {
  const n = Number(v);
  return Number.isFinite(n) ? Math.max(min, Math.min(n, max)) : fallback;
};

/** Validate and sanitize the incoming config patch. Returns null if invalid. */
function sanitizePatch(raw: unknown): ConfigPatch | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const patch = raw as Record<string, unknown>;

  // Strip any key not in the allowlist
  const cleaned: Record<string, unknown> = {};
  for (const key of ALLOWED_CONFIG_KEYS) {
    if (!(key in patch)) continue;
    const val = patch[key];

    if (key === "ai") {
      const ai = section(val);
      if (!ai) continue;
      const out: Record<string, unknown> = {};
      pick(out, ai, "baseUrl", (v) => sanitizeString(v) || "https://api.anthropic.com");
      pick(out, ai, "model", (v) => sanitizeString(v));
      pick(out, ai, "provider", oneOf(["auto", "anthropic", "openai", "gemini"] as const, "auto"));
      pick(out, ai, "visionModel", (v) => sanitizeString(v));
      cleaned.ai = out;
    } else if (key === "gitlab") {
      const gl = section(val);
      if (!gl) continue;
      const out: Record<string, unknown> = {};
      pick(out, gl, "apiUrl", (v) => sanitizeString(v) || "https://gitlab.com/api/v4");
      cleaned.gitlab = out;
    } else if (key === "filesystem") {
      const fs = section(val);
      if (!fs) continue;
      const out: Record<string, unknown> = {};
      if (Array.isArray(fs.allowedDirs)) {
        out.allowedDirs = (fs.allowedDirs as unknown[])
          .filter((d): d is string => typeof d === "string" && d.trim().length > 0)
          .map((d) => sanitizeString(d.trim(), 1024))
          .slice(0, MAX_DIRS);
      }
      cleaned.filesystem = out;
    } else if (key === "context") {
      const ctx = section(val);
      if (!ctx) continue;
      const out: Record<string, unknown> = {};
      pick(out, ctx, "limitEnabled", (v) => !!v);
      pick(out, ctx, "maxTokens", clampNum(1000, 2_000_000, 100_000));
      cleaned.context = out;
    } else if (key === "ui") {
      const ui = section(val);
      if (!ui) continue;
      const out: Record<string, unknown> = {};
      pick(out, ui, "theme", oneOf(["system", "light", "dark"] as const, "system"));
      cleaned.ui = out;
    } else if (key === "backupDir") {
      cleaned.backupDir = sanitizeString(val, 1024);
    } else if (key === "onboardingDone") {
      cleaned.onboardingDone = !!val;
    } else if (key === "database") {
      const db = section(val);
      if (!db) continue;
      const out: Record<string, unknown> = {};
      pick(out, db, "type", (v) => (v === "mysql" ? "mysql" : "postgres"));
      pick(out, db, "host", (v) => sanitizeString(v) || "localhost");
      pick(out, db, "port", clampNum(1, 65535, 5432));
      pick(out, db, "user", (v) => sanitizeString(v));
      pick(out, db, "database", (v) => sanitizeString(v));
      pick(out, db, "ssl", (v) => !!v);
      cleaned.database = out;
    } else if (key === "redis") {
      const r = section(val);
      if (!r) continue;
      const out: Record<string, unknown> = {};
      pick(out, r, "host", (v) => sanitizeString(v) || "localhost");
      pick(out, r, "port", clampNum(1, 65535, 6379));
      pick(out, r, "username", (v) => sanitizeString(v));
      pick(out, r, "db", clampNum(0, 15, 0));
      pick(out, r, "tls", (v) => !!v);
      cleaned.redis = out;
    }
  }
  return cleaned as ConfigPatch;
}

export async function PUT(req: NextRequest) {
  let raw: unknown;
  try {
    raw = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid JSON" }, { status: 400 });
  }

  const patch = sanitizePatch(raw);
  if (!patch) {
    return NextResponse.json({ error: "invalid config payload" }, { status: 400 });
  }

  const cfg = updateConfig(patch);
  logger.info(`Config updated: keys=${Object.keys(patch).join(",")}`);
  return NextResponse.json({ config: cfg });
}
