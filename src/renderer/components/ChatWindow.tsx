import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import type {
  AgentMessage,
  AssistantContentBlock,
  AssistantMessage,
  SessionInfo,
  SessionTreeNode,
  ToolResultMessage,
} from "@/lib/types";
import {
  countToolCallBlocks,
  getDisplayableAssistantBlocks,
  isAssistantFailure,
  splitFinalAssistantBlocks,
} from "@/lib/message-display";
import { ComposerScmBar } from "./ComposerScmBar";
import { ContextMapPanel } from "./ContextMapPanel";
import { SessionTodoStrip } from "./SessionTodoStrip";
import { WorktreeSwitcher } from "./session-sidebar/WorktreeSwitcher";
import type { WorktreesController } from "./session-sidebar/useWorktrees";
import { ChatNavigator, type ChatNavigatorQuestion } from "./ChatNavigator";
import { FoldedHistoryRow } from "./FoldedHistoryRow";
import { ChatTodoBlock } from "./ChatTodoBlock";
import { RunningSubagentsBar } from "./RunningSubagentsBar";
import { GoalBar } from "./GoalBar";
import { MessageView } from "./MessageView";
import { SessionProfiler } from "./SessionProfiler";
import { ExtensionCustomPanel } from "./chat/ExtensionCustomPanel";
import { ExtensionDialog } from "./chat/ExtensionDialog";
import { ExtensionStatusBar } from "./chat/ExtensionStatusBar";
import { ExtensionWidgets } from "./chat/ExtensionWidgets";
import { NoticeShelf } from "./chat/NoticeShelf";
import { ProcessDetailsGroup } from "./chat/ProcessDetailsGroup";
import { ChatInput, type ChatInputHandle } from "./ChatInput";
import { useAgentSession, type AgentPhase } from "@/hooks/useAgentSession";
import { useAudio } from "@/hooks/useAudio";
import { useDragDrop } from "@/hooks/useDragDrop";
import { useIsMobile } from "@/hooks/useIsMobile";
import type { SessionStatsInfo } from "@/lib/pi-types";
import { useI18n } from "@/i18n";

interface Props {
  session: SessionInfo | null;
  newSessionCwd: string | null;
  onAgentEnd?: () => void;
  onSessionCreated?: (session: SessionInfo) => void;
  onSessionForked?: (newSessionId: string) => void;
  modelsRefreshKey?: number;
  chatInputRef?: React.RefObject<ChatInputHandle | null>;
  /** Shared with the sidebar so both render the same worktree switcher. */
  worktrees?: WorktreesController;
  homeDir?: string;
  onBranchDataChange?: (
    tree: SessionTreeNode[],
    activeLeafId: string | null,
    onLeafChange: (leafId: string | null) => void,
  ) => void;
  onSystemPromptChange?: (prompt: string | null) => void;
  onSessionStatsChange?: (stats: SessionStatsInfo | null) => void;
  onSessionStatsPanelOpen?: () => void;
  onContextUsageChange?: (
    usage: { percent: number | null; contextWindow: number; tokens: number | null } | null,
  ) => void;
  onOpenFile?: (filePath: string) => void;
}

function phaseLabel(phase: AgentPhase, t: (key: string, fallback: string) => string): string {
  if (phase?.kind === "running_tools") {
    const names = phase.tools.map((t) => t.name);
    const running = t("runningTools", "Running");
    if (names.length === 0) return t("runningTool", "Running tool…");
    if (names.length === 1) return `${running} ${names[0]}…`;
    if (names.length <= 3) return `${running} ${names.join(", ")}…`;
    return `${running} ${names.slice(0, 2).join(", ")} (+${names.length - 2})…`;
  }
  if (phase?.kind === "waiting_model") return t("waitingForModel", "Waiting for model…");
  if (phase?.kind === "running_command") return t("runningCommand", "Running command…");
  return t("thinking", "Thinking…");
}

/** Fold older turns only once a conversation is long enough to matter. */
const FOLD_HISTORY_MIN_MESSAGES = 50;
const FOLD_HISTORY_KEEP_RECENT = 16;

const CHAT_COLUMN_PADDING = 16;
const CHAT_INPUT_RIGHT_PADDING = CHAT_COLUMN_PADDING;

function hasFinalAssistantAnswer(message: AgentMessage): boolean {
  if (message.role !== "assistant") return false;
  if (isAssistantFailure(message as AssistantMessage)) return true;
  return splitFinalAssistantBlocks(message as AssistantMessage).answerBlocks.some(
    (block) => block.type === "image" || (block.type === "text" && block.text.trim().length > 0),
  );
}

function findFinalAssistantIndex(messages: AgentMessage[], userIdx: number, endIdx: number): number {
  for (let candidateIdx = endIdx - 1; candidateIdx > userIdx; candidateIdx--) {
    if (hasFinalAssistantAnswer(messages[candidateIdx])) return candidateIdx;
  }
  for (let candidateIdx = endIdx - 1; candidateIdx > userIdx; candidateIdx--) {
    if (messages[candidateIdx]?.role === "assistant") return candidateIdx;
  }
  return -1;
}

function countToolCalls(messages: AgentMessage[], indices: number[]): number {
  let count = 0;
  for (const idx of indices) {
    const msg = messages[idx];
    if (msg?.role !== "assistant") continue;
    count += countToolCallBlocks(getDisplayableAssistantBlocks(msg as AssistantMessage));
  }
  return count;
}

function hasDisplayableProcessMessage(message: AgentMessage): boolean {
  if (message.role === "assistant") {
    return getDisplayableAssistantBlocks(message as AssistantMessage).length > 0;
  }
  return message.role === "custom";
}

function withAssistantBlocks(
  message: AssistantMessage,
  content: AssistantContentBlock[],
  options: { omitUsage?: boolean; omitFailure?: boolean } = {},
): AssistantMessage {
  const next = { ...message, content };
  if (options.omitUsage) next.usage = undefined;
  if (options.omitFailure) {
    next.stopReason = undefined;
    next.errorMessage = undefined;
  }
  return next;
}

export function ChatWindow({
  session,
  newSessionCwd,
  onAgentEnd,
  onSessionCreated,
  onSessionForked,
  modelsRefreshKey,
  chatInputRef,
  onBranchDataChange,
  onSystemPromptChange,
  onSessionStatsChange,
  onSessionStatsPanelOpen,
  onContextUsageChange,
  onOpenFile,
  worktrees,
  homeDir = "",
}: Props) {
  const { soundEnabled, onSoundToggle, playDoneSound, unlockAudio } = useAudio();
  const isMobile = useIsMobile();
  const { t } = useI18n();

  // Wrap onAgentEnd to play the completion sound. This is more reliable than
  // wrapping handleAgentEventRef because useAgentSession overwrites that ref
  // on every render (it syncs the latest callback), which would blow away an
  // externally-installed wrapper after the first re-render.
  const playDoneSoundRef = useRef(playDoneSound);
  playDoneSoundRef.current = playDoneSound;
  const soundEnabledRef = useRef(soundEnabled);
  soundEnabledRef.current = soundEnabled;
  const wrappedOnAgentEnd = useCallback(() => {
    if (soundEnabledRef.current) {
      playDoneSoundRef.current();
    }
    onAgentEnd?.();
  }, [onAgentEnd]);

  const {
    loading,
    error,
    messages,
    entryIds,
    streamState,
    agentRunning,
    modelNames,
    modelList,
    modelCatalog,
    modelRefreshing,
    modelThinkingLevels,
    modelThinkingLevelMaps,
    toolPreset,
    thinkingLevel,
    retryInfo,
    contextUsage,
    forkingEntryId,
    isCompacting,
    compactError,
    compactResult,
    memoryMessages,
    displayModel: displayModelValue,
    sessionStats,
    slashCommands,
    slashCommandsLoading,
    queuedMessages,
    hasOlder,
    loadingOlder,
    notices,
    extensionDialog,
    extensionCustomUi,
    extensionStatuses,
    extensionWidgets,
    respondToExtensionUi,
    sendExtensionCustomInput,
    isAutoModelSelection,
    agentPhase,
    isNew,
    messagesEndRef,
    liveContentEndRef,
    scrollContainerRef,
    scrollToBottom,
    lastUserMsgRef,
    handleSend,
    handleAbort,
    handleFork,
    handleNavigate,
    handleModelChange,
    refreshModels,
    cancelModelRefresh,
    handleCompact,
    handleSteer,
    handleFollowUp,
    handlePromptWithStreamingBehavior,
    handleAbortCompaction,
    handleRecallQueue,
    handleRemoveQueued,
    handleRecallQueued,
    handleBuiltinSlashCommand,
    handleToolPresetChange,
    handleThinkingLevelChange,
    loadSlashCommands,
    loadOlder,
    loadDeferredContent,
  } = useAgentSession({
    session,
    newSessionCwd,
    onAgentEnd: wrappedOnAgentEnd,
    onSessionCreated,
    onSessionForked,
    modelsRefreshKey,
    chatInputRef,
    onBranchDataChange,
    onSystemPromptChange,
    onSessionStatsPanelOpen,
  });

  // Push session stats up to AppShell for the top bar.
  // Compare scalar fields to avoid loops from new object identity each render.
  const statsKey = sessionStats
    ? [
        sessionStats.sessionId,
        sessionStats.sessionFile ?? "",
        sessionStats.sessionName ?? "",
        sessionStats.userMessages,
        sessionStats.assistantMessages,
        sessionStats.toolCalls,
        sessionStats.toolResults,
        sessionStats.totalMessages,
        sessionStats.tokens.input,
        sessionStats.tokens.output,
        sessionStats.tokens.cacheRead,
        sessionStats.tokens.cacheWrite,
        sessionStats.tokens.total,
        sessionStats.cost ?? 0,
      ].join("|")
    : null;
  const sessionStatsRef = useRef(sessionStats);
  sessionStatsRef.current = sessionStats;
  useEffect(() => {
    onSessionStatsChange?.(sessionStatsRef.current);
  }, [statsKey, onSessionStatsChange]);
  useEffect(
    () => () => {
      onSessionStatsChange?.(null);
    },
    [onSessionStatsChange],
  );

  // Push context usage up to AppShell as well.
  const ctxKey = contextUsage
    ? `${contextUsage.percent ?? "null"}|${contextUsage.contextWindow}|${contextUsage.tokens ?? "null"}`
    : null;
  const contextUsageRef = useRef(contextUsage);
  contextUsageRef.current = contextUsage;
  useEffect(() => {
    onContextUsageChange?.(contextUsageRef.current);
  }, [ctxKey, onContextUsageChange]);
  useEffect(
    () => () => {
      onContextUsageChange?.(null);
    },
    [onContextUsageChange],
  );

  const onDrop = useCallback(
    (files: File[]) => {
      if (agentRunning) return;
      chatInputRef?.current?.addImages(files);
    },
    [agentRunning, chatInputRef],
  );

  const { isDragOver, handleDragEnter, handleDragOver, handleDragLeave, handleDrop } = useDragDrop(onDrop);

  const olderHistorySentinelRef = useRef<HTMLDivElement | null>(null);
  const automaticHistoryPagesRef = useRef(0);

  useEffect(() => {
    automaticHistoryPagesRef.current = 0;
  }, [session?.id]);

  useEffect(() => {
    const sentinel = olderHistorySentinelRef.current;
    const root = scrollContainerRef.current;
    if (!sentinel || !root || !hasOlder || loadingOlder) return;
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (!entry.isIntersecting || automaticHistoryPagesRef.current >= 3) return;
        automaticHistoryPagesRef.current += 1;
        void loadOlder();
      },
      { root, rootMargin: "160px 0px 0px" },
    );
    observer.observe(sentinel);
    return () => observer.disconnect();
  }, [hasOlder, loadOlder, loadingOlder, messages.length, scrollContainerRef]);

  const [contextMapOpen, setContextMapOpen] = useState(false);
  // The map reads host state on demand; re-reading after each turn keeps the
  // tiles honest without polling while the panel is closed.
  const contextMapRefreshKey = messages.length + entryIds.length;

  // Long conversations open at the end: everything but the last few turns is one
  // summary row until you expand it. Nothing folded is rendered, so the cost of a
  // 500-message session is the same as a short one.
  const [historyExpanded, setHistoryExpanded] = useState(false);
  const foldCount =
    !historyExpanded && messages.length > FOLD_HISTORY_MIN_MESSAGES
      ? Math.max(0, messages.length - FOLD_HISTORY_KEEP_RECENT)
      : 0;
  const foldedSummary = useMemo(() => {
    const folded = messages.slice(0, foldCount);
    let thinking = 0;
    let tools = 0;
    let images = 0;
    let preview = "";
    for (const message of folded) {
      const content = (message as { content?: unknown }).content;
      if (!Array.isArray(content)) {
        if (typeof content === "string" && !preview) preview = content.split("\n")[0].slice(0, 96);
        continue;
      }
      for (const block of content) {
        const typed = block as { type?: string; text?: string };
        if (typed.type === "thinking") thinking += 1;
        if (typed.type === "tool_use" || typed.type === "tool-call") tools += 1;
        if (typed.type === "image") images += 1;
        if (typed.type === "text" && typed.text && !preview) preview = typed.text.split("\n")[0].slice(0, 96);
      }
    }
    return { thinking, tools, images, preview };
  }, [foldCount, messages]);

  // Questions for the jump rail: user turns that actually carry text.
  const questionTextOf = (message: AgentMessage): string => {
    const content = (message as { content?: unknown }).content;
    if (typeof content === "string") return content;
    if (!Array.isArray(content)) return "";
    return content
      .map((block) => {
        if (typeof block === "string") return block;
        const typed = block as { type?: string; text?: string };
        return typed.type === "text" && typeof typed.text === "string" ? typed.text : "";
      })
      .filter(Boolean)
      .join("\n");
  };

  const navigatorQuestions = useMemo<ChatNavigatorQuestion[]>(
    () =>
      messages
        .map((message, index) => ({ message, index }))
        .filter(({ message }) => message.role === "user" && questionTextOf(message).trim().length > 0)
        .map(({ message, index }) => ({
          index,
          text: questionTextOf(message).trim().split("\n")[0].slice(0, 80),
        })),
    [messages],
  );

  const isEmptyNew = isNew && messages.length === 0 && !streamState.isStreaming && !agentRunning;
  const messageCwd = session?.cwd ?? newSessionCwd ?? undefined;

  const availableThinkingLevels = displayModelValue
    ? (modelThinkingLevels[`${displayModelValue.provider}:${displayModelValue.modelId}`] ?? null)
    : null;

  const currentThinkingLevelMap = displayModelValue
    ? (modelThinkingLevelMaps[`${displayModelValue.provider}:${displayModelValue.modelId}`] ?? null)
    : null;

  // Conversation-scoped controls, kept directly above the composer: the todos
  // this session created, and the repository it is working in.
  const composerExtras = (
    <div
      style={{
        padding: `0 ${CHAT_COLUMN_PADDING}px`,
        paddingRight: isMobile ? CHAT_COLUMN_PADDING : CHAT_INPUT_RIGHT_PADDING,
      }}
    >
      <SessionTodoStrip cwd={messageCwd ?? null} sessionId={session?.id ?? null} refreshKey={contextMapRefreshKey} />
      <RunningSubagentsBar />
      <GoalBar sessionId={session?.id ?? null} enabled={!isNew} />
      <ComposerScmBar
        cwd={messageCwd ?? null}
        refreshKey={contextMapRefreshKey}
        worktrees={
          worktrees && messageCwd ? (
            <div style={{ width: 200, flexShrink: 0 }}>
              <WorktreeSwitcher {...worktrees} selectedCwd={messageCwd} homeDir={homeDir} openUpward />
            </div>
          ) : undefined
        }
      />
    </div>
  );

  const chatInputElement = (
    <ChatInput
      ref={chatInputRef}
      onSend={handleSend}
      onAbort={handleAbort}
      onSteer={agentRunning ? handleSteer : undefined}
      onFollowUp={agentRunning ? handleFollowUp : undefined}
      onPromptWithStreamingBehavior={agentRunning ? handlePromptWithStreamingBehavior : undefined}
      isStreaming={agentRunning}
      model={displayModelValue}
      isAutoModelSelection={isAutoModelSelection}
      modelNames={modelNames}
      modelList={modelList}
      modelCatalog={modelCatalog}
      modelRefreshing={modelRefreshing}
      onModelChange={handleModelChange}
      onModelsRefresh={refreshModels}
      onModelsRefreshCancel={cancelModelRefresh}
      onCompactContext={session || isNew ? () => void handleCompact() : undefined}
      onShowContextMap={session || isNew ? () => setContextMapOpen(true) : undefined}
      onAbortCompaction={handleAbortCompaction}
      isCompacting={isCompacting}
      compactError={compactError}
      compactResult={compactResult}
      toolPreset={toolPreset}
      onToolPresetChange={session || isNew ? handleToolPresetChange : undefined}
      thinkingLevel={thinkingLevel}
      onThinkingLevelChange={session || isNew ? handleThinkingLevelChange : undefined}
      availableThinkingLevels={availableThinkingLevels}
      thinkingLevelMap={currentThinkingLevelMap}
      retryInfo={retryInfo}
      queuedMessages={queuedMessages}
      onRecallQueue={handleRecallQueue}
      onRemoveQueued={handleRemoveQueued}
      onRecallQueued={handleRecallQueued}
      slashCommands={slashCommands}
      slashCommandsLoading={slashCommandsLoading}
      onLoadSlashCommands={loadSlashCommands}
      onBuiltinCommand={handleBuiltinSlashCommand}
      soundEnabled={soundEnabled}
      onSoundToggle={onSoundToggle}
      onAudioUnlock={unlockAudio}
      draftKey={session?.id ?? (newSessionCwd ? `new:${newSessionCwd}` : undefined)}
      cwd={session?.cwd ?? newSessionCwd}
    />
  );

  const aboveEditorWidgets = extensionWidgets.filter((widget) => widget.placement !== "belowEditor");
  const belowEditorWidgets = extensionWidgets.filter((widget) => widget.placement === "belowEditor");

  if (loading) {
    return <div className="flex h-full items-center justify-center text-text-muted">Loading session...</div>;
  }

  if (error) {
    return <div className="flex h-full items-center justify-center text-red-400">{error}</div>;
  }

  return (
    <div
      className="relative flex h-full flex-col overflow-hidden"
      style={{ background: "var(--bg)" }}
      onDragEnter={handleDragEnter}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
    >
      {isDragOver && !agentRunning && (
        <div
          className="pointer-events-none absolute inset-0 z-50 flex animate-[drop-zone-in_0.15s_ease_both] items-center justify-center backdrop-blur-[1px]"
          style={{ background: "color-mix(in srgb, var(--accent) 6%, transparent)" }}
        >
          <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
            {[0, 0.8, 1.6].map((delay) => (
              <div
                key={delay}
                className="absolute h-[720px] w-[720px] rounded-full border-[1.5px] border-solid animate-[drop-ripple_2.4s_ease-out_infinite_backwards]"
                style={{
                  transformOrigin: "center",
                  animationDelay: `${delay}s`,
                  borderColor: "color-mix(in srgb, var(--accent) 50%, transparent)",
                }}
              />
            ))}
          </div>
          <svg
            width="280"
            height="280"
            viewBox="0 0 140 140"
            fill="none"
            xmlns="http://www.w3.org/2000/svg"
            style={{ filter: "drop-shadow(0 6px 18px color-mix(in srgb, var(--accent) 18%, transparent))" }}
          >
            <rect
              x="28"
              y="44"
              width="84"
              height="60"
              rx="8"
              fill="color-mix(in srgb, var(--accent) 8%, transparent)"
              stroke="color-mix(in srgb, var(--accent) 50%, transparent)"
              strokeWidth="1.8"
            />
            <path
              d="M36 100 L54 72 L68 88 L80 74 L104 100Z"
              fill="color-mix(in srgb, var(--accent) 16%, transparent)"
              stroke="color-mix(in srgb, var(--accent) 40%, transparent)"
              strokeWidth="1.4"
              strokeLinejoin="round"
            />
            <circle
              cx="96"
              cy="58"
              r="8"
              fill="color-mix(in srgb, var(--accent) 22%, transparent)"
              stroke="color-mix(in srgb, var(--accent) 55%, transparent)"
              strokeWidth="1.6"
            />
            <g stroke="color-mix(in srgb, var(--accent) 45%, transparent)" strokeWidth="1.4" strokeLinecap="round">
              <line x1="96" y1="46" x2="96" y2="43" />
              <line x1="96" y1="70" x2="96" y2="73" />
              <line x1="84" y1="58" x2="81" y2="58" />
              <line x1="108" y1="58" x2="111" y2="58" />
              <line x1="87.5" y1="49.5" x2="85.4" y2="47.4" />
              <line x1="104.5" y1="66.5" x2="106.6" y2="68.6" />
              <line x1="104.5" y1="49.5" x2="106.6" y2="47.4" />
              <line x1="87.5" y1="66.5" x2="85.4" y2="68.6" />
            </g>
          </svg>
        </div>
      )}

      {contextMapOpen && (
        <ContextMapPanel
          sessionId={sessionStats?.sessionId ?? session?.id ?? null}
          refreshKey={contextMapRefreshKey}
          onClose={() => setContextMapOpen(false)}
        />
      )}

      {extensionDialog && <ExtensionDialog request={extensionDialog} onRespond={respondToExtensionUi} />}

      {extensionCustomUi && <ExtensionCustomPanel request={extensionCustomUi} onInput={sendExtensionCustomInput} />}

      {isEmptyNew ? (
        <div className="relative z-[1] flex min-h-0 flex-[1_1_0] flex-col items-center justify-end overflow-y-auto px-4 pt-8">
          <div className="w-full" style={{ maxWidth: "var(--chat-content-max-width)" }}>
            <div
              className="mb-3"
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                marginLeft: 16,
                marginRight: 52,
                fontFamily: "var(--font-mono)",
              }}
            >
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 10,
                  lineHeight: 1.4,
                }}
              >
                <span
                  style={{
                    width: 28,
                    height: 28,
                    borderRadius: "var(--radius-sm)",
                    background: "var(--text)",
                    display: "inline-flex",
                    alignItems: "center",
                    justifyContent: "center",
                    fontSize: 14,
                    fontWeight: 700,
                    color: "var(--accent)",
                    flexShrink: 0,
                  }}
                >
                  $
                </span>
                <span
                  style={{
                    fontSize: 22,
                    color: "var(--text)",
                    fontWeight: 700,
                    letterSpacing: "-0.2px",
                    flexShrink: 0,
                    whiteSpace: "nowrap",
                  }}
                >
                  Pi Worktable
                </span>
              </div>
            </div>
            <NoticeShelf notices={notices} align="right" />
          </div>
        </div>
      ) : (
        <>
          <div className="chat-conversation-enter relative z-[1] flex min-h-0 flex-[1_1_0] overflow-hidden">
            <div
              style={{
                position: "absolute",
                top: 12,
                left: 0,
                right: 0,
                zIndex: 40,
                padding: `0 ${CHAT_COLUMN_PADDING}px`,
                pointerEvents: "none",
              }}
            >
              <div style={{ maxWidth: "var(--chat-content-max-width)", margin: "0 auto" }}>
                <NoticeShelf notices={notices} floating align="right" />
              </div>
            </div>
            <ChatNavigator
              containerRef={scrollContainerRef}
              questions={navigatorQuestions}
              onJump={(index) => {
                const node = scrollContainerRef.current?.querySelector<HTMLElement>(
                  `[data-message-index="${String(index)}"]`,
                );
                node?.scrollIntoView({ behavior: "smooth", block: "start" });
              }}
              onBottom={() => {
                scrollToBottom("smooth");
              }}
            />
            <div ref={scrollContainerRef} className="relative z-[1] flex-1 overflow-y-auto pt-4 [scrollbar-width:none]">
              <div style={{ padding: `0 ${CHAT_COLUMN_PADDING}px` }}>
                <div style={{ maxWidth: "var(--chat-content-max-width)", margin: "0 auto" }}>
                  {(hasOlder || loadingOlder) && (
                    <div
                      ref={olderHistorySentinelRef}
                      style={{ display: "flex", justifyContent: "center", padding: 8 }}
                    >
                      <button
                        type="button"
                        disabled={loadingOlder}
                        onClick={() => void loadOlder()}
                        style={{
                          border: "1px solid var(--border)",
                          borderRadius: "var(--radius-sm)",
                          background: "var(--bg-panel)",
                          color: "var(--text-muted)",
                          cursor: loadingOlder ? "default" : "pointer",
                          fontSize: 11,
                          padding: "5px 10px",
                        }}
                      >
                        {loadingOlder ? "Loading earlier messages…" : "Load earlier messages"}
                      </button>
                    </div>
                  )}
                  <ExtensionStatusBar statuses={extensionStatuses} />
                  <ExtensionWidgets widgets={aboveEditorWidgets} />

                  {(() => {
                    const toolResultsMap = new Map<string, ToolResultMessage>();
                    for (const msg of messages) {
                      if (msg.role === "toolResult") {
                        toolResultsMap.set((msg as ToolResultMessage).toolCallId, msg as ToolResultMessage);
                      }
                    }

                    let lastUserIdx = -1;
                    for (let i = messages.length - 1; i >= 0; i--) {
                      if (messages[i].role === "user") {
                        lastUserIdx = i;
                        break;
                      }
                    }

                    const timestampAssistantIndices = new Set<number>();
                    let foundAssistantInTurn = false;
                    for (let i = messages.length - 1; i >= 0; i--) {
                      if (messages[i].role === "user") {
                        foundAssistantInTurn = false;
                      } else if (messages[i].role === "assistant" && !foundAssistantInTurn) {
                        timestampAssistantIndices.add(i);
                        foundAssistantInTurn = true;
                      }
                    }

                    const attachVisibleRef = (idx: number) => (el: HTMLDivElement | null) => {
                      if (idx === lastUserIdx) {
                        (lastUserMsgRef as { current: HTMLDivElement | null }).current = el;
                      }
                    };

                    const renderMessage = (
                      idx: number,
                      options: {
                        attachRef?: boolean;
                        keyPrefix?: string;
                        messageOverride?: AgentMessage;
                        showTimestamp?: boolean;
                      } = {},
                    ): ReactNode => {
                      const msg = options.messageOverride ?? messages[idx];
                      const prevAssistantEntryId =
                        msg.role === "user" && idx > 0 && messages[idx - 1].role === "assistant"
                          ? entryIds[idx - 1]
                          : undefined;
                      const isVisible = msg.role === "user" || msg.role === "assistant";
                      const keyPrefix = options.keyPrefix ?? "message";
                      let showTimestamp = false;
                      if (msg.role === "assistant") {
                        showTimestamp = timestampAssistantIndices.has(idx);
                        // Hide on the currently-streaming tail (the streaming bubble owns the live timestamp)
                        if (showTimestamp && streamState.isStreaming && idx === messages.length - 1) {
                          showTimestamp = false;
                        }
                      }
                      if (options.showTimestamp !== undefined) showTimestamp = options.showTimestamp;
                      const view = (
                        <SessionProfiler key={`${keyPrefix}-view-${idx}`} id="MessageView">
                          <MessageView
                            message={msg}
                            toolResults={toolResultsMap}
                            modelNames={modelNames}
                            cwd={messageCwd}
                            onOpenFile={onOpenFile}
                            entryId={entryIds[idx]}
                            onFork={
                              agentRunning || isNew || (idx === 0 && msg.role === "user") ? undefined : handleFork
                            }
                            forking={forkingEntryId === entryIds[idx]}
                            onNavigate={agentRunning ? undefined : handleNavigate}
                            prevAssistantEntryId={agentRunning ? undefined : prevAssistantEntryId}
                            onEditContent={(content) => chatInputRef?.current?.insertIfEmpty(content)}
                            onLoadDeferredContent={loadDeferredContent}
                            showTimestamp={showTimestamp}
                            prevTimestamp={
                              idx > 0
                                ? (messages[idx - 1] as AgentMessage & { timestamp?: number }).timestamp
                                : undefined
                            }
                          />
                        </SessionProfiler>
                      );
                      if (!isVisible || options.attachRef === false) return view;
                      return (
                        // data-message-index is the anchor the question rail jumps to.
                        <div key={`${keyPrefix}-${idx}`} ref={attachVisibleRef(idx)} data-message-index={idx}>
                          {view}
                        </div>
                      );
                    };

                    const rendered: ReactNode[] = [];
                    if (foldCount > 0) {
                      rendered.push(
                        <FoldedHistoryRow
                          key="folded-history"
                          messages={foldCount}
                          thinking={foldedSummary.thinking}
                          tools={foldedSummary.tools}
                          images={foldedSummary.images}
                          preview={foldedSummary.preview}
                          onExpand={() => setHistoryExpanded(true)}
                        />,
                      );
                    }
                    // Compaction summaries replace every older turn, so they stay
                    // pinned above the paginated history instead of being buried
                    // behind "load earlier messages".
                    const memoryNodes = memoryMessages.map((message, index) =>
                      renderMessage(-1, {
                        messageOverride: message,
                        keyPrefix: `memory-${index}`,
                        attachRef: false,
                      }),
                    );
                    for (let idx = foldCount; idx < messages.length;) {
                      const msg = messages[idx];
                      if (msg.role !== "user") {
                        rendered.push(renderMessage(idx));
                        idx += 1;
                        continue;
                      }

                      const userIdx = idx;
                      let endIdx = userIdx + 1;
                      while (endIdx < messages.length && messages[endIdx].role !== "user") endIdx += 1;

                      const finalAssistantIdx = findFinalAssistantIndex(messages, userIdx, endIdx);

                      if (finalAssistantIdx === -1) {
                        for (let renderIdx = userIdx; renderIdx < endIdx; renderIdx++) {
                          rendered.push(renderMessage(renderIdx));
                        }
                        idx = endIdx;
                        continue;
                      }

                      const isLiveTail =
                        (agentRunning || streamState.isStreaming) &&
                        endIdx === messages.length &&
                        userIdx === lastUserIdx;
                      if (isLiveTail) {
                        for (let renderIdx = userIdx; renderIdx < endIdx; renderIdx++) {
                          rendered.push(renderMessage(renderIdx));
                        }
                        idx = endIdx;
                        continue;
                      }

                      rendered.push(renderMessage(userIdx));

                      const processIndices: number[] = [];
                      for (let processIdx = userIdx + 1; processIdx < finalAssistantIdx; processIdx++) {
                        processIndices.push(processIdx);
                      }
                      const visibleProcessIndices = processIndices.filter((processIdx) =>
                        hasDisplayableProcessMessage(messages[processIdx]),
                      );
                      const finalAssistant = messages[finalAssistantIdx] as AssistantMessage;
                      const finalSplit = splitFinalAssistantBlocks(finalAssistant);
                      const finalProcessMessage =
                        finalSplit.processBlocks.length > 0
                          ? withAssistantBlocks(finalAssistant, finalSplit.processBlocks, {
                              omitUsage: true,
                              omitFailure: true,
                            })
                          : null;
                      const finalAnswerMessage =
                        finalSplit.answerBlocks.length > 0
                          ? withAssistantBlocks(finalAssistant, finalSplit.answerBlocks)
                          : isAssistantFailure(finalAssistant)
                            ? withAssistantBlocks(finalAssistant, [])
                            : null;

                      const processCount = visibleProcessIndices.length + (finalProcessMessage ? 1 : 0);
                      if (processCount > 0) {
                        const processGroup = (
                          <ProcessDetailsGroup
                            messageCount={processCount}
                            toolCallCount={
                              countToolCalls(messages, visibleProcessIndices) +
                              countToolCallBlocks(finalSplit.processBlocks)
                            }
                          >
                            {visibleProcessIndices.map((processIdx) =>
                              renderMessage(processIdx, { attachRef: false, keyPrefix: "process" }),
                            )}
                            {finalProcessMessage &&
                              renderMessage(finalAssistantIdx, {
                                attachRef: false,
                                keyPrefix: "process-final",
                                messageOverride: finalProcessMessage,
                                showTimestamp: false,
                              })}
                          </ProcessDetailsGroup>
                        );
                        rendered.push(<div key={`process-group-${userIdx}-${finalAssistantIdx}`}>{processGroup}</div>);
                      }

                      if (finalAnswerMessage) {
                        rendered.push(renderMessage(finalAssistantIdx, { messageOverride: finalAnswerMessage }));
                      }
                      for (let renderIdx = finalAssistantIdx + 1; renderIdx < endIdx; renderIdx++) {
                        rendered.push(renderMessage(renderIdx));
                      }
                      idx = endIdx;
                    }
                    return [...memoryNodes, ...rendered];
                  })()}

                  {streamState.isStreaming && streamState.streamingMessage && (
                    <SessionProfiler id="MessageView">
                      <MessageView
                        message={streamState.streamingMessage as AgentMessage}
                        isStreaming
                        modelNames={modelNames}
                        cwd={messageCwd}
                        onOpenFile={onOpenFile}
                      />
                    </SessionProfiler>
                  )}

                  {agentRunning && !streamState.streamingMessage && (
                    <div className="py-2 text-[13px] text-text-muted">
                      <span className="animate-[pulse_1.5s_infinite]">{phaseLabel(agentPhase, t)}</span>
                    </div>
                  )}

                  <div ref={liveContentEndRef} />

                  {agentRunning && (
                    <div
                      style={{ height: scrollContainerRef.current ? scrollContainerRef.current.clientHeight : "80vh" }}
                    />
                  )}

                  {/* pi TUI 风格：本会话的待办清单，跟着消息流走 */}
                  <ChatTodoBlock
                    cwd={messageCwd ?? null}
                    sessionId={session?.id ?? null}
                    refreshKey={contextMapRefreshKey}
                  />

                  <div ref={messagesEndRef} />
                </div>
              </div>
            </div>
          </div>
        </>
      )}

      <div
        className="chat-input-transition-dock relative z-[2] w-full flex-shrink-0 self-center"
        style={{ maxWidth: "var(--chat-content-max-width)" }}
        data-position={isEmptyNew ? "welcome" : "conversation"}
      >
        {composerExtras}
        {!isEmptyNew && belowEditorWidgets.length > 0 && (
          <div
            style={{
              padding: `0 ${CHAT_COLUMN_PADDING}px`,
              paddingRight: isMobile ? CHAT_COLUMN_PADDING : CHAT_INPUT_RIGHT_PADDING,
            }}
          >
            <ExtensionWidgets widgets={belowEditorWidgets} />
          </div>
        )}
        {chatInputElement}
      </div>

      <div className="chat-input-bottom-spacer" data-expanded={isEmptyNew ? "true" : "false"} aria-hidden="true" />
    </div>
  );
}
