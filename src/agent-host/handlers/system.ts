import type { ApiHandlerSet } from "../../contract/rpc";
import type { HandlerContext } from "./types";
import { mkdirSync, statSync } from "fs";
import { homedir } from "os";
import path from "path";
import { RpcError } from "../../contract/types";
import { allowFileRoot, invalidateAllowedRootsCache } from "../file-access";
import { getRunningRpcSessionIds } from "../rpc-manager";
import { toolchainRuntime } from "../toolchain-runtime";

/**
 * system handlers.
 */
export function systemHandlers(_ctx: HandlerContext) {
  return {
    "host.ping": () => ({ ok: true as const, ts: Date.now() }),

    "host.toolchain": async (params) => {
      const { cwd } = params as { cwd: string };
      if (!cwd || !path.isAbsolute(cwd)) throw new RpcError({ code: "BAD_REQUEST", message: "absolute cwd required" });
      const context = await toolchainRuntime.createExecutionContext({ cwd, intent: "project-command" });
      return {
        inventoryRevision: context.inventoryRevision,
        resolutionId: context.resolutionId,
        capabilities: Object.fromEntries(
          Object.entries(context.commands).map(([capability, command]) => [
            capability,
            { provider: command.provider, version: command.version },
          ]),
        ),
      };
    },

    "system.home": () => ({ home: homedir() }),

    "system.validateCwd": async (params) => {
      const { path: dir } = params as { path: string };
      try {
        const st = statSync(dir);
        if (!st.isDirectory()) return { ok: false, error: "Not a directory" };
        allowFileRoot(dir);
        invalidateAllowedRootsCache();
        return { ok: true, path: dir };
      } catch {
        return { ok: false, error: "Directory does not exist" };
      }
    },

    "system.defaultCwd": async () => {
      const date = new Date().toISOString().slice(0, 10).replace(/-/g, "");
      const dir = path.join(homedir(), `pi-cwd-${date}`);
      mkdirSync(dir, { recursive: true });
      allowFileRoot(dir);
      invalidateAllowedRootsCache();
      return { cwd: dir };
    },

    "system.allowRoot": async (params) => {
      const { path: dir } = params as { path: string };
      allowFileRoot(dir);
      invalidateAllowedRootsCache();
      return { ok: true as const };
    },

    "system.runningCount": async () => {
      const sessionIds = getRunningRpcSessionIds();
      return { count: sessionIds.length, sessionIds };
    },
  } satisfies Partial<ApiHandlerSet>;
}
