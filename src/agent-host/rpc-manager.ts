/**
 * Session lifecycle for the desktop host.
 *
 * The implementation lives in two focused modules:
 * - `session-wrapper.ts` — the AgentSessionWrapper that owns one pi session
 * - `session-registry.ts` — the live-session registry and `startRpcSession`
 *
 * They are re-exported here so callers keep importing `./rpc-manager`.
 */
export { AgentSessionWrapper, type AgentEvent, type ExternalSessionCommand } from "./session-wrapper";
export { countBranchConversationMessages } from "../shared/auto-compact";
export { getRpcSession, getRunningRpcSessionIds, startRpcSession } from "./session-registry";
export { notifyRunningChange, subscribeRunningSessions } from "./running-status";
