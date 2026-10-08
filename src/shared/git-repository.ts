/**
 * Repository operations for the desktop's git panel.
 *
 * Every command is argv-based through `runGit` — no shell — and the callers in
 * the host validate the cwd against the allowed roots first. Branch names are
 * validated here so a name can never be read as an option.
 */
import { runGit } from "./worktree.ts";

const DIFF_MAX_CHARS = 400_000;
/** Letters, digits, and the separators git itself allows; never a leading dash. */
const SAFE_REF = /^(?!-)[A-Za-z0-9._/-]{1,200}$/;

export interface GitDiffResult {
  patch: string;
  /** True when the patch was cut to fit the response. */
  truncated: boolean;
  /** Files with changes, from `--name-only`. */
  files: string[];
}

export interface GitBranchList {
  current: string | null;
  branches: string[];
  /** The tracking branch, when one is configured. */
  upstream: string | null;
  /** Commits the upstream does not have / commits this branch does not have. */
  ahead: number;
  behind: number;
}

/** Reject anything that could be read as an option or escapes the ref namespace. */
export function assertSafeRef(ref: string, what: string): string {
  const trimmed = ref.trim();
  if (!SAFE_REF.test(trimmed) || trimmed.includes("..") || trimmed.endsWith(".lock") || trimmed.endsWith("/")) {
    throw new Error(`Invalid ${what}: ${ref}`);
  }
  return trimmed;
}

export async function getDiff(cwd: string, staged: boolean): Promise<GitDiffResult> {
  const args = ["diff", "--no-color", "--no-ext-diff", ...(staged ? ["--cached"] : []), "--"];
  const [patch, names] = await Promise.all([runGit(cwd, args), runGit(cwd, [...args, "--name-only"])]);
  const files = names
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
  return {
    patch: patch.length > DIFF_MAX_CHARS ? patch.slice(0, DIFF_MAX_CHARS) : patch,
    truncated: patch.length > DIFF_MAX_CHARS,
    files,
  };
}

export async function stagePaths(cwd: string, paths: string[]): Promise<void> {
  if (paths.length === 0) throw new Error("No paths to stage");
  await runGit(cwd, ["add", "--", ...paths]);
}

export async function unstagePaths(cwd: string, paths: string[]): Promise<void> {
  if (paths.length === 0) throw new Error("No paths to unstage");
  await runGit(cwd, ["restore", "--staged", "--", ...paths]);
}

export async function commitChanges(cwd: string, message: string): Promise<{ output: string }> {
  const trimmed = message.trim();
  if (!trimmed) throw new Error("A commit message is required");
  const output = await runGit(cwd, ["commit", "-m", trimmed]);
  return { output: output.trim() };
}

export async function pushBranch(cwd: string): Promise<{ output: string }> {
  const output = await runGit(cwd, ["push"], { timeoutMs: 120_000 });
  return { output: output.trim() };
}

/** Fast-forward only: a diverged branch is reported instead of merged silently. */
export async function pullBranch(cwd: string): Promise<{ output: string }> {
  const output = await runGit(cwd, ["pull", "--ff-only"], { timeoutMs: 120_000 });
  return { output: output.trim() };
}

export async function listBranches(cwd: string): Promise<GitBranchList> {
  const output = await runGit(cwd, ["branch", "--format=%(refname:short)"]);
  const branches = output
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
  const current = (await runGit(cwd, ["rev-parse", "--abbrev-ref", "HEAD"])).trim();

  // A repository with no upstream (or a detached HEAD) is not an error here.
  let upstream: string | null = null;
  let ahead = 0;
  let behind = 0;
  try {
    upstream = (await runGit(cwd, ["rev-parse", "--abbrev-ref", "--symbolic-full-name", "@{u}"])).trim() || null;
    const counts = await runGit(cwd, ["rev-list", "--left-right", "--count", "@{u}...HEAD"]);
    const [behindText, aheadText] = counts.trim().split(/\s+/);
    ahead = Number.parseInt(aheadText ?? "0", 10) || 0;
    behind = Number.parseInt(behindText ?? "0", 10) || 0;
  } catch {
    upstream = null;
  }

  return { current: current && current !== "HEAD" ? current : null, branches, upstream, ahead, behind };
}

export interface GitCommitInfo {
  hash: string;
  shortHash: string;
  subject: string;
  author: string;
  /** ISO date, so the UI can format it. */
  date: string;
}

/** Recent commits on the current branch, newest first. */
export async function listCommits(cwd: string, limit = 40): Promise<GitCommitInfo[]> {
  const count = Math.max(1, Math.min(200, limit));
  const output = await runGit(cwd, ["log", `--max-count=${count}`, "--pretty=format:%H%x1f%h%x1f%s%x1f%an%x1f%aI"]);
  return output
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const [hash, shortHash, subject, author, date] = line.split("\u001f");
      return { hash, shortHash, subject, author, date };
    });
}

/** The patch one commit introduced. */
export async function getCommitPatch(cwd: string, commit: string): Promise<GitDiffResult> {
  const reference = assertSafeRef(commit, "commit");
  const patch = await runGit(cwd, ["show", "--no-color", "--no-ext-diff", "--format=", reference]);
  return {
    patch: patch.length > DIFF_MAX_CHARS ? patch.slice(0, DIFF_MAX_CHARS) : patch,
    truncated: patch.length > DIFF_MAX_CHARS,
    files: [],
  };
}

export async function checkoutBranch(cwd: string, branch: string): Promise<{ output: string }> {
  const ref = assertSafeRef(branch, "branch name");
  const output = await runGit(cwd, ["checkout", ref]);
  return { output: output.trim() };
}
