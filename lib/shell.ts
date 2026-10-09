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

/**
 * Resolve the working directory for a shell command.
 *
 * Priority:
 *  1. Run-level override (Workspace "working folder" — RunOptions.workingDir)
 *  2. Agent's own working_dir (set via the "Open folder" button in AgentForm)
 *  3. First entry in the global filesystem.allowedDirs
 *  4. App data dir as a last-resort fallback
 */
export function shellCwd(agentId?: number, cwdOverride?: string): string {
  // 1. Per-run override (workspace working folder)
  if (cwdOverride && cwdOverride.trim()) return cwdOverride.trim();
  // 2. Per-agent working_dir
  if (agentId != null) {
    const { getDb } = require("./db") as typeof import("./db");
    const row = getDb()
      .prepare("SELECT working_dir FROM agents WHERE id=?")
      .get(agentId) as { working_dir: string | null } | undefined;
    if (row?.working_dir) return row.working_dir;
  }
  // 3. Global allowedDirs fallback
  const dirs = getConfig().filesystem.allowedDirs;
  return dirs.length > 0 ? dirs[0] : getDataDir();
}

export function runShell(command: string, agentId?: number, cwdOverride?: string): Promise<string> {
  const cwd = shellCwd(agentId, cwdOverride);
  return new Promise((resolve) => {
    exec(
      command,
      { cwd, timeout: 300_000, maxBuffer: 1024 * 1024, shell: "/bin/bash" },
      (err, stdout, stderr) => {
        let out = "";
        if (stdout) out += stdout;
        if (stderr) out += (out ? "\n" : "") + "[stderr]\n" + stderr;
        if (err) {
          if ((err as any).killed) out += `\n[killed: 5 min timeout]`;
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

/** The user's decision on an approval card:
 *  - "always" : run it AND add to the allowlist (skips future approvals)
 *  - "once"   : run it this time only
 *  - "deny"   : don't run it
 */
export type ApprovalDecision = "always" | "once" | "deny";

/** What the approval is about — shown in the notification / pending list. */
export interface ApprovalMeta {
  kind: string;   // shell | database | redis | env
  detail: string; // the command / SQL / detail string
}

export interface PendingApproval extends ApprovalMeta {
  id: string;
  createdAt: number; // epoch ms
  expiresAt: number; // epoch ms — the request auto-denies after this
}

type Pending = {
  resolve: (decision: ApprovalDecision) => void;
  timer: ReturnType<typeof setTimeout>;
  meta: PendingApproval;
};
const pending: Map<string, Pending> =
  (globalThis as any).__shellApprovals ?? new Map();
(globalThis as any).__shellApprovals = pending;

/** Called by the runtime: waits for the user's decision for this tool_use_id. */
export function awaitApproval(id: string, meta?: ApprovalMeta, timeoutMs = 180_000): Promise<ApprovalDecision> {
  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      pending.delete(id);
      resolve("deny");
    }, timeoutMs);
    const now = Date.now();
    pending.set(id, {
      resolve,
      timer,
      meta: {
        id,
        kind: meta?.kind ?? "action",
        detail: meta?.detail ?? "",
        createdAt: now,
        expiresAt: now + timeoutMs,
      },
    });
  });
}

/** All approval requests currently waiting for the user (oldest first). */
export function listPendingApprovals(): PendingApproval[] {
  return [...pending.values()].map((p) => p.meta).sort((a, b) => a.createdAt - b.createdAt);
}

/** Called by the approve endpoint: resolves the user's decision. */
export function resolveApproval(id: string, decision: ApprovalDecision): boolean {
  const p = pending.get(id);
  if (!p) return false;
  clearTimeout(p.timer);
  pending.delete(id);
  p.resolve(decision);
  return true;
}
