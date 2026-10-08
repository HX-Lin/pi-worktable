import type { ApiHandlerSet } from "../../contract/rpc";
import { listSubagentRuns } from "../subagent/registry";

/**
 * What the subagent tool is running right now. The runs live inside tool calls,
 * so the panel polls this instead of watching the conversation.
 */
export function subagentHandlers() {
  return {
    "subagents.list": () => ({ runs: listSubagentRuns() }),
  } satisfies Partial<ApiHandlerSet>;
}
