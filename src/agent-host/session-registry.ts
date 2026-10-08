import {
  createAgentSessionFromServices,
  createAgentSessionServices,
  createBashToolDefinition,
  getAgentDir,
  SessionManager,
  type CreateAgentSessionFromServicesOptions,
} from "@earendil-works/pi-coding-agent";
import { cacheSessionPath } from "./session-reader";
import { BUILTIN_SESSION_EXTENSIONS } from "./builtin-providers";
import { createToolchainBashOptions } from "./toolchain-bash";
import { createDesktopSearchToolDefinitions } from "./toolchain-search";
import { createDesktopSystemPromptExtension, type DesktopPromptSettings } from "./system-prompt-extension";
import { toolchainRuntime } from "./toolchain-runtime";
import { withExtensionTools } from "./tool-activation";
import { AgentSessionWrapper } from "./session-wrapper";
import { setRunningIdsProvider } from "./running-status";

/**
 * Live sessions by id, plus the per-id start locks that make concurrent
 * `startRpcSession` calls for the same session collapse into one start.
 */
const sessionRegistry = new Map<string, AgentSessionWrapper>();
const startLocks = new Map<string, Promise<{ session: AgentSessionWrapper; realSessionId: string }>>();
let registryCleanupInstalled = false;

function getRegistry(): Map<string, AgentSessionWrapper> {
  if (!registryCleanupInstalled) {
    registryCleanupInstalled = true;
    const cleanup = () => sessionRegistry.forEach((session) => session.destroy());
    process.once("exit", cleanup);
    process.once("SIGINT", cleanup);
    process.once("SIGTERM", cleanup);
  }
  return sessionRegistry;
}

export function getRpcSession(sessionId: string): AgentSessionWrapper | undefined {
  return getRegistry().get(sessionId);
}

export function getRunningRpcSessionIds(): string[] {
  const ids = new Set<string>();
  for (const [sessionId, session] of getRegistry()) {
    if (session.isRunning()) ids.add(session.sessionId || sessionId);
  }
  return [...ids];
}
/**
 * Get or create an AgentSession for the given session.
 * For new sessions (sessionFile === ""), pi generates its own id.
 * Pass toolNames to pre-configure active tools (empty array = all tools disabled).
 */
export async function startRpcSession(
  sessionId: string,
  sessionFile: string,
  cwd: string,
  toolNames?: string[],
): Promise<{ session: AgentSessionWrapper; realSessionId: string }> {
  const registry = getRegistry();
  const locks = startLocks;

  const existing = registry.get(sessionId);
  if (existing?.isAlive()) return { session: existing, realSessionId: sessionId };

  const inflight = locks.get(sessionId);
  if (inflight) return inflight;

  const starting = (async () => {
    const agentDir = getAgentDir();

    const sessionManager = sessionFile
      ? SessionManager.open(sessionFile, undefined)
      : SessionManager.create(cwd, undefined);

    // Determine which tools to pass based on requested toolNames.
    // Since v0.68.0, session creation expects string[] tool names instead of Tool[] instances.
    let toolsOption: string[] | undefined;
    if (toolNames !== undefined) {
      // toolNames === [] -> "all off" (an empty allow-list disables every tool).
      // Otherwise DO NOT pass a builtin-only allow-list: passing CODING_TOOL_NAMES
      // set allowedToolNames to coding builtins only, which filtered every
      // extension/package-provided tool (e.g. subagents, web access) out of the
      // tool registry — so they were unavailable in desktop sessions even though the
      // `pi` CLI keeps them. Leaving the allow-list unset lets the SDK register all
      // tools (and activate extension tools); we narrow the ACTIVE set below.
      toolsOption = toolNames.length === 0 ? [] : undefined;
    }

    // Build services first so extension-registered providers are available
    // before the SDK restores the saved model from the session file.
    const promptSettings: DesktopPromptSettings = { forceEmpty: false, toolchainPrompt: "" };
    const services = await createAgentSessionServices({
      cwd,
      agentDir,
      resourceLoaderOptions: {
        extensionFactories: [...BUILTIN_SESSION_EXTENSIONS, createDesktopSystemPromptExtension(promptSettings)],
      },
    });
    const executionContext = await toolchainRuntime.createExecutionContext({
      cwd,
      intent: "agent-shell",
      trusted: services.settingsManager.isProjectTrusted(),
    });
    const bashOptions = createToolchainBashOptions(
      executionContext,
      toolchainRuntime,
      services.settingsManager.getShellCommandPrefix(),
    );
    const customTools = [
      createBashToolDefinition(cwd, bashOptions),
      ...createDesktopSearchToolDefinitions(cwd, executionContext, toolchainRuntime),
    ] as unknown as NonNullable<CreateAgentSessionFromServicesOptions["customTools"]>;
    const { session: inner } = await createAgentSessionFromServices({
      services,
      sessionManager,
      ...(toolsOption !== undefined ? { tools: toolsOption } : {}),
      customTools,
    });

    // If specific tool names were requested (non-empty), set the active tools to the
    // requested builtin coding tools PLUS all extension/package tools, so installed
    // extensions stay usable in Pi Desktop just like in the `pi` CLI.
    if (toolNames && toolNames.length > 0) {
      inner.setActiveToolsByName(withExtensionTools(inner, toolNames));
    }

    const wrapper = new AgentSessionWrapper(inner, promptSettings);
    wrapper.setRuntimeDiagnostics(services.diagnostics);
    wrapper.setToolchainSummary(executionContext.inventoryRevision, executionContext.summary);
    // When all tools are disabled, clear the system prompt entirely.
    // pi's buildSystemPrompt always produces a non-empty prompt even with no tools;
    // keep this forced after extension resource discovery and reloads as well.
    if (toolNames?.length === 0) {
      wrapper.setForceEmptySystemPrompt(true);
    }
    wrapper.start();

    const realSessionId = inner.sessionId as string;
    const realSessionFile = inner.sessionFile as string | undefined;
    if (realSessionFile) cacheSessionPath(realSessionId, realSessionFile);

    wrapper.onDestroy(() => registry.delete(realSessionId));
    registry.set(realSessionId, wrapper);
    wrapper.beginExtensionBinding({ forceEmptySystemPrompt: toolNames?.length === 0 });

    return { session: wrapper, realSessionId };
  })().finally(() => locks.delete(sessionId));

  locks.set(sessionId, starting);
  return starting;
}

// The running-status broadcaster reads its ids from here, which keeps that
// module free of a dependency on the session wrapper.
setRunningIdsProvider(getRunningRpcSessionIds);
