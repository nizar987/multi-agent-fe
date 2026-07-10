/**
 * Minimal git helpers for the per-agent working directory.
 *
 * Read the current branch / list local branches / switch branch inside a given
 * folder. Used by the chat page's branch widget so the user can see which
 * branch an agent is working on and switch between them.
 *
 * Commands run with execFile (arguments passed as an array, never shell-
 * interpolated) and a short timeout. Branch switching additionally validates
 * the requested name against the repo's actual local branches, so nothing the
 * caller sends can turn into an arbitrary git flag or argument.
 */
import { execFile } from "child_process";
import { promisify } from "util";

const run = promisify(execFile);

export interface GitInfo {
  isRepo: boolean;
  /** Current branch, or null when detached / not a repo. */
  branch: string | null;
  /** Local branch names (sorted by most recent commit). */
  branches: string[];
  /** True when there are uncommitted changes in the working tree. */
  dirty: boolean;
}

const GIT_OPTS = (cwd: string) => ({ cwd, timeout: 10_000, maxBuffer: 1024 * 1024 });

async function git(cwd: string, args: string[]): Promise<string> {
  const { stdout } = await run("git", args, GIT_OPTS(cwd));
  return stdout.trim();
}

/** Inspect the git state of `dir`. Never throws — returns isRepo:false on any error. */
export async function getGitInfo(dir: string): Promise<GitInfo> {
  try {
    const inside = await git(dir, ["rev-parse", "--is-inside-work-tree"]);
    if (inside !== "true") return { isRepo: false, branch: null, branches: [], dirty: false };

    const [branchRaw, branchList, status] = await Promise.all([
      git(dir, ["rev-parse", "--abbrev-ref", "HEAD"]).catch(() => "HEAD"),
      // Sorted by committer date so the branches you actually use float to the top.
      git(dir, ["for-each-ref", "--sort=-committerdate", "--format=%(refname:short)", "refs/heads"]).catch(() => ""),
      git(dir, ["status", "--porcelain"]).catch(() => ""),
    ]);

    const branch = branchRaw === "HEAD" ? null : branchRaw; // "HEAD" == detached
    const branches = branchList.split("\n").map((b) => b.trim()).filter(Boolean);
    return { isRepo: true, branch, branches, dirty: status.length > 0 };
  } catch {
    return { isRepo: false, branch: null, branches: [], dirty: false };
  }
}

export interface CheckoutResult {
  ok: boolean;
  info?: GitInfo;
  error?: string;
}

/**
 * Switch `dir` to an existing local branch. The name must be one of the repo's
 * current local branches (validated against `getGitInfo`), so this can't be
 * used to run arbitrary git — only to move between branches that already exist.
 */
export async function checkoutBranch(dir: string, branch: string): Promise<CheckoutResult> {
  const info = await getGitInfo(dir);
  if (!info.isRepo) return { ok: false, error: "This folder is not a git repository." };
  if (!info.branches.includes(branch)) {
    return { ok: false, error: `Unknown branch '${branch}'.` };
  }
  if (branch === info.branch) return { ok: true, info };

  try {
    await git(dir, ["checkout", branch]);
    return { ok: true, info: await getGitInfo(dir) };
  } catch (e: unknown) {
    // Surface git's own message — usually "local changes would be overwritten".
    const stderr = (e as { stderr?: string })?.stderr;
    const msg = stderr?.trim() || (e instanceof Error ? e.message : String(e));
    return { ok: false, error: msg.slice(0, 400), info };
  }
}
