import type { ApiHandlerSet } from "../../contract/rpc";
import type { HandlerContext } from "./types";
import { RpcError } from "../../contract/types";
import { type ContextFoldCommand } from "../../shared/api-types";
import { applyFoldCommand, emptyFoldSnapshot, peekFoldSession } from "../context-fold";

/**
 * context handlers.
 */
export function contextHandlers(_ctx: HandlerContext) {
  return {
    "context.map": async (params) => {
      const { sessionId } = params as { sessionId: string };
      if (!sessionId) throw new RpcError({ code: "INVALID_ARGUMENT", message: "sessionId is required" });
      return peekFoldSession(sessionId) ?? emptyFoldSnapshot(sessionId);
    },

    "context.fold": async (params) => {
      const { sessionId, command } = params as { sessionId: string; command: ContextFoldCommand };
      if (!sessionId) throw new RpcError({ code: "INVALID_ARGUMENT", message: "sessionId is required" });
      return applyFoldCommand(sessionId, command);
    },
  } satisfies Partial<ApiHandlerSet>;
}
