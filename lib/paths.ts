import path from "path";
import fs from "fs";

/**
 * Bridge set by the Electron main process before the Next server starts.
 * In dev mode (without Electron) the bridge is absent — use local fallbacks.
 */
export type ElectronBridge = {
  userDataPath: string;
  platform: NodeJS.Platform;
  encryptString?: (plain: string) => Buffer;
  decryptString?: (encrypted: Buffer) => string;
  isEncryptionAvailable?: () => boolean;
  secretBackendLabel?: () => string;
  pickFolder?: () => Promise<string | null>;
  nodePath?: string; // Electron's process.execPath for spawning MCP (ELECTRON_RUN_AS_NODE)
};

export function getBridge(): ElectronBridge | null {
  return (globalThis as any).__electronBridge ?? null;
}

/** Data dir: Electron userData, or ./data in dev without Electron. */
export function getDataDir(): string {
  const bridge = getBridge();
  const dir = bridge
    ? path.join(bridge.userDataPath, "data")
    : path.join(process.cwd(), "data");
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  return dir;
}
