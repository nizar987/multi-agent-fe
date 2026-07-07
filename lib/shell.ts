/**
 * Shell tool — command execution with safety guards (not covered by the
 * PRD; added by request, with deliberate restrictions):
 *
 * - cwd is LOCKED to the allowed Filesystem folder (or the data dir when
 *   none is configured) — not a full sandbox, but prevents defaulting to root.
 * - 30 s timeout, output truncated at 8 KB.
 * - Every command waits for user approval via the registry below,
 *   resolved by POST /api/shell/approve. Approval timeout is 180 s
 *   → treated as rejected. The same registry powers database (SQL writes),
 *   Redis (write ops), and .env-read approvals — one mechanism for all.
 *   Execution mode (Approval/Act/Plan) is picked in chat.
 */
import { exec } from "child_process";
import { getConfig } from "./config";
import type { AiTool } from "./ai";
import { getDataDir } from "./paths";

export const shellToolDef: AiTool = {
  name: "run_shell",
  description:
    "Run a single shell (bash) command in the allowed working folder. " +
    "Use it to build, test, run scripts, or inspect the system. " +
    "Commands may require user approval before execution.",
  input_schema: {
    type: "object",
    properties: {
      command: { type: "string", description: "the bash command to run" },
    },
    required: ["command"],
  },
};

export function shellCwd(): string {
  const dirs = getConfig().filesystem.allowedDirs;
  return dirs.length > 0 ? dirs[0] : getDataDir();
}

export function runShell(command: string): Promise<string> {
  const cwd = shellCwd();
  return new Promise((resolve) => {
    exec(
      command,
      { cwd, timeout: 30_000, maxBuffer: 1024 * 1024, shell: "/bin/bash" },
      (err, stdout, stderr) => {
        let out = "";
        if (stdout) out += stdout;
        if (stderr) out += (out ? "\n" : "") + "[stderr]\n" + stderr;
        if (err) {
          if ((err as any).killed) out += `\n[killed: 30 s timeout]`;
          else if (typeof (err as any).code === "number") out += `\n[exit code ${(err as any).code}]`;
        }
        out = out.trim() || "(no output)";
        if (out.length > 8000) out = out.slice(0, 8000) + "\n… [output truncated]";
        resolve(`$ ${command}\n(cwd: ${cwd})\n\n${out}`);
      }
    );
  });
}

/* ---------------- approval registry ---------------- */

type Pending = { resolve: (approved: boolean) => void; timer: ReturnType<typeof setTimeout> };
const pending: Map<string, Pending> =
  (globalThis as any).__shellApprovals ?? new Map();
(globalThis as any).__shellApprovals = pending;

/** Called by the runtime: waits for the user's decision for this tool_use_id. */
export function awaitApproval(id: string, timeoutMs = 180_000): Promise<boolean> {
  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      pending.delete(id);
      resolve(false);
    }, timeoutMs);
    pending.set(id, { resolve, timer });
  });
}

/** Called by the approve endpoint: resolves the user's decision. */
export function resolveApproval(id: string, approved: boolean): boolean {
  const p = pending.get(id);
  if (!p) return false;
  clearTimeout(p.timer);
  pending.delete(id);
  p.resolve(approved);
  return true;
}
