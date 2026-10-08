import type { ApiHandlerSet } from "../../contract/rpc";
import type { HandlerContext } from "./types";
import { existsSync } from "fs";
import { RpcError } from "../../contract/types";
import { allowFileRoot, getAllowedFileRoots, isFilePathAllowed } from "../file-access";
import {
  addWorktree,
  getGitStatus,
  isDirtyWorktreeError,
  listWorktrees,
  removeWorktree,
  resolveProject,
} from "../../shared/worktree";
import { assertPathAllowed } from "./helpers";
import {
  checkoutBranch,
  commitChanges,
  getCommitPatch,
  getDiff,
  listCommits,
  listBranches,
  pullBranch,
  pushBranch,
  stagePaths,
  unstagePaths,
} from "../../shared/git-repository";

/** Surface git's own message (it is the useful part) as a structured RPC error. */
async function withGitErrors<T>(operation: () => Promise<T>): Promise<T> {
  try {
    return await operation();
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new RpcError({ code: "CONFLICT", message: message.replace(/\n+$/, "") });
  }
}

/**
 * git handlers.
 */
export function gitHandlers(_ctx: HandlerContext) {
  return {
    "worktrees.list": async (params) => {
      const { projectRoot } = params as { projectRoot: string };
      const allowed = await getAllowedFileRoots();
      if (!isFilePathAllowed(projectRoot, allowed)) {
        throw new RpcError({ code: "FORBIDDEN", message: "Access denied" });
      }
      const project = await resolveProject(projectRoot);
      let worktrees: Awaited<ReturnType<typeof listWorktrees>> = [];
      let isGit = true;
      try {
        worktrees = await listWorktrees(existsSync(projectRoot) ? projectRoot : project.projectRoot);
      } catch {
        isGit = false;
      }
      for (const w of worktrees) allowFileRoot(w.path);
      return {
        worktrees,
        projectRoot: project.projectRoot,
        isGit,
        isTopLevel: project.isTopLevel,
      };
    },

    "worktrees.create": async (params) => {
      const body = params as { projectRoot: string; branch: string; cwd?: string };
      const cwd = body.cwd ?? body.projectRoot;
      const allowed = await getAllowedFileRoots();
      if (!isFilePathAllowed(cwd, allowed)) {
        throw new RpcError({ code: "FORBIDDEN", message: "Access denied" });
      }
      const result = await addWorktree(cwd, body.branch);
      allowFileRoot(result.path);
      return { worktree: result };
    },

    "worktrees.remove": async (params) => {
      const body = params as { path: string; cwd?: string; force?: boolean };
      const cwd = body.cwd ?? body.path;
      const allowed = await getAllowedFileRoots();
      if (!isFilePathAllowed(cwd, allowed)) {
        throw new RpcError({ code: "FORBIDDEN", message: "Access denied" });
      }
      try {
        await removeWorktree(cwd, body.path, body.force === true);
      } catch (error) {
        if (!body.force && isDirtyWorktreeError(error)) {
          throw new RpcError({
            code: "CONFLICT",
            message: error instanceof Error ? error.message : String(error),
            detail: { dirty: true },
          });
        }
        throw error;
      }
      return { ok: true as const };
    },

    "git.diff": async (params) => {
      const { path: cwd, staged } = params as { path: string; staged?: boolean };
      await assertPathAllowed(cwd);
      return getDiff(cwd, staged === true);
    },

    "git.stage": async (params) => {
      const { path: cwd, files } = params as { path: string; files: string[] };
      await assertPathAllowed(cwd);
      await withGitErrors(() => stagePaths(cwd, files ?? []));
      return { ok: true as const };
    },

    "git.unstage": async (params) => {
      const { path: cwd, files } = params as { path: string; files: string[] };
      await assertPathAllowed(cwd);
      await withGitErrors(() => unstagePaths(cwd, files ?? []));
      return { ok: true as const };
    },

    "git.commit": async (params) => {
      const { path: cwd, message } = params as { path: string; message: string };
      await assertPathAllowed(cwd);
      return withGitErrors(() => commitChanges(cwd, message));
    },

    "git.push": async (params) => {
      const { path: cwd } = params as { path: string };
      await assertPathAllowed(cwd);
      return withGitErrors(() => pushBranch(cwd));
    },

    "git.pull": async (params) => {
      const { path: cwd } = params as { path: string };
      await assertPathAllowed(cwd);
      return withGitErrors(() => pullBranch(cwd));
    },

    "git.log": async (params) => {
      const { path: cwd, limit } = params as { path: string; limit?: number };
      await assertPathAllowed(cwd);
      return { commits: await withGitErrors(() => listCommits(cwd, limit ?? 40)) };
    },

    "git.commitPatch": async (params) => {
      const { path: cwd, commit } = params as { path: string; commit: string };
      await assertPathAllowed(cwd);
      const result = await withGitErrors(() => getCommitPatch(cwd, commit));
      return { patch: result.patch, truncated: result.truncated };
    },

    "git.branches": async (params) => {
      const { path: cwd } = params as { path: string };
      await assertPathAllowed(cwd);
      return withGitErrors(() => listBranches(cwd));
    },

    "git.checkout": async (params) => {
      const { path: cwd, branch } = params as { path: string; branch: string };
      await assertPathAllowed(cwd);
      return withGitErrors(() => checkoutBranch(cwd, branch));
    },

    "git.status": async (params) => {
      const { path: cwd } = params as { path: string };
      await assertPathAllowed(cwd);
      return getGitStatus(cwd);
    },
  } satisfies Partial<ApiHandlerSet>;
}
