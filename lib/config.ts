/**
 * Config service — the ONLY gateway for reading/writing app configuration
 * (PLAN B.1). No other code may read process.env for app config.
 *
 * - Non-secrets → config.json in the data dir.
 * - Secrets     → secrets.json, each value encrypted via Electron
 *   safeStorage (Keychain/DPAPI/libsecret). Dev/no-libsecret fallback:
 *   base64 + an "encrypted storage unavailable" warning.
 */
import fs from "fs";
import path from "path";
import { EventEmitter } from "events";
import { getDataDir, getBridge } from "./paths";

export type DatabaseType = "postgres" | "mysql";

export type AiProviderSetting = "auto" | "anthropic" | "openai" | "gemini";

export type AppConfig = {
  ai: {
    baseUrl: string;
    model: string;
    provider: AiProviderSetting;
    /** Model used by the built-in read_image tool ("" = the active default model). */
    visionModel: string;
  };
  gitlab: { apiUrl: string };
  database: {
    type: DatabaseType;
    host: string;
    port: number;
    user: string;
    database: string;
    ssl: boolean;
  };
  redis: { host: string; port: number; username: string; db: number; tls: boolean };
  filesystem: { allowedDirs: string[] };
  /** Optional cap on how much conversation context is sent to the model. */
  context: { limitEnabled: boolean; maxTokens: number };
  backupDir: string;
  ui: { theme: "system" | "light" | "dark" };
  onboardingDone: boolean;
};

export type SecretName =
  | "aiApiKey" | "githubToken" | "gitlabToken" | "dbPassword" | "redisPassword" | "tavilyApiKey"
  /** postgres:// URL of the shared catalog database (agents, skills, knowledge). */
  | "sharedDbUrl";

const DEFAULTS: AppConfig = {
  ai: { baseUrl: "https://api.anthropic.com", model: "claude-sonnet-5", provider: "auto", visionModel: "" },
  gitlab: { apiUrl: "https://gitlab.com/api/v4" },
  database: { type: "postgres", host: "localhost", port: 5432, user: "postgres", database: "postgres", ssl: false },
  redis: { host: "localhost", port: 6379, username: "", db: 0, tls: false },
  filesystem: { allowedDirs: [] },
  context: { limitEnabled: false, maxTokens: 100000 },
  backupDir: "",
  ui: { theme: "system" },
  onboardingDone: false,
};

export const configEvents = new EventEmitter();

function configFile() { return path.join(getDataDir(), "config.json"); }
function secretsFile() { return path.join(getDataDir(), "secrets.json"); }

/* ---------------- non-secret config ---------------- */

export function getConfig(): AppConfig {
  try {
    const raw = JSON.parse(fs.readFileSync(configFile(), "utf8"));
    return {
      ...DEFAULTS,
      ...raw,
      ai: { ...DEFAULTS.ai, ...raw.ai },
      gitlab: { ...DEFAULTS.gitlab, ...raw.gitlab },
      database: { ...DEFAULTS.database, ...raw.database },
      redis: { ...DEFAULTS.redis, ...raw.redis },
      filesystem: { ...DEFAULTS.filesystem, ...raw.filesystem },
      context: { ...DEFAULTS.context, ...raw.context },
      ui: { ...DEFAULTS.ui, ...raw.ui },
    };
  } catch {
    return { ...DEFAULTS };
  }
}

/**
 * A patch may set only SOME fields of a section — every section below is
 * merged onto the current value, so `{ ai: { model } }` keeps baseUrl,
 * provider and visionModel untouched. Callers must never be forced to send a
 * whole section just to change one field.
 */
export type ConfigPatch = {
  [K in keyof AppConfig]?: AppConfig[K] extends object
    ? AppConfig[K] extends unknown[]
      ? AppConfig[K]
      : Partial<AppConfig[K]>
    : AppConfig[K];
};

export function updateConfig(patch: ConfigPatch): AppConfig {
  const current = getConfig();
  const merged: AppConfig = {
    ...current,
    ...patch,
    ai: { ...current.ai, ...(patch.ai ?? {}) },
    gitlab: { ...current.gitlab, ...(patch.gitlab ?? {}) },
    database: { ...current.database, ...(patch.database ?? {}) },
    redis: { ...current.redis, ...(patch.redis ?? {}) },
    filesystem: { ...current.filesystem, ...(patch.filesystem ?? {}) },
    context: { ...current.context, ...(patch.context ?? {}) },
    ui: { ...current.ui, ...(patch.ui ?? {}) },
  };
  fs.writeFileSync(configFile(), JSON.stringify(merged, null, 2));
  configEvents.emit("config-changed", merged);
  return merged;
}

/* ---------------- secrets ---------------- */

type SecretsFile = Record<string, { enc: string; scheme: "safeStorage" | "plainB64" }>;

function readSecretsFile(): SecretsFile {
  try { return JSON.parse(fs.readFileSync(secretsFile(), "utf8")); }
  catch { return {}; }
}
function writeSecretsFile(s: SecretsFile) {
  fs.writeFileSync(secretsFile(), JSON.stringify(s, null, 2), { mode: 0o600 });
}

function safeStorageAvailable(): boolean {
  const b = getBridge();
  return !!(b?.encryptString && b?.isEncryptionAvailable?.());
}

/** Storage-location label for the UI (requirement PRD 6.6 / DESIGN 2.1). */
export function secretBackendLabel(): { label: string; secure: boolean } {
  const b = getBridge();
  if (safeStorageAvailable()) {
    const custom = b?.secretBackendLabel?.();
    if (custom) return { label: custom, secure: true };
    const p = b?.platform;
    if (p === "darwin") return { label: "macOS Keychain", secure: true };
    if (p === "win32") return { label: "Windows Credential Manager", secure: true };
    return { label: "libsecret", secure: true };
  }
  return { label: "local file (OS encryption unavailable)", secure: false };
}

export function setSecret(name: SecretName, value: string) {
  const all = readSecretsFile();
  if (safeStorageAvailable()) {
    const b = getBridge()!;
    all[name] = { enc: b.encryptString!(value).toString("base64"), scheme: "safeStorage" };
  } else {
    all[name] = { enc: Buffer.from(value, "utf8").toString("base64"), scheme: "plainB64" };
  }
  writeSecretsFile(all);
  configEvents.emit("secret-changed", name);
}

export function getSecret(name: SecretName): string | null {
  const rec = readSecretsFile()[name];
  if (!rec) return null;
  try {
    if (rec.scheme === "safeStorage") {
      const b = getBridge();
      if (!b?.decryptString) return null;
      return b.decryptString(Buffer.from(rec.enc, "base64"));
    }
    return Buffer.from(rec.enc, "base64").toString("utf8");
  } catch {
    return null;
  }
}

export function deleteSecret(name: SecretName) {
  const all = readSecretsFile();
  delete all[name];
  writeSecretsFile(all);
  configEvents.emit("secret-changed", name);
}

export function hasSecret(name: SecretName): boolean {
  return !!readSecretsFile()[name];
}

/** Last 4 characters for masked display — never send the full value to the UI except on reveal. */
export function secretTail(name: SecretName): string | null {
  const v = getSecret(name);
  return v ? v.slice(-4) : null;
}

/* ---------------- per-connection secrets ----------------
 * Multiple saved connections each store their own token/password under the
 * key `conn:<id>`, encrypted the same way as the named secrets above. The
 * active connection also mirrors its secret into the legacy named slot
 * (githubToken/gitlabToken/dbPassword/redisPassword) so the existing tools
 * keep reading a single value with no changes. */
function connKey(id: number): string {
  return `conn:${id}`;
}

export function setConnectionSecret(id: number, value: string) {
  const all = readSecretsFile();
  if (safeStorageAvailable()) {
    const b = getBridge()!;
    all[connKey(id)] = { enc: b.encryptString!(value).toString("base64"), scheme: "safeStorage" };
  } else {
    all[connKey(id)] = { enc: Buffer.from(value, "utf8").toString("base64"), scheme: "plainB64" };
  }
  writeSecretsFile(all);
}

export function getConnectionSecret(id: number): string | null {
  const rec = readSecretsFile()[connKey(id)];
  if (!rec) return null;
  try {
    if (rec.scheme === "safeStorage") {
      const b = getBridge();
      if (!b?.decryptString) return null;
      return b.decryptString(Buffer.from(rec.enc, "base64"));
    }
    return Buffer.from(rec.enc, "base64").toString("utf8");
  } catch {
    return null;
  }
}

export function deleteConnectionSecret(id: number) {
  const all = readSecretsFile();
  delete all[connKey(id)];
  writeSecretsFile(all);
}

export function hasConnectionSecret(id: number): boolean {
  return !!readSecretsFile()[connKey(id)];
}
