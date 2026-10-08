import { SessionManager, type AgentSessionRuntimeDiagnostic } from "@earendil-works/pi-coding-agent";
import { randomUUID } from "crypto";
import { cacheSessionPath } from "./session-reader";
import type { SlashCommandInfo } from "@earendil-works/pi-coding-agent";
import type { AgentSessionLike, ExtensionUiContextLike, ToolInfo } from "../shared/pi-types";
import type { ChannelId } from "../shared/channel-types";
import type { ExtensionUiRequest, ExtensionUiResponse, ExtensionWidgetItem } from "../shared/types";
import { projectExtensionDiagnostics } from "./extension-diagnostics";
import {
  AUTO_COMPACT_CONTEXT_PERCENT,
  AUTO_COMPACT_RETRY_PERCENT_GROWTH,
  countBranchConversationMessages,
} from "../shared/auto-compact";
import { type DesktopPromptSettings } from "./system-prompt-extension";
import { withExtensionTools } from "./tool-activation";
import { getFoldSession } from "./context-fold";
import { captureTurnStart, collectTurnChanges, type TurnStartSnapshot } from "./turn-changes";
import {
  buildContinuationPrompt,
  buildReviewTask,
  clampMaxRounds,
  GOAL_ENTRY_TYPE,
  goalIsRunning,
  nextGoalState,
  parseGoalVerdict,
  REVIEWER_SYSTEM_PROMPT,
  type GoalState,
} from "./goal";
import { runSubagent } from "./subagent/runner";
import { notifyRunningChange } from "./running-status";

export interface AgentEvent {
  type: string;
  [key: string]: unknown;
}

type EventListener = (event: AgentEvent) => void;

type PendingUiResponse = {
  resolve: (response: ExtensionUiResponse) => void;
  cancel: () => void;
};

type CustomUiComponent = {
  render: (width: number) => string[];
  handleInput?: (data: string) => void;
  dispose?: () => void;
  invalidate?: () => void;
};

type ActiveCustomUi = {
  component: CustomUiComponent;
  width: number;
  resolve: (value: unknown) => void;
  settled: boolean;
};

type ExtensionUiRequestBody = Record<string, unknown> & {
  method: ExtensionUiRequest["method"];
  timeout?: number;
  expiresAt?: number;
};

type ExtensionCommandContextActionsLike = {
  waitForIdle: () => Promise<void>;
  newSession: () => Promise<{ cancelled: boolean }>;
  fork: () => Promise<{ cancelled: boolean }>;
  navigateTree: (targetId: string, options?: { summarize?: boolean }) => Promise<{ cancelled: boolean }>;
  switchSession: () => Promise<{ cancelled: boolean }>;
  reload: () => Promise<void>;
};

type ExtensionBindingOptions = {
  forceEmptySystemPrompt?: boolean;
};

export type ExternalSessionCommand = "compact" | "reload";

const LEGACY_CHANNEL_PROMPT = /^\[外部消息来源：(微信|Telegram|飞书 \/ Lark)\]\n/;
const LEGACY_CHANNEL_PROMPT_DELIMITER = "\n---\n";

function stripLegacyChannelPromptText(text: string): string {
  if (!LEGACY_CHANNEL_PROMPT.test(text)) return text;
  const delimiter = text.indexOf(LEGACY_CHANNEL_PROMPT_DELIMITER);
  return delimiter < 0 ? text : text.slice(delimiter + LEGACY_CHANNEL_PROMPT_DELIMITER.length);
}

function stripLegacyChannelPrompts(messages: unknown[]): unknown[] {
  return messages.map((message) => {
    if (!message || typeof message !== "object" || (message as { role?: unknown }).role !== "user") return message;
    const user = message as { content?: unknown };
    if (typeof user.content === "string") {
      const content = stripLegacyChannelPromptText(user.content);
      return content === user.content ? message : { ...message, content };
    }
    if (!Array.isArray(user.content)) return message;

    let changed = false;
    const content = user.content.map((block) => {
      if (!block || typeof block !== "object" || (block as { type?: unknown }).type !== "text") return block;
      const text = (block as { text?: unknown }).text;
      if (typeof text !== "string") return block;
      const stripped = stripLegacyChannelPromptText(text);
      if (stripped === text) return block;
      changed = true;
      return { ...block, text: stripped };
    });
    return changed ? { ...message, content } : message;
  });
}

// ============================================================================
// AgentSessionWrapper
// Wraps AgentSession with the same interface the rest of the app expects
// ============================================================================

export class AgentSessionWrapper {
  public readonly inner: AgentSessionLike;
  private listeners: EventListener[] = [];
  private pendingUiResponses = new Map<string, PendingUiResponse>();
  private pendingUiRequests = new Map<string, AgentEvent>();
  private activeCustomUis = new Map<string, ActiveCustomUi>();
  private extensionStatuses = new Map<string, string>();
  private runtimeDiagnosticStatuses = new Map<string, string>();
  private extensionWidgets = new Map<string, ExtensionWidgetItem>();
  private extensionWorkingMessage = "Working";
  private extensionWorkingIndicator = "";
  private extensionWorkingVisible = true;
  private extensionEditorText = "";
  private unsupportedExtensionFeatures = new Set<string>();
  private promptRunning = false;
  private queuedTurnCount = 0;
  private turnTail: Promise<void> = Promise.resolve();
  private externalTurnActive = false;
  private externalTurnChannel: ChannelId | null = null;
  private externalTurnProgress: ((event: AgentEvent) => void) | null = null;
  /** Goal mode state for this session; null when no goal is set. */
  private goal: GoalState | null = null;
  private goalReviewRunning = false;
  private extensionsBound = false;
  private extensionBindingPromise: Promise<void> | null = null;
  private extensionBindingError: unknown = null;
  private promptSettings: DesktopPromptSettings;
  private unsubscribe: (() => void) | null = null;
  private idleTimer: ReturnType<typeof setTimeout> | null = null;
  private onDestroyCallback: (() => void) | null = null;
  private _alive = true;
  private autoCompactInFlight = false;
  private autoCompactSkipUntilPercent = 0;
  private turnStart: Promise<TurnStartSnapshot | null> | null = null;
  private turnChangesWrite: Promise<void> = Promise.resolve();

  constructor(
    inner: AgentSessionLike,
    promptSettings: DesktopPromptSettings = { forceEmpty: false, toolchainPrompt: "" },
  ) {
    this.inner = inner;
    this.promptSettings = promptSettings;
    const messages = this.inner.agent.state?.messages;
    if (Array.isArray(messages)) this.inner.agent.state!.messages = stripLegacyChannelPrompts(messages);
  }

  get sessionId(): string {
    return this.inner.sessionId;
  }

  get sessionFile(): string {
    return this.inner.sessionFile ?? "";
  }

  get cwd(): string {
    const cwd = this.inner.sessionManager.getHeader()?.cwd;
    return typeof cwd === "string" ? cwd : "";
  }

  isAlive(): boolean {
    return this._alive;
  }

  isRunning(): boolean {
    return (
      this._alive &&
      (this.promptRunning || this.queuedTurnCount > 0 || this.inner.isStreaming || this.inner.isCompacting)
    );
  }

  start(): void {
    // The protected tail of the fold engine mirrors pi's own keep-recent budget, so
    // what folding refuses to touch is exactly what pi would have kept anyway.
    try {
      const keepRecent = this.inner.settingsManager.getCompactionKeepRecentTokens();
      if (typeof keepRecent === "number" && keepRecent > 0) {
        getFoldSession(this.sessionId).setProtectTokens(keepRecent);
      }
    } catch {
      // Settings unavailable: the engine keeps its own default.
    }
    this.unsubscribe = this.inner.subscribe((event: AgentEvent) => {
      this.resetIdleTimer();
      // pi's own token-budget compaction is left alone here: it only frees room
      // in the model context and must not touch session history. Deleting the
      // summarized turns belongs to a memory compaction, which happens on its own
      // threshold or when the user asks for it.
      const displayEvent = this.withExternalChannelSource(event);
      if (event.type === "agent_start") {
        this.turnStart ??= captureTurnStart(this.cwd);
      } else if (event.type === "agent_end" && this.turnStart) {
        const start = this.turnStart;
        this.turnStart = null;
        // Goal mode reviews after the turn lands, so the verdict sees the final
        // answer and the diff rather than a half-written state.
        void this.turnChangesWrite.then(() => this.reviewGoalIfNeeded());
        this.turnChangesWrite = start
          .then((snapshot) => (snapshot ? collectTurnChanges(snapshot) : { files: [], omitted: 0 }))
          .then(({ files, omitted }) => {
            if (!files.length && !omitted) return;
            this.inner.sessionManager.appendCustomEntry("pi-desktop-turn-changes", { files, omitted });
            this.emit({ type: "turn_changes" });
          })
          .catch((error) => console.error("[pi-desktop] turn changes unavailable:", error));
      }
      this.emit(displayEvent);
      try {
        this.externalTurnProgress?.(displayEvent);
      } catch {
        // Channel progress is best-effort and must never interrupt the Agent.
      }
      // Streaming / compaction / tool events flow through here; re-broadcast
      // the running-status snapshot so the sidebar can update live.
      notifyRunningChange();
    });
    this.resetIdleTimer();
    notifyRunningChange();
  }

  private withExternalChannelSource(event: AgentEvent): AgentEvent {
    if (!this.externalTurnChannel || (event.type !== "message_start" && event.type !== "message_end")) return event;
    const message = event.message;
    if (!message || typeof message !== "object" || (message as { role?: unknown }).role !== "user") return event;
    return {
      ...event,
      message: { ...(message as Record<string, unknown>), channelSource: this.externalTurnChannel },
    };
  }

  /** Set or replace the goal. An empty text clears it. */
  setGoal(input: { text: string; maxRounds?: number; autoReview?: boolean }): GoalState | null {
    const text = input.text.trim();
    if (!text) {
      this.clearGoal("stopped");
      return null;
    }
    const previous = this.goal;
    this.goal = {
      text,
      maxRounds: clampMaxRounds(input.maxRounds ?? previous?.maxRounds),
      rounds: 0,
      autoReview: input.autoReview ?? previous?.autoReview ?? false,
      status: "active",
      updatedAt: new Date().toISOString(),
    };
    this.persistGoal();
    this.emitGoal();
    return this.goal;
  }

  clearGoal(status: GoalState["status"] = "stopped"): void {
    if (!this.goal) return;
    this.goal = { ...this.goal, status, updatedAt: new Date().toISOString() };
    this.persistGoal();
    this.emitGoal();
  }

  goalSnapshot(): GoalState | null {
    return this.goal;
  }

  private persistGoal(): void {
    try {
      this.inner.sessionManager.appendCustomEntry(GOAL_ENTRY_TYPE, this.goal ?? {});
    } catch (error) {
      console.error("[pi-desktop] could not persist goal:", error);
    }
  }

  private emitGoal(): void {
    this.emit({ type: "goal_state", state: this.goal } as unknown as AgentEvent);
  }

  /**
   * Ask a tool-less reviewer whether the last answer met the goal, and continue
   * the session when it did not. Off unless the user turned it on: it spends
   * tokens after every turn.
   */
  private async reviewGoalIfNeeded(): Promise<void> {
    const goal = this.goal;
    if (!goal || !goalIsRunning(goal) || !goal.autoReview || this.goalReviewRunning) return;
    this.goalReviewRunning = true;
    try {
      const entries = this.inner.sessionManager.getEntries();
      const finalText = latestAssistantText(entries);
      const diffStat = await this.diffStat();
      const result = await runSubagent({
        agent: {
          name: "goal-reviewer",
          description: "Reviews whether a goal was met",
          systemPrompt: REVIEWER_SYSTEM_PROMPT,
          tools: [],
          source: "user",
          filePath: "",
        },
        task: buildReviewTask({ goal: goal.text, finalText, ...(diffStat ? { diffStat } : {}) }),
        cwd: this.cwd,
      });
      const verdict = parseGoalVerdict(result.text ?? "");
      const next = nextGoalState(goal, verdict);
      this.goal = next;
      this.persistGoal();
      this.emitGoal();
      if (next.status === "active") {
        await this.send({ type: "prompt", message: buildContinuationPrompt(next, verdict.reason) });
      }
    } catch (error) {
      console.error("[pi-desktop] goal review failed:", error);
    } finally {
      this.goalReviewRunning = false;
    }
  }

  private async diffStat(): Promise<string | undefined> {
    try {
      const { execFile } = await import("node:child_process");
      const { promisify } = await import("node:util");
      const run = promisify(execFile);
      const { stdout } = await run("git", ["diff", "--stat"], { cwd: this.cwd, maxBuffer: 1024 * 1024 });
      return stdout.trim() || undefined;
    } catch {
      return undefined;
    }
  }

  setForceEmptySystemPrompt(force: boolean): void {
    this.promptSettings.forceEmpty = force;
  }

  setToolchainSummary(revision: number, summary: readonly string[]): void {
    this.promptSettings.toolchainPrompt = [
      `<pi-desktop-toolchain revision="${revision}">`,
      ...summary,
      "</pi-desktop-toolchain>",
    ].join("\n");
  }

  setRuntimeDiagnostics(diagnostics: readonly AgentSessionRuntimeDiagnostic[]): void {
    this.runtimeDiagnosticStatuses = new Map(
      projectExtensionDiagnostics(diagnostics).map(({ key, text }) => [key, text]),
    );
  }

  beginExtensionBinding(options: ExtensionBindingOptions = {}): void {
    void this.ensureExtensionsBound(options).catch((err) => {
      console.error(
        "[pi-desktop] failed to dispatch session_start to extensions:",
        err instanceof Error ? err.message : err,
      );
    });
  }

  private ensureExtensionsBound(options: ExtensionBindingOptions = {}): Promise<void> {
    if (options.forceEmptySystemPrompt) this.setForceEmptySystemPrompt(true);
    if (this.extensionsBound) return Promise.resolve();
    if (this.extensionBindingPromise) return this.extensionBindingPromise;

    this.extensionBindingError = null;
    this.extensionBindingPromise = (async () => {
      if (!this._alive) return;
      const uiContext = this.createExtensionUiContext();
      if (typeof this.inner.bindExtensions === "function") {
        const bindExtensions = this.inner.bindExtensions as (bindings: {
          uiContext?: ExtensionUiContextLike;
          mode?: "rpc";
          commandContextActions?: ExtensionCommandContextActionsLike;
          shutdownHandler?: () => void;
          onError?: (error: { extensionPath: string; event: string; error: string }) => void;
        }) => Promise<void>;
        await bindExtensions.call(this.inner, {
          uiContext,
          mode: "rpc",
          commandContextActions: this.createExtensionCommandContextActions(),
          shutdownHandler: () =>
            this.emit({
              type: "extension_ui_request",
              id: randomUUID(),
              method: "notify",
              notifyType: "warning",
              message: "Extension requested shutdown, but shutdown is not supported in Pi Desktop.",
            } as ExtensionUiRequest as AgentEvent),
          onError: (error) =>
            this.emit({
              type: "extension_error",
              extensionPath: error.extensionPath,
              event: error.event,
              error: error.error,
            }),
        });
      } else {
        this.inner.extensionRunner.setUIContext?.(uiContext, "rpc");
      }
      this.extensionsBound = true;
      console.log(`[pi-desktop] session_start dispatched to extensions for session ${this.inner.sessionId}`);
    })().catch((err) => {
      this.extensionBindingError = err;
      throw err;
    });

    return this.extensionBindingPromise;
  }

  private async waitForExtensionsBound(): Promise<void> {
    try {
      if (this.extensionBindingPromise) await this.extensionBindingPromise;
    } catch (err) {
      throw err instanceof Error ? err : new Error(String(err));
    }
    if (this.extensionBindingError) {
      throw this.extensionBindingError instanceof Error
        ? this.extensionBindingError
        : new Error(String(this.extensionBindingError));
    }
  }

  private shouldWaitForExtensions(type: string): boolean {
    return type === "prompt" || type === "steer" || type === "follow_up" || type === "get_commands";
  }

  private async withFinalRunningNotification<T>(operation: () => Promise<T>): Promise<T> {
    try {
      return await operation();
    } finally {
      notifyRunningChange();
    }
  }

  private emit(event: AgentEvent): void {
    for (const l of this.listeners) l(event);
  }

  private enqueueTurn<T>(task: () => Promise<T>): Promise<T> {
    this.queuedTurnCount += 1;
    notifyRunningChange();
    const run = this.turnTail
      .catch(() => undefined)
      .then(async () => {
        if (!this._alive) throw new Error("Agent session is no longer available");
        this.promptRunning = true;
        notifyRunningChange();
        try {
          return await task();
        } finally {
          this.promptRunning = false;
          this.queuedTurnCount = Math.max(0, this.queuedTurnCount - 1);
          notifyRunningChange();
          // After every completed turn, consider compacting by message count.
          // Scheduled outside this promise so the compaction turn can enqueue
          // behind turnTail instead of waiting on itself.
          this.scheduleAutoCompactCheck();
        }
      });
    this.turnTail = run.then(
      () => undefined,
      () => undefined,
    );
    return run;
  }

  private scheduleAutoCompactCheck(): void {
    if (!this._alive) return;
    setImmediate(() => void this.maybeAutoCompact());
  }

  /** Retry the context trigger after an attempt that could not shrink it. */
  private rescheduleAfterContextCompact(percent: number, reduced: boolean): void {
    this.autoCompactSkipUntilPercent = reduced ? 0 : percent + AUTO_COMPACT_RETRY_PERCENT_GROWTH;
  }

  /**
   * Automatic context compaction.
   *
   * A context window that is filling up is summarised by pi itself, which frees room for the model
   * and leaves every message on disk. Only runs when the session is fully idle, so a queued or
   * streaming turn never gets compacted mid-flight; that turn schedules its own check when it
   * finishes. A compaction that cannot reduce the context raises the floor so the next attempt waits
   * for meaningful growth instead of retrying every turn.
   */
  private async maybeAutoCompact(): Promise<void> {
    if (!this._alive || this.autoCompactInFlight) return;
    if (this.queuedTurnCount > 0 || this.promptRunning || this.inner.isStreaming || this.inner.isCompacting) return;
    const percent = this.inner.getContextUsage()?.percent ?? 0;
    const overPercent =
      this.inner.autoCompactionEnabled !== false &&
      percent >= AUTO_COMPACT_CONTEXT_PERCENT &&
      percent >= this.autoCompactSkipUntilPercent;
    if (!overPercent) return;

    this.autoCompactInFlight = true;
    try {
      await this.enqueueTurn(async () => {
        await this.inner.compact(undefined);
      });
      const afterPercent = this.inner.getContextUsage()?.percent ?? 0;
      this.rescheduleAfterContextCompact(percent, afterPercent < percent - 1);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.rescheduleAfterContextCompact(percent, false);
      console.error("[pi-desktop] automatic compaction failed:", message);
      // Also tell the UI. A compaction that keeps failing is otherwise invisible:
      // the context grows until the model itself refuses the request, and the only
      // trace is this log line. A summarization failure is usually quota or auth on
      // the *session* model, which is worth saying, because Jev compaction does not
      // call that model at all.
      this.emit({
        type: "notice",
        level: "error",
        message: `自动压缩失败：${message}（上下文仍在增长；若这是会话模型的额度或鉴权问题，开启 Jev 上下文压缩可绕开它）`,
      });
    } finally {
      this.autoCompactInFlight = false;
      // enqueueTurn's idle check ran while this flag was still set. Give the
      // other trigger a chance without waiting for another user turn.
      this.scheduleAutoCompactCheck();
    }
  }

  async runExternalTurn(params: {
    runId: string;
    message: string;
    channel: ChannelId;
    images?: Array<{ type: "image"; data: string; mimeType: string }>;
    attachmentContext?: string;
    onProgress?: (event: AgentEvent) => void;
  }): Promise<{ runId: string; finalText: string }> {
    return this.enqueueTurn(async () => {
      this.emit({ type: "channel_turn_start", runId: params.runId });
      this.externalTurnActive = true;
      this.externalTurnChannel = params.channel;
      this.externalTurnProgress = params.onProgress ?? null;
      this.turnStart = captureTurnStart(this.cwd);
      await this.turnStart;
      try {
        this.inner.sessionManager.appendCustomEntry("pi-desktop-channel-source", {
          runId: params.runId,
          channel: params.channel,
        });
        if (params.attachmentContext) {
          await this.inner.sendCustomMessage(
            {
              customType: "pi-desktop-channel-attachment-context",
              content: params.attachmentContext,
              display: false,
            },
            { deliverAs: "nextTurn" },
          );
        }
        await this.inner.prompt(params.message, {
          ...(params.images?.length ? { images: params.images } : {}),
          expandPromptTemplates: false,
          source: "rpc",
        });
        await this.turnChangesWrite;
        const finalText = this.inner.getLastAssistantText()?.trim() ?? "";
        this.emit({ type: "channel_turn_end", runId: params.runId, finalText });
        return { runId: params.runId, finalText };
      } catch (error) {
        try {
          this.inner.sessionManager.appendCustomEntry("pi-desktop-channel-source-cancelled", { runId: params.runId });
        } catch {
          // A best-effort UI marker must never hide the original turn failure.
        }
        this.emit({
          type: "channel_turn_error",
          runId: params.runId,
          errorMessage: error instanceof Error ? error.message : String(error),
        });
        throw error;
      } finally {
        this.turnStart = null;
        this.externalTurnProgress = null;
        this.externalTurnActive = false;
        this.externalTurnChannel = null;
      }
    });
  }

  private async reloadSessionResources(): Promise<void> {
    await this.waitForExtensionsBound();
    this.extensionStatuses.clear();
    this.extensionWidgets.clear();
    await this.inner.reload();
    if (typeof this.inner.bindExtensions !== "function") {
      this.inner.extensionRunner.setUIContext?.(this.createExtensionUiContext(), "rpc");
    }
  }

  async runExternalCommand(params: { command: ExternalSessionCommand; customInstructions?: string }): Promise<void> {
    await this.enqueueTurn(async () => {
      if (params.command === "compact") {
        // Plain context compaction: pi's own prompt, nothing else is touched.
        await this.inner.compact(params.customInstructions);
        return;
      }
      await this.reloadSessionResources();
    });
  }

  private resetIdleTimer(): void {
    if (this.idleTimer) clearTimeout(this.idleTimer);
    this.idleTimer = setTimeout(
      () => {
        // Never idle-evict a still-running agent (ISSUE-003)
        if (this.isRunning()) {
          this.resetIdleTimer();
          return;
        }
        this.destroy();
      },
      10 * 60 * 1000,
    );
  }

  /**
   * The transcript as this live session holds it.
   *
   * Reading the session file while a turn is running means reading a file that is being appended to;
   * the in-memory entries are both consistent and fresher, so `sessions.get` prefers them.
   */
  liveSnapshot(): { manager: SessionManager; entries: unknown[] } | null {
    if (!this._alive) return null;
    try {
      return {
        manager: this.inner.sessionManager,
        entries: this.inner.sessionManager.getEntries() as unknown[],
      };
    } catch {
      return null;
    }
  }

  onEvent(listener: EventListener): () => void {
    this.listeners.push(listener);
    for (const event of this.pendingUiRequests.values()) listener(event);
    return () => {
      const i = this.listeners.indexOf(listener);
      if (i !== -1) this.listeners.splice(i, 1);
    };
  }

  onDestroy(cb: () => void): void {
    this.onDestroyCallback = cb;
  }

  async send(command: Record<string, unknown>): Promise<unknown> {
    this.resetIdleTimer();
    const type = command.type as string;
    if (this.shouldWaitForExtensions(type)) await this.waitForExtensionsBound();

    switch (type) {
      case "prompt": {
        // Fire and forget — events come via subscribe
        const promptImages = command.images as Array<{ type: "image"; data: string; mimeType: string }> | undefined;
        const streamingBehavior = command.streamingBehavior as "steer" | "followUp" | undefined;
        const invokePrompt = async () => {
          if (!streamingBehavior) {
            this.turnStart = captureTurnStart(this.cwd);
            await this.turnStart;
          }
          try {
            await this.inner.prompt(command.message as string, {
              ...(promptImages?.length ? { images: promptImages } : {}),
              ...(streamingBehavior ? { streamingBehavior } : {}),
              source: "rpc",
            });
            if (!streamingBehavior) await this.turnChangesWrite;
          } finally {
            if (!streamingBehavior) this.turnStart = null;
          }
        };
        const operation = streamingBehavior ? invokePrompt() : this.enqueueTurn(invokePrompt);
        operation
          .then(() => {
            if (!streamingBehavior) this.emit({ type: "prompt_done" });
          })
          .catch((error) => {
            this.emit({
              type: "prompt_error",
              errorMessage: error instanceof Error ? error.message : String(error),
            });
            if (!streamingBehavior) this.emit({ type: "prompt_done" });
          });
        return null;
      }

      case "abort":
        await this.withFinalRunningNotification(() => this.inner.abort());
        return null;

      case "get_state": {
        const model = this.inner.model;
        const contextUsage = this.inner.getContextUsage();
        return {
          sessionId: this.inner.sessionId,
          sessionFile: this.inner.sessionFile ?? "",
          isStreaming: this.inner.isStreaming,
          isPromptRunning: this.promptRunning,
          isCompacting: this.inner.isCompacting,
          autoCompactionEnabled: this.inner.autoCompactionEnabled,
          autoRetryEnabled: this.inner.autoRetryEnabled,
          model: model ? { id: model.id, provider: model.provider } : undefined,
          messageCount: countBranchConversationMessages(this.inner.sessionManager.getBranch()),
          pendingMessageCount: this.inner.pendingMessageCount,
          queuedMessages: {
            steering: [...this.inner.getSteeringMessages()],
            followUp: [...this.inner.getFollowUpMessages()],
          },
          contextUsage: contextUsage
            ? { percent: contextUsage.percent, contextWindow: contextUsage.contextWindow, tokens: contextUsage.tokens }
            : null,
          systemPrompt: this.inner.agent.state?.systemPrompt ?? "",
          thinkingLevel: this.inner.agent.state?.thinkingLevel ?? "off",
          extensionStatuses: this.getExtensionStatuses(),
          extensionWidgets: this.getExtensionWidgets(),
        };
      }

      case "set_model": {
        const { provider, modelId } = command as { provider: string; modelId: string };
        const model = this.inner.modelRuntime.getModel(provider, modelId);
        if (!model) throw new Error(`Model not found: ${provider}/${modelId}`);
        await this.inner.setModel(model);
        return { id: model.id, provider: model.provider };
      }

      case "fork": {
        const entryId = command.entryId as string;
        const sessionManager = this.inner.sessionManager;
        const currentSessionFile = this.inner.sessionFile;

        if (!sessionManager.isPersisted()) return { cancelled: true };
        if (!currentSessionFile) throw new Error("Persisted session is missing a session file");

        const entry = sessionManager.getEntry(entryId);
        if (!entry) throw new Error("Invalid entry ID for forking");

        const sessionDir = sessionManager.getSessionDir();
        let newSessionFile: string;

        if (!entry.parentId) {
          // Fork before the first message: create an empty session linked to this one
          const newManager = SessionManager.create(sessionManager.getCwd(), sessionDir);
          newManager.newSession({ parentSession: currentSessionFile });
          newSessionFile = newManager.getSessionFile() as string;
        } else {
          // Fork after some history: copy path up to (but not including) the fork point
          const sourceManager = SessionManager.open(currentSessionFile, sessionDir);
          const forkedPath = sourceManager.createBranchedSession(entry.parentId);
          if (!forkedPath) throw new Error("Failed to create forked session");
          newSessionFile = forkedPath;
        }

        const newSessionId = SessionManager.open(newSessionFile, sessionDir).getSessionId();
        cacheSessionPath(newSessionId, newSessionFile);
        this.destroy();
        return { cancelled: false, newSessionId };
      }

      case "navigate_tree": {
        const result = await this.inner.navigateTree(command.targetId as string, {});
        return { cancelled: result.cancelled };
      }

      case "set_thinking_level": {
        const level = command.level as string;
        this.inner.setThinkingLevel(level);
        // setThinkingLevel clamps xhigh→high for models where supportsXhigh()===false.
        // If the model has DeepSeek thinking compat (reasoningEffortMap maps xhigh→max),
        // force the state back so the compat layer can use it correctly.
        if (
          level === "xhigh" &&
          (this.inner.model as { compat?: { thinkingFormat?: string } } | null)?.compat?.thinkingFormat ===
            "deepseek" &&
          this.inner.agent?.state
        ) {
          this.inner.agent.state.thinkingLevel = "xhigh";
        }
        return null;
      }

      case "compact": {
        const result = await this.withFinalRunningNotification(() =>
          this.enqueueTurn(async () => {
            const focus = command.customInstructions as string | undefined;
            return await this.inner.compact(focus);
          }),
        );
        return result;
      }

      case "set_session_name": {
        const name = (command.name as string | undefined)?.trim();
        if (!name) throw new Error("Session name cannot be empty");
        this.inner.setSessionName(name);
        return null;
      }

      case "get_session_stats": {
        return {
          ...this.inner.getSessionStats(),
          sessionName: this.inner.sessionManager.getSessionName(),
        };
      }

      case "get_last_assistant_text": {
        return { text: this.inner.getLastAssistantText() ?? "" };
      }

      case "set_auto_compaction": {
        this.inner.setAutoCompactionEnabled(command.enabled as boolean);
        return null;
      }

      case "clear_queue": {
        // Full clear only: pi has no single-item dequeue, and clear+requeue
        // races against the agent loop pulling messages mid-flight.
        return this.inner.clearQueue();
      }

      case "steer": {
        const steerImages = command.images as Array<{ type: "image"; data: string; mimeType: string }> | undefined;
        await this.inner.steer(command.message as string, steerImages?.length ? steerImages : undefined);
        return null;
      }

      case "follow_up": {
        const followImages = command.images as Array<{ type: "image"; data: string; mimeType: string }> | undefined;
        await this.inner.followUp(command.message as string, followImages?.length ? followImages : undefined);
        return null;
      }

      case "get_tools": {
        const all: ToolInfo[] = this.inner.getAllTools();
        const active = new Set<string>(this.inner.getActiveToolNames());
        return all.map((t) => ({
          name: t.name,
          description: t.description,
          active: active.has(t.name),
        }));
      }

      case "get_commands": {
        const commands: SlashCommandInfo[] = [];
        for (const registered of this.inner.extensionRunner.getRegisteredCommands()) {
          commands.push({
            name: registered.invocationName,
            description: registered.description,
            source: "extension",
            sourceInfo: registered.sourceInfo,
          });
        }
        for (const template of this.inner.promptTemplates) {
          commands.push({
            name: template.name,
            description: template.description,
            source: "prompt",
            sourceInfo: template.sourceInfo,
          });
        }
        for (const skill of this.inner.resourceLoader.getSkills().skills) {
          commands.push({
            name: `skill:${skill.name}`,
            description: skill.description,
            source: "skill",
            sourceInfo: skill.sourceInfo,
          });
        }
        return { commands };
      }

      case "set_tools": {
        const toolNames = command.toolNames as string[];
        this.setForceEmptySystemPrompt(toolNames.length === 0);
        this.inner.setActiveToolsByName(withExtensionTools(this.inner, toolNames));
        return null;
      }

      case "reload": {
        await this.enqueueTurn(() => this.reloadSessionResources());
        return { success: true };
      }

      case "abort_compaction": {
        this.inner.abortCompaction();
        return null;
      }

      case "extension_ui_response": {
        this.resolveExtensionUiResponse(command as ExtensionUiResponse);
        return null;
      }

      case "extension_ui_input": {
        this.handleExtensionUiInput(command.id as string, command.data as string);
        return null;
      }

      case "set_auto_retry": {
        this.inner.setAutoRetryEnabled(command.enabled as boolean);
        return null;
      }

      default:
        throw new Error(`Unsupported command: ${type}`);
    }
  }

  /**
   * Stop the underlying agent and release resources (ISSUE-001).
   * Prefer dispose() for full teardown after abort.
   */
  async abortAndDispose(): Promise<void> {
    if (!this._alive) return;
    try {
      await this.inner.abort();
    } catch {
      /* already stopped */
    }
    try {
      const agent = this.inner.agent as { waitForIdle?: () => Promise<void>; dispose?: () => void | Promise<void> };
      await agent.waitForIdle?.();
      await agent.dispose?.();
    } catch {
      /* best-effort */
    }
    this.destroy();
  }

  destroy(): void {
    if (!this._alive) return;
    this._alive = false;
    if (this.idleTimer) clearTimeout(this.idleTimer);
    this.unsubscribe?.();
    this.unsubscribe = null;
    for (const pending of this.pendingUiResponses.values()) pending.cancel();
    for (const id of Array.from(this.activeCustomUis.keys())) this.closeCustomUi(id, undefined);
    this.pendingUiResponses.clear();
    this.pendingUiRequests.clear();
    this.listeners = [];
    this.onDestroyCallback?.();
    notifyRunningChange();
  }

  private resolveExtensionUiResponse(response: ExtensionUiResponse): void {
    const pending = this.pendingUiResponses.get(response.id);
    if (!pending) return;
    pending.resolve(response);
  }

  private getExtensionStatuses(): Array<{ key: string; text: string }> {
    return Array.from(new Map([...this.runtimeDiagnosticStatuses, ...this.extensionStatuses]), ([key, text]) => ({
      key,
      text,
    }));
  }

  private setExtensionStatus(key: string, text: string | undefined): void {
    if (text === undefined) this.extensionStatuses.delete(key);
    else this.extensionStatuses.set(key, text);
    this.emit({
      type: "extension_ui_request",
      id: randomUUID(),
      method: "setStatus",
      statusKey: key,
      statusText: text,
    } as ExtensionUiRequest as AgentEvent);
  }

  private syncExtensionWorkingStatus(): void {
    this.setExtensionStatus(
      "extension-working",
      this.extensionWorkingVisible
        ? [this.extensionWorkingIndicator, this.extensionWorkingMessage].filter(Boolean).join(" ")
        : undefined,
    );
  }

  private reportUnsupportedExtensionFeature(feature: string): void {
    if (this.unsupportedExtensionFeatures.has(feature)) return;
    this.unsupportedExtensionFeatures.add(feature);
    this.emit({
      type: "extension_ui_request",
      id: randomUUID(),
      method: "notify",
      message: `Extension feature “${feature}” is terminal-specific and is not available in the desktop renderer.`,
      notifyType: "warning",
    } as ExtensionUiRequest as AgentEvent);
  }

  private getExtensionWidgets(): ExtensionWidgetItem[] {
    return Array.from(this.extensionWidgets.values());
  }

  private getCustomUiWidth(options: unknown): number {
    if (!options || typeof options !== "object") return 92;
    const overlayOptions = (options as { overlayOptions?: unknown }).overlayOptions;
    const resolved = typeof overlayOptions === "function" ? overlayOptions() : overlayOptions;
    if (!resolved || typeof resolved !== "object") return 92;
    const width = (resolved as { width?: unknown }).width;
    return typeof width === "number" && Number.isFinite(width) ? Math.max(40, Math.min(140, Math.round(width))) : 92;
  }

  private emitCustomUiRender(id: string, custom: ActiveCustomUi): void {
    let lines: string[];
    try {
      lines = custom.component.render(custom.width);
    } catch (error) {
      lines = [`Extension custom UI render failed: ${error instanceof Error ? error.message : String(error)}`];
    }
    const event = {
      type: "extension_ui_request",
      id,
      method: "custom",
      lines,
    } as ExtensionUiRequest as AgentEvent;
    this.pendingUiRequests.set(id, event);
    this.emit(event);
  }

  private closeCustomUi(id: string, value: unknown): void {
    const custom = this.activeCustomUis.get(id);
    if (!custom || custom.settled) return;
    custom.settled = true;
    this.activeCustomUis.delete(id);
    this.pendingUiRequests.delete(id);
    try {
      custom.component.dispose?.();
    } catch {
      // Ignore dispose errors from extension UI components.
    }
    this.emit({
      type: "extension_ui_request",
      id,
      method: "custom",
      lines: [],
      closed: true,
    } as ExtensionUiRequest as AgentEvent);
    custom.resolve(value);
  }

  private handleExtensionUiInput(id: string, data: string): void {
    const custom = this.activeCustomUis.get(id);
    if (!custom || typeof data !== "string") return;
    try {
      custom.component.handleInput?.(data);
      if (this.activeCustomUis.has(id)) this.emitCustomUiRender(id, custom);
    } catch (error) {
      this.closeCustomUi(id, undefined);
      this.emit({
        type: "extension_error",
        extensionPath: `custom-ui:${id}`,
        event: "custom_ui_input",
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  private requestExtensionCustomUi<T>(factory: unknown, options?: unknown): Promise<T> {
    if (this.externalTurnActive) {
      this.emit({
        type: "channel_headless_ui_blocked",
        feature: "custom",
        errorMessage: "Interactive extension UI is unavailable for messaging-channel turns.",
      });
      return Promise.resolve(undefined as T);
    }
    if (typeof factory !== "function") return Promise.resolve(undefined as T);

    const id = randomUUID();
    const width = this.getCustomUiWidth(options);

    return new Promise<T>((resolve) => {
      const tui = {
        requestRender: () => {
          const custom = this.activeCustomUis.get(id);
          if (custom) this.emitCustomUiRender(id, custom);
        },
      };
      const done = (value: T) => this.closeCustomUi(id, value);

      Promise.resolve()
        .then(() => factory(tui, undefined, undefined, done))
        .then((component) => {
          if (
            !component ||
            typeof component !== "object" ||
            typeof (component as CustomUiComponent).render !== "function"
          ) {
            resolve(undefined as T);
            return;
          }
          const custom: ActiveCustomUi = {
            component: component as CustomUiComponent,
            width,
            resolve: (value) => resolve(value as T),
            settled: false,
          };
          this.activeCustomUis.set(id, custom);
          this.emitCustomUiRender(id, custom);
        })
        .catch((error) => {
          this.emit({
            type: "extension_error",
            extensionPath: `custom-ui:${id}`,
            event: "custom_ui",
            error: error instanceof Error ? error.message : String(error),
          });
          resolve(undefined as T);
        });
    });
  }

  private requestExtensionUi<T>(
    request: ExtensionUiRequestBody,
    defaultValue: T,
    parseResponse: (response: ExtensionUiResponse) => T,
    timeout?: number,
    signal?: AbortSignal,
  ): Promise<T> {
    if (this.externalTurnActive) {
      this.emit({
        type: "channel_headless_ui_blocked",
        feature: request.method,
        errorMessage: "Interactive extension UI is unavailable for messaging-channel turns.",
      });
      return Promise.resolve(defaultValue);
    }
    if (signal?.aborted) return Promise.resolve(defaultValue);

    const id = randomUUID();
    const fullRequest = {
      type: "extension_ui_request",
      id,
      ...request,
      ...(timeout ? { timeout, expiresAt: Date.now() + timeout } : {}),
    };

    return new Promise((resolve) => {
      let timeoutId: ReturnType<typeof setTimeout> | undefined;
      const cleanup = () => {
        if (timeoutId) clearTimeout(timeoutId);
        signal?.removeEventListener("abort", onAbort);
        this.pendingUiRequests.delete(id);
        this.pendingUiResponses.delete(id);
      };
      const settle = (value: T) => {
        cleanup();
        resolve(value);
      };
      const onAbort = () => settle(defaultValue);

      if (timeout) timeoutId = setTimeout(() => settle(defaultValue), timeout);
      signal?.addEventListener("abort", onAbort, { once: true });

      this.pendingUiRequests.set(id, fullRequest as AgentEvent);
      this.pendingUiResponses.set(id, {
        resolve: (response) => settle(parseResponse(response)),
        cancel: () => settle(defaultValue),
      });
      this.emit(fullRequest as AgentEvent);
    });
  }

  private createExtensionUiContext(): ExtensionUiContextLike {
    return {
      select: (title, options, opts) =>
        this.requestExtensionUi(
          { method: "select", title, options, ...(opts?.timeout ? { timeout: opts.timeout } : {}) },
          undefined,
          (response) => ("value" in response ? response.value : undefined),
          opts?.timeout,
          opts?.signal,
        ),
      confirm: (title, message, opts) =>
        this.requestExtensionUi(
          { method: "confirm", title, message, ...(opts?.timeout ? { timeout: opts.timeout } : {}) },
          false,
          (response) => ("confirmed" in response ? response.confirmed : false),
          opts?.timeout,
          opts?.signal,
        ),
      input: (title, placeholder, opts) =>
        this.requestExtensionUi(
          {
            method: "input",
            title,
            ...(placeholder !== undefined ? { placeholder } : {}),
            ...(opts?.timeout ? { timeout: opts.timeout } : {}),
          },
          undefined,
          (response) => ("value" in response ? response.value : undefined),
          opts?.timeout,
          opts?.signal,
        ),
      editor: (title, prefill, opts) =>
        this.requestExtensionUi(
          {
            method: "editor",
            title,
            ...(prefill !== undefined ? { prefill } : {}),
            ...(opts?.timeout ? { timeout: opts.timeout } : {}),
          },
          undefined,
          (response) => ("value" in response ? response.value : undefined),
          opts?.timeout,
          opts?.signal,
        ),
      notify: (message, type) => {
        this.emit({
          type: "extension_ui_request",
          id: randomUUID(),
          method: "notify",
          message,
          notifyType: type,
        } as ExtensionUiRequest as AgentEvent);
      },
      onTerminalInput: () => {
        this.reportUnsupportedExtensionFeature("raw terminal input");
        return () => {};
      },
      setStatus: (key, text) => {
        this.setExtensionStatus(key, text);
      },
      setWorkingMessage: (message) => {
        this.extensionWorkingMessage = message?.trim() || "Working";
        this.syncExtensionWorkingStatus();
      },
      setWorkingVisible: (visible) => {
        this.extensionWorkingVisible = visible;
        this.syncExtensionWorkingStatus();
      },
      setWorkingIndicator: (options) => {
        const frame = options?.frames?.[0];
        if (options?.frames?.length === 0) this.extensionWorkingVisible = false;
        else {
          this.extensionWorkingVisible = true;
          this.extensionWorkingIndicator = frame ?? "";
        }
        this.syncExtensionWorkingStatus();
      },
      setHiddenThinkingLabel: (label) => {
        this.setExtensionStatus("hidden-thinking-label", label);
      },
      setWidget: (key, content, options) => {
        if (content !== undefined && !Array.isArray(content)) return;
        if (content === undefined) {
          this.extensionWidgets.delete(key);
        } else {
          this.extensionWidgets.set(key, {
            key,
            lines: content,
            placement: options?.placement ?? "aboveEditor",
          });
        }
        this.emit({
          type: "extension_ui_request",
          id: randomUUID(),
          method: "setWidget",
          widgetKey: key,
          widgetLines: content,
          widgetPlacement: options?.placement,
        } as ExtensionUiRequest as AgentEvent);
      },
      setFooter: () => this.reportUnsupportedExtensionFeature("custom TUI footer"),
      setHeader: () => this.reportUnsupportedExtensionFeature("custom TUI header"),
      setTitle: (title) => {
        this.emit({
          type: "extension_ui_request",
          id: randomUUID(),
          method: "setTitle",
          title,
        } as ExtensionUiRequest as AgentEvent);
      },
      custom: <T = unknown>(factory: unknown, options?: unknown) => this.requestExtensionCustomUi<T>(factory, options),
      pasteToEditor: (text) => {
        this.extensionEditorText += text;
        this.emit({
          type: "extension_ui_request",
          id: randomUUID(),
          method: "set_editor_text",
          text,
        } as ExtensionUiRequest as AgentEvent);
      },
      setEditorText: (text) => {
        this.extensionEditorText = text;
        this.emit({
          type: "extension_ui_request",
          id: randomUUID(),
          method: "set_editor_text",
          text,
        } as ExtensionUiRequest as AgentEvent);
      },
      getEditorText: () => this.extensionEditorText,
      addAutocompleteProvider: () => this.reportUnsupportedExtensionFeature("TUI autocomplete provider"),
      setEditorComponent: () => this.reportUnsupportedExtensionFeature("custom TUI editor component"),
      getEditorComponent: () => undefined,
      get theme() {
        return undefined;
      },
      getAllThemes: () => [],
      getTheme: () => undefined,
      setTheme: () => ({
        success: false,
        error: "Theme switching is not supported in the Pi Desktop extension UI yet",
      }),
      getToolsExpanded: () => false,
      setToolsExpanded: () => {},
    };
  }

  private createExtensionCommandContextActions(): ExtensionCommandContextActionsLike {
    return {
      waitForIdle: async () => {
        const agent = this.inner.agent as { waitForIdle?: () => Promise<void> };
        await agent.waitForIdle?.();
      },
      newSession: async () => {
        this.reportUnsupportedExtensionFeature("extension-driven session replacement");
        return { cancelled: true };
      },
      fork: async () => {
        this.reportUnsupportedExtensionFeature("extension-driven session fork");
        return { cancelled: true };
      },
      navigateTree: async (targetId, options) => {
        const result = await this.inner.navigateTree(targetId, { summarize: options?.summarize });
        return { cancelled: result.cancelled };
      },
      switchSession: async () => {
        this.reportUnsupportedExtensionFeature("extension-driven session switch");
        return { cancelled: true };
      },
      reload: async () => {
        this.extensionStatuses.clear();
        this.extensionWidgets.clear();
        await this.inner.reload({
          beforeSessionStart: () => {
            this.inner.extensionRunner.setUIContext?.(this.createExtensionUiContext(), "rpc");
          },
        });
      },
    };
  }
}

// ============================================================================
// Session registry
// ============================================================================

/** Last assistant text in the transcript, which is what the reviewer judges. */
function latestAssistantText(entries: readonly unknown[]): string {
  for (let index = entries.length - 1; index >= 0; index -= 1) {
    const entry = entries[index] as { type?: unknown; message?: { role?: unknown; content?: unknown } };
    const message = entry?.message;
    if (!message || message.role !== "assistant") continue;
    const content = message.content;
    if (typeof content === "string") return content;
    if (Array.isArray(content)) {
      const text = content
        .map((block) =>
          block && typeof block === "object" && (block as { type?: unknown }).type === "text"
            ? ((block as { text?: unknown }).text ?? "")
            : "",
        )
        .filter((part): part is string => typeof part === "string" && part.length > 0)
        .join("\n");
      if (text) return text;
    }
  }
  return "";
}
