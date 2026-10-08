import type {
  AgentCommand,
  AgentInfo,
  MemoryEntry,
  ProjectTask,
  TaskStatus,
  AgentEvent,
  CredentialMutationResult,
  DirEntry,
  EntryContentResult,
  FileContent,
  FileMeta,
  HistoryWindow,
  LoginProgressEvent,
  ModelsConfig,
  ModelsListResult,
  PagedContextInfo,
  ProviderStatus,
  RunningStateEvent,
  SessionDetail,
  SessionInfo,
  TestResult,
  WorktreeInfo,
} from "./types";
import type {
  JevConfigPayload,
  JevTestResult,
  McpCommandResultPayload,
  McpConfigPayload,
  McpExposurePayload,
  McpScopePayload,
} from "../shared/api-types";
import type {
  ContextFoldCommand,
  ContextFoldResult,
  ContextMapSnapshot,
  GitStatusResult,
  PluginActionParams,
  PluginsResponse,
} from "../shared/api-types";
import type {
  ChannelAccountConfig,
  ChannelBinding,
  ChannelBindingChange,
  ChannelLoginEvent,
  ChannelProbeResult,
  ChannelsSnapshot,
  ChannelStatus,
  ChannelPairingRequest,
  ChannelActivity,
  ChannelId,
  ChannelTestSendResult,
} from "../shared/channel-types";
import type { ToolCapabilityId, ToolProvider } from "../shared/toolchains/types";

/** Request/response API surface (replaces HTTP routes). */
export interface Api {
  "host.ping": { params: void; result: { ok: true; ts: number } };
  "host.toolchain": {
    params: { cwd: string };
    result: {
      inventoryRevision: number;
      resolutionId: string;
      capabilities: Partial<Record<ToolCapabilityId, { provider: ToolProvider; version: string }>>;
    };
  };

  // Sessions & projects
  "sessions.list": {
    params: { cwd?: string } | void;
    result: { sessions: SessionInfo[]; runningSessionIds: string[] };
  };
  "sessions.get": {
    params: { id: string; includeState?: boolean; traceId?: string; historyWindow?: HistoryWindow };
    result: SessionDetail;
  };
  "sessions.context": {
    params: { id: string; leafId?: string; historyWindow?: HistoryWindow };
    result: { context: PagedContextInfo };
  };
  "sessions.contextPage": {
    params: { id: string; cursor: string; maxTurns?: number; maxBytes?: number };
    result: { context: PagedContextInfo };
  };
  "sessions.entryContent": {
    params: { id: string; entryId: string; blockIndex?: number };
    result: EntryContentResult;
  };
  "sessions.export": {
    params: { id: string; format?: "md" | "json" };
    result: { content: string; suggestedName: string };
  };
  "sessions.delete": { params: { id: string; force?: boolean }; result: { ok: true } };
  "sessions.rename": {
    params: { id: string; name: string };
    result: { ok: true };
  };

  "worktrees.list": {
    params: { projectRoot: string };
    result: {
      worktrees: WorktreeInfo[];
      projectRoot: string;
      isGit: boolean;
      isTopLevel: boolean;
    };
  };
  "worktrees.create": {
    params: { projectRoot: string; branch: string; cwd?: string };
    result: { worktree: WorktreeInfo };
  };
  "worktrees.remove": {
    params: { path: string; cwd?: string; force?: boolean };
    result: { ok: true };
  };

  "git.diff": {
    params: { path: string; staged?: boolean };
    result: { patch: string; truncated: boolean; files: string[] };
  };
  "git.stage": { params: { path: string; files: string[] }; result: { ok: true } };
  "git.unstage": { params: { path: string; files: string[] }; result: { ok: true } };
  "git.commit": { params: { path: string; message: string }; result: { output: string } };
  "git.push": { params: { path: string }; result: { output: string } };
  "git.pull": { params: { path: string }; result: { output: string } };
  "git.branches": { params: { path: string }; result: { current: string | null; branches: string[] } };
  "git.checkout": { params: { path: string; branch: string }; result: { output: string } };

  "git.status": {
    params: { path: string };
    result: GitStatusResult;
  };

  // Agent lifecycle
  "agent.new": {
    params: {
      cwd: string;
      type?: string;
      message?: string;
      provider?: string;
      modelId?: string;
      toolNames?: string[];
      thinkingLevel?: string;
      [key: string]: unknown;
    };
    result: { sessionId: string; data?: unknown };
  };
  "agent.command": {
    params: { sessionId: string; command: AgentCommand };
    result: unknown;
  };
  "agent.state": {
    params: { sessionId: string };
    result: { running: boolean; state?: unknown };
  };

  // Messaging channels
  "channels.list": { params: void; result: ChannelsSnapshot };
  "channels.accountUpsert": {
    params: { account: ChannelAccountConfig };
    result: ChannelsSnapshot;
  };
  "channels.accountConnect": {
    params: { account: ChannelAccountConfig };
    result: ChannelsSnapshot;
  };
  "channels.accountDelete": {
    params: { accountId: string };
    result: ChannelsSnapshot;
  };
  "channels.start": { params: { accountId: string }; result: { ok: true } };
  "channels.stop": { params: { accountId: string }; result: { ok: true } };
  "channels.restart": { params: { accountId: string }; result: { ok: true } };
  "channels.probe": { params: { accountId: string }; result: ChannelProbeResult };
  "channels.loginStart": {
    params: { channel: ChannelId; force?: boolean };
    result: ChannelLoginEvent;
  };
  "channels.loginWait": {
    params: { channel: ChannelId; sessionKey: string };
    result: ChannelLoginEvent;
  };
  "channels.loginSubmitCode": {
    params: { channel: ChannelId; sessionKey: string; code: string };
    result: { ok: true };
  };
  "channels.loginCancel": {
    params: { channel: ChannelId; sessionKey: string };
    result: { ok: true };
  };
  "channels.pairingApprove": {
    params: { pairingId: string };
    result: ChannelsSnapshot;
  };
  "channels.pairingReject": {
    params: { pairingId: string };
    result: ChannelsSnapshot;
  };
  "channels.bindingUpsert": {
    params: { binding: ChannelBinding };
    result: ChannelsSnapshot;
  };
  "channels.bindingDelete": {
    params: { bindingId: string };
    result: ChannelsSnapshot;
  };
  "channels.testSend": {
    params: { accountId: string; peerId: string; message: string };
    result: ChannelTestSendResult;
  };

  // Files
  "files.list": { params: { path: string }; result: { entries: DirEntry[] } };
  "files.read": {
    params: { path: string; sourceSessionId?: string };
    result: FileContent & {
      encoding?: "utf8" | "base64" | "too_large";
      mime?: string;
    };
  };
  "files.download": {
    params: { path: string; sourceSessionId?: string };
    result: { base64: string; size: number; mime: string };
  };
  "jev.getConfig": {
    params: void;
    result: JevConfigPayload;
  };
  "jev.updateConfig": {
    params: { patch: unknown };
    result: JevConfigPayload;
  };
  "jev.setKey": {
    params: { apiKey: string };
    result: JevConfigPayload;
  };
  "jev.test": {
    params: void;
    result: JevTestResult;
  };

  "mcp.getConfig": {
    params: { cwd?: string } | void;
    result: McpConfigPayload;
  };
  "mcp.setServer": {
    params: { cwd?: string; name: string; config: Record<string, unknown>; scope?: McpScopePayload };
    result: McpConfigPayload;
  };
  "mcp.patchServer": {
    params: {
      cwd?: string;
      name: string;
      patch: { enabled?: boolean; exposure?: McpExposurePayload; description?: string | null };
      scope?: McpScopePayload;
    };
    result: McpConfigPayload;
  };
  "mcp.removeServer": {
    params: { cwd?: string; name: string; scope?: McpScopePayload };
    result: McpConfigPayload;
  };
  "mcp.setAutoEnableCodemode": {
    params: { cwd?: string; value: boolean; scope?: McpScopePayload };
    result: McpConfigPayload;
  };
  /** `list` reports live state and tools; `login`/`logout` drive OAuth through pi's own flow. */
  "mcp.runCommand": {
    params: { cwd?: string; args: string[] };
    result: McpCommandResultPayload;
  };

  "context.map": {
    params: { sessionId: string };
    result: ContextMapSnapshot;
  };
  "context.fold": {
    params: { sessionId: string; command: ContextFoldCommand };
    result: ContextFoldResult;
  };

  // Desktop settings that the Host persists (auto-compaction, ...)
  "files.write": {
    params: { path: string; content: string; sourceSessionId?: string };
    result: { ok: true };
  };
  "files.meta": {
    params: { path: string; sourceSessionId?: string };
    result: FileMeta;
  };
  "files.preview": {
    params: { path: string; sourceSessionId?: string };
    result: { kind: string; content?: string; base64?: string; mime?: string; [key: string]: unknown };
  };
  "files.index": {
    params: { root: string; query?: string };
    result: {
      files: string[];
      truncated: boolean;
      matches?: Array<{ path: string; isDir?: boolean; score?: number }>;
    };
  };
  "files.watchStart": {
    params: { path: string; sourceSessionId?: string };
    result: { ok: true };
  };
  "files.watchStop": {
    params: { path: string };
    result: { ok: true };
  };

  // Config
  "models.list": {
    params: { cwd?: string } | void;
    result: ModelsListResult;
  };
  "models.refresh": {
    params: { cwd?: string; requestId: string };
    result: ModelsListResult;
  };
  "models.refreshCancel": {
    params: { requestId: string };
    result: { ok: true; cancelled: boolean };
  };
  "modelsConfig.get": { params: void; result: ModelsConfig };
  "modelsConfig.set": { params: ModelsConfig; result: { ok: true } };
  "modelsConfig.test": {
    params: {
      providerName?: string;
      provider?: Record<string, unknown>;
      model?: Record<string, unknown>;
      [key: string]: unknown;
    };
    result: TestResult;
  };

  "auth.providers": { params: void; result: { providers: ProviderStatus[] } };
  "auth.allProviders": { params: void; result: { providers: ProviderStatus[] } };
  "auth.setApiKey": {
    params: { provider: string; key: string };
    result: CredentialMutationResult;
  };
  "auth.deleteApiKey": {
    params: { provider: string };
    result: CredentialMutationResult;
  };
  "auth.logout": { params: { provider: string }; result: CredentialMutationResult };
  "auth.loginSubmit": {
    params: { provider: string; token: string; code: string };
    result: { ok: true };
  };
  /** Kick off OAuth login; progress arrives on Streams["auth.login"]. */
  "auth.loginStart": {
    params: { provider: string };
    result: { ok: true; started: boolean };
  };
  "auth.loginCancel": {
    params: { provider: string };
    result: { ok: true };
  };

  // Voice input (transcription runs in the host, where the credential lives)
  "voice.config": { params: void; result: { provider: string; model: string } };
  "voice.transcribe": {
    params: {
      audioBase64: string;
      mimeType: string;
      provider?: string;
      model?: string;
      language?: string;
    };
    result: { text: string; provider: string; model: string };
  };

  // Project task board (.pi/tasks.json)
  "tasks.list": { params: { cwd: string }; result: { tasks: ProjectTask[] } };
  "tasks.add": {
    params: { cwd: string; title: string; notes?: string; status?: TaskStatus };
    result: { task: ProjectTask };
  };
  "tasks.update": {
    params: { cwd: string; id: string; title?: string; notes?: string; status?: TaskStatus };
    result: { task: ProjectTask };
  };
  "tasks.remove": { params: { cwd: string; id: string }; result: { ok: true } };

  // Project memory (.pi/memory.json)
  "memory.list": { params: { cwd: string }; result: { entries: MemoryEntry[] } };
  "memory.add": { params: { cwd: string; text: string; tag?: string }; result: { entry: MemoryEntry } };
  "memory.update": {
    params: { cwd: string; id: string; text?: string; tag?: string };
    result: { entry: MemoryEntry };
  };
  "memory.remove": { params: { cwd: string; id: string }; result: { ok: true } };

  // Agent definitions (subagent tool)
  "agents.list": {
    params: { cwd?: string; scope?: "user" | "project" | "both" } | void;
    result: { agents: AgentInfo[]; projectAgentsDir: string | null };
  };
  "agents.setModel": {
    params: { filePath: string; model?: string | null };
    result: { ok: true };
  };

  "plugins.list": {
    params: { cwd?: string } | void;
    result: PluginsResponse;
  };
  "plugins.set": {
    params: PluginActionParams;
    result: PluginsResponse;
  };

  // System / desktop helpers exposed via Host (or main-bridged)
  "system.home": { params: void; result: { home: string } };
  "system.validateCwd": {
    params: { path: string };
    result: { ok: boolean; path?: string; error?: string };
  };
  "system.defaultCwd": { params: void; result: { cwd: string } };
  "system.allowRoot": { params: { path: string }; result: { ok: true } };
  "system.runningCount": { params: void; result: { count: number; sessionIds: string[] } };
}

/** Server-push streams delivered over MessagePort RPC. */
export interface Streams {
  "agent.events": AgentEvent;
  "agent.running": RunningStateEvent;
  "auth.login": LoginProgressEvent;
  "sessions.changed": {
    cwd: string | null;
    sessionId?: string;
    session?: SessionInfo;
    deleted?: boolean;
    fullRefresh?: boolean;
  };
  "files.changed": {
    path: string;
    event: "connected" | "change" | "error";
    mtime?: string;
    size?: number;
    message?: string;
  };
  "host.restarted": { reason: string };
  "host.ready": { ts: number };
  "channels.status": ChannelStatus;
  "channels.login": ChannelLoginEvent;
  "channels.pairing": ChannelPairingRequest;
  "channels.binding": ChannelBindingChange;
  "channels.activity": ChannelActivity;
}

export type ApiMethod = keyof Api;
export type StreamTopic = keyof Streams;

export type ApiParams<M extends ApiMethod> = Api[M]["params"];
export type ApiResult<M extends ApiMethod> = Api[M]["result"];
