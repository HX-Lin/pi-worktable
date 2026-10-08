import type { ApiHandlerSet } from "../../contract/rpc";
import type { HandlerContext } from "./types";
import { RpcError } from "../../contract/types";
import { applyPluginAction, readPlugins } from "../plugins-service";

/**
 * plugins handlers.
 */
export function pluginHandlers(_ctx: HandlerContext) {
  return {
    "plugins.list": async (params) => {
      const cwd = (params as { cwd?: string } | void)?.cwd;
      if (!cwd) throw new RpcError({ code: "BAD_REQUEST", message: "cwd required" });
      return readPlugins(cwd);
    },

    "plugins.set": async (params) => {
      return applyPluginAction(params);
    },
  } satisfies Partial<ApiHandlerSet>;
}
