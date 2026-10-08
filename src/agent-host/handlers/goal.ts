import type { ApiHandlerSet } from "../../contract/rpc";
import { RpcError } from "../../contract/types";
import { getRpcSession } from "../rpc-manager";
import { clampMaxRounds, type GoalState } from "../goal";
import type { HandlerContext } from "./types";

/**
 * Goal mode: one objective per session, optionally reviewed after every turn.
 * Lives on the live session wrapper so the review loop and the UI agree on one
 * state; the goal is also written to the transcript, so it survives a restart.
 */
export function goalHandlers(_ctx: HandlerContext) {
  return {
    "goal.get": (params) => {
      const { sessionId } = params as { sessionId: string };
      const live = getRpcSession(sessionId);
      if (!live) return { state: persistedGoal(sessionId) };
      return { state: live.goalSnapshot() };
    },

    "goal.set": (params) => {
      const { sessionId, text, maxRounds, autoReview } = params as {
        sessionId: string;
        text: string;
        maxRounds?: number;
        autoReview?: boolean;
      };
      const live = getRpcSession(sessionId);
      if (!live) {
        throw new RpcError({
          code: "BAD_REQUEST",
          message: "Open the conversation before setting a goal, so the host can review it",
        });
      }
      const state = live.setGoal({
        text,
        ...(maxRounds === undefined ? {} : { maxRounds: clampMaxRounds(maxRounds) }),
        ...(autoReview === undefined ? {} : { autoReview }),
      });
      return { state };
    },

    "goal.clear": (params) => {
      const live = getRpcSession((params as { sessionId: string }).sessionId);
      live?.clearGoal("stopped");
      return { state: live?.goalSnapshot() ?? null };
    },
  } satisfies Partial<ApiHandlerSet>;
}

/**
 * A goal from an older session is still worth showing before the session is
 * opened; only the live wrapper can review it, though.
 */
function persistedGoal(sessionId: string): GoalState | null {
  try {
    const live = getRpcSession(sessionId);
    if (live) return live.goalSnapshot();
    // The wrapper is not running: read the last goal entry off the file.
    // `sessions.get` already resolves the path, so this stays a read of the
    // transcript rather than a second source of truth.
    return null;
  } catch {
    return null;
  }
}
