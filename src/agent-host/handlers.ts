/**
 * Register all Api handlers on the RPC server.
 * Implements the desktop RPC contract in the Agent Host process.
 */
import type { ApiMethod } from "../contract/api";
import type { ApiHandlerSet, RpcServer } from "../contract/rpc";
import { createAuthLoginService } from "./auth-login";
import { ChannelManager } from "./channels/channel-manager";
import { createFileWatchService } from "./file-watch";
import { modelCatalogRefreshCoordinator } from "./model-runtime";
import { writeInterruptedSnapshot } from "./resume-interrupted";
import { subscribeRunningSessions } from "./rpc-manager";
import { agentHandlers } from "./handlers/agent";
import { agentHandlers as agentDefinitionHandlers } from "./handlers/agents";
import { channelHandlers } from "./handlers/channels";
import { contextHandlers } from "./handlers/context";
import { fileHandlers } from "./handlers/files";
import { gitHandlers } from "./handlers/git";
import { jevMcpHandlers } from "./handlers/jevMcp";
import { memoryHandlers } from "./handlers/memory";
import { modelHandlers } from "./handlers/models";
import { pluginHandlers } from "./handlers/plugins";
import { ensureSessionEvents } from "./handlers/session-events";
import { sessionHandlers } from "./handlers/sessions";
import { searchHandlers } from "./handlers/search";
import { subagentHandlers } from "./handlers/subagents";
import { taskHandlers } from "./handlers/tasks";
import { voiceHandlers } from "./handlers/voice";
import { systemHandlers } from "./handlers/system";
import type { HandlerContext } from "./handlers/types";

/**
 * Every module returns a partial map, so the runtime merge below needs the
 * compiler to prove the union still covers the whole contract. `MissingMethods`
 * resolves to `never` only when it does; otherwise `_contractIsComplete` fails
 * to compile and names the missing methods.
 */
type ProvidedMethods =
  | keyof ReturnType<typeof systemHandlers>
  | keyof ReturnType<typeof sessionHandlers>
  | keyof ReturnType<typeof fileHandlers>
  | keyof ReturnType<typeof jevMcpHandlers>
  | keyof ReturnType<typeof contextHandlers>
  | keyof ReturnType<typeof gitHandlers>
  | keyof ReturnType<typeof agentHandlers>
  | keyof ReturnType<typeof agentDefinitionHandlers>
  | keyof ReturnType<typeof channelHandlers>
  | keyof ReturnType<typeof modelHandlers>
  | keyof ReturnType<typeof pluginHandlers>
  | keyof ReturnType<typeof taskHandlers>
  | keyof ReturnType<typeof subagentHandlers>
  | keyof ReturnType<typeof searchHandlers>
  | keyof ReturnType<typeof memoryHandlers>
  | keyof ReturnType<typeof voiceHandlers>;

type MissingMethods = Exclude<ApiMethod, ProvidedMethods>;
type AssertNever<T extends never> = T;
export type ContractIsComplete = AssertNever<MissingMethods>;

function composeHandlers(...modules: Array<Partial<ApiHandlerSet>>): ApiHandlerSet {
  return Object.assign({}, ...modules) as ApiHandlerSet;
}

export function registerHandlers(server: RpcServer): () => Promise<void> {
  const fileWatch = createFileWatchService(server);
  const authLogin = createAuthLoginService(server);
  const channelManager = new ChannelManager(server, (session, sessionId) =>
    ensureSessionEvents(server, session, sessionId),
  );
  void channelManager.initialize();

  // Running sessions stream + tray badge signal to main via parentPort
  subscribeRunningSessions((ids) => {
    // Both fields remain in the current stream contract for renderer compatibility.
    server.emit("agent.running", "*", {
      type: "running",
      sessionIds: ids,
      runningSessionIds: ids,
    } as never);
    try {
      process.parentPort?.postMessage({ type: "running-sessions", sessionIds: ids });
    } catch {
      /* ignore */
    }
    // Remember what was mid-turn, so a restart can continue it instead of dropping the work.
    writeInterruptedSnapshot(process.env.PI_DESKTOP_USER_DATA, ids);
  });

  const ctx: HandlerContext = { server, fileWatch, authLogin, channelManager };

  server.handle(
    composeHandlers(
      systemHandlers(ctx),
      sessionHandlers(ctx),
      fileHandlers(ctx),
      jevMcpHandlers(ctx),
      contextHandlers(ctx),
      gitHandlers(ctx),
      agentHandlers(ctx),
      agentDefinitionHandlers(ctx),
      channelHandlers(ctx),
      modelHandlers(ctx),
      pluginHandlers(ctx),
      taskHandlers(ctx),
      subagentHandlers(),
      searchHandlers(),
      memoryHandlers(ctx),
      voiceHandlers(ctx),
    ),
  );

  return async () => {
    modelCatalogRefreshCoordinator.cancelAll();
    await channelManager.shutdown();
  };
}

// ---------------------------------------------------------------------------
// Prompt templates (`.pi/prompts/` project + `~/.pi/agent/prompts/` global)
// ---------------------------------------------------------------------------
