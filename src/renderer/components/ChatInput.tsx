import React, {
  useRef,
  useState,
  useCallback,
  useEffect,
  useLayoutEffect,
  useImperativeHandle,
  forwardRef,
  KeyboardEvent,
} from "react";
import type {
  BuiltinSlashCommandResult,
  CompactResultInfo,
  QueuedMessages,
  SlashCommandInfo,
} from "@/hooks/useAgentSession";
import { clearDraft, getDraft, setDraft, type ChatDraftImage } from "@/lib/draft-store";
import {
  buildEntriesFromFiles,
  buildAtInsertText,
  extractAtQuery,
  filterFileEntries,
  type AtQueryMatch,
  type FileIndexEntry,
} from "@/lib/file-fuzzy";
import { AtMentionMenu } from "./AtMentionMenu";
import { ComposerSendCluster } from "./ComposerSendCluster";
import { ComposerSettingsControls } from "./ComposerSettingsControls";
import { ModelSelector } from "./ModelSelector";
import { SLASH_SOURCE_ORDER, SlashCommandPalette, type SlashCommandSource } from "./SlashCommandPalette";
import { useIsMobile } from "@/hooks/useIsMobile";
import { fileIndex as fetchFileIndex } from "@/lib/api-client";
import { useI18n } from "@/i18n";
import { useVoiceInput } from "@/hooks/useVoiceInput";
import { MAX_ATTACHED_IMAGES, shrinkImageFiles } from "@/lib/image-attachments";
import type { ModelCatalogStatus } from "@contract/types";

export interface AttachedImage {
  data: string; // base64, no prefix
  mimeType: string;
  previewUrl: string; // object URL for display
}

interface ModelOption {
  provider: string;
  modelId: string;
  name: string;
}

interface Props {
  onSend: (message: string, images?: AttachedImage[]) => void;
  onAbort: () => void;
  onSteer?: (message: string, images?: AttachedImage[]) => void;
  onFollowUp?: (message: string, images?: AttachedImage[]) => void;
  onPromptWithStreamingBehavior?: (message: string, behavior: "steer" | "followUp", images?: AttachedImage[]) => void;
  isStreaming: boolean;
  model?: { provider: string; modelId: string } | null;
  isAutoModelSelection?: boolean;
  modelNames?: Record<string, string>;
  modelList?: { id: string; name: string; provider: string }[];
  modelCatalog?: ModelCatalogStatus;
  modelRefreshing?: boolean;
  onModelChange?: (provider: string, modelId: string) => void;
  onModelsRefresh?: () => Promise<void> | void;
  onModelsRefreshCancel?: () => void;
  /** Plain context compaction (pi's own pass): frees the window, keeps history. */
  onCompactContext?: () => void;
  /** Open the context map: what the model is being sent, block by block. */
  onShowContextMap?: () => void;
  onAbortCompaction?: () => void;
  isCompacting?: boolean;
  compactError?: string | null;
  compactResult?: CompactResultInfo | null;
  /** Conversation (user/assistant) message count on the active branch. */
  conversationMessageCount?: number;
  /** How full the context window is, in percent. */
  toolPreset?: "none" | "default" | "full";
  onToolPresetChange?: (preset: "none" | "default" | "full") => void;
  thinkingLevel?: "auto" | "off" | "minimal" | "low" | "medium" | "high" | "xhigh";
  onThinkingLevelChange?: (level: "auto" | "off" | "minimal" | "low" | "medium" | "high" | "xhigh") => void;
  availableThinkingLevels?: string[] | null;
  thinkingLevelMap?: Record<string, string | null> | null;
  retryInfo?: { attempt: number; maxAttempts: number; errorMessage?: string } | null;
  queuedMessages?: QueuedMessages | null;
  onRecallQueue?: () => void;
  /** Remove one queued message; the rest keep their order and mode. */
  onRemoveQueued?: (kind: "steering" | "followUp", index: number) => void;
  /** Pull one queued message back into the box, leaving the rest queued. */
  onRecallQueued?: (kind: "steering" | "followUp", index: number) => void;
  slashCommands?: SlashCommandInfo[];
  slashCommandsLoading?: boolean;
  onLoadSlashCommands?: () => Promise<SlashCommandInfo[]> | SlashCommandInfo[];
  onBuiltinCommand?: (message: string) => Promise<BuiltinSlashCommandResult>;
  soundEnabled?: boolean;
  onSoundToggle?: () => void;
  onAudioUnlock?: () => void;
  draftKey?: string;
  /** Session working directory — enables the @ file autocomplete menu */
  cwd?: string | null;
}

export interface ChatInputHandle {
  insertText: (text: string) => void;
  insertIfEmpty: (text: string) => void;
  /** Append after whatever is typed; never replaces the draft. */
  appendText: (text: string) => void;
  prependText: (text: string) => void;
  addImages: (files: File[]) => void;
}

const COMPOSITION_END_ENTER_GRACE_MS = 100;
const MODEL_OPTION_COLLATOR = new Intl.Collator(undefined, { numeric: true, sensitivity: "base" });

function compareModelOptions(a: ModelOption, b: ModelOption): number {
  return (
    MODEL_OPTION_COLLATOR.compare(a.name || a.modelId, b.name || b.modelId) ||
    MODEL_OPTION_COLLATOR.compare(a.provider, b.provider) ||
    MODEL_OPTION_COLLATOR.compare(a.modelId, b.modelId)
  );
}

const THINKING_LEVELS = ["auto", "off", "minimal", "low", "medium", "high", "xhigh"] as const;

function formatTokenCount(tokens: number): string {
  if (tokens >= 1_000_000) return `${(tokens / 1_000_000).toFixed(1)}M`;
  if (tokens >= 1_000) return `${Math.round(tokens / 1_000)}k`;
  return tokens.toLocaleString();
}

type SlashCommandPaletteItem =
  | SlashCommandInfo
  | {
      name: string;
      description: string;
      source: "builtin";
    };

const BUILTIN_SLASH_COMMANDS: SlashCommandPaletteItem[] = [
  { name: "compact", description: "Compress context, optionally with instructions", source: "builtin" },
  { name: "reload", description: "Reload extensions, skills, prompts, and tools", source: "builtin" },
  { name: "name", description: "Set the session display name", source: "builtin" },
  { name: "session", description: "Show session message, token, and cost stats", source: "builtin" },
  { name: "copy", description: "Copy the last assistant message", source: "builtin" },
];

const SLASH_SOURCES: SlashCommandSource[] = ["builtin", "extension", "prompt", "skill"];

function slashMatchRank(command: SlashCommandPaletteItem, query: string): number {
  const name = command.name.toLowerCase();
  const description = command.description?.toLowerCase() ?? "";
  if (name === query) return 0;
  if (name.startsWith(query)) return 1;
  if (name.includes(query)) return 2;
  if (description.includes(query)) return 3;
  return 4;
}

function imageToDraftImage(image: AttachedImage): ChatDraftImage {
  return { data: image.data, mimeType: image.mimeType };
}

function draftImageToAttachedImage(image: ChatDraftImage): AttachedImage {
  return {
    ...image,
    previewUrl: `data:${image.mimeType};base64,${image.data}`,
  };
}

function revokeImagePreview(image: AttachedImage): void {
  if (image.previewUrl.startsWith("blob:")) {
    URL.revokeObjectURL(image.previewUrl);
  }
}

function QueuedMessageRow({
  kind,
  text,
  onRemove,
  onRecall,
}: {
  kind: "steer" | "follow-up";
  text: string;
  onRemove?: () => void;
  onRecall?: () => void;
}) {
  const { t } = useI18n();
  return (
    <div
      title={text}
      style={{
        display: "flex",
        alignItems: "center",
        gap: 8,
        padding: "3px 10px",
        fontSize: 12,
        color: "var(--text-muted)",
        minWidth: 0,
      }}
    >
      <span
        style={{
          flexShrink: 0,
          fontSize: 10,
          fontFamily: "var(--font-mono)",
          padding: "1px 7px",
          borderRadius: 999,
          border: `1px solid ${kind === "steer" ? "color-mix(in srgb, var(--accent) 45%, transparent)" : "var(--border)"}`,
          color: kind === "steer" ? "var(--accent)" : "var(--text-dim)",
        }}
      >
        {kind === "steer" ? t("steer", "Steer") : t("followUp", "Follow-up")}
      </span>
      <span style={{ flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
        {text}
      </span>
      {onRecall && (
        <button
          type="button"
          onClick={onRecall}
          title={t("recallToInput", "Recall to input")}
          aria-label={t("recallToInput", "Recall to input")}
          style={queuedRowButtonStyle}
        >
          ↩
        </button>
      )}
      {onRemove && (
        <button
          type="button"
          onClick={onRemove}
          title={t("removeQueued", "Remove from queue")}
          aria-label={t("removeQueued", "Remove from queue")}
          style={queuedRowButtonStyle}
        >
          ✕
        </button>
      )}
    </div>
  );
}

const queuedRowButtonStyle: React.CSSProperties = {
  flexShrink: 0,
  width: 20,
  height: 20,
  padding: 0,
  display: "inline-flex",
  alignItems: "center",
  justifyContent: "center",
  background: "transparent",
  border: "none",
  borderRadius: "var(--radius-sm)",
  color: "var(--text-dim)",
  cursor: "pointer",
  fontSize: 12,
  lineHeight: 1,
};

export const ChatInput = forwardRef<ChatInputHandle, Props>(function ChatInput(
  {
    onSend,
    onAbort,
    onSteer,
    onFollowUp,
    isStreaming,
    model,
    isAutoModelSelection,
    modelNames,
    modelList,
    modelCatalog,
    modelRefreshing,
    onModelChange,
    onModelsRefresh,
    onModelsRefreshCancel,
    onCompactContext,
    onShowContextMap,
    onAbortCompaction,
    isCompacting,
    compactError,
    compactResult,
    toolPreset,
    onToolPresetChange,
    thinkingLevel,
    onThinkingLevelChange,
    availableThinkingLevels,
    thinkingLevelMap,
    retryInfo,
    queuedMessages,
    onRemoveQueued,
    onRecallQueued,
    onRecallQueue,
    slashCommands,
    slashCommandsLoading,
    onLoadSlashCommands,
    onBuiltinCommand,
    soundEnabled,
    onSoundToggle,
    onAudioUnlock,
    onPromptWithStreamingBehavior,
    draftKey,
    cwd,
  }: Props,
  ref,
) {
  const isMobile = useIsMobile();
  const { t } = useI18n();
  const [value, setValue] = useState(() => (draftKey ? (getDraft(draftKey)?.value ?? "") : ""));
  const [modelDropdownOpen, setModelDropdownOpen] = useState(false);
  const [modelDropdownRect, setModelDropdownRect] = useState<{ top: number; left: number; width: number } | null>(null);
  const [toolDropdownOpen, setToolDropdownOpen] = useState(false);
  const [thinkingDropdownOpen, setThinkingDropdownOpen] = useState(false);
  const [attachedImages, setAttachedImages] = useState<AttachedImage[]>(() =>
    draftKey ? (getDraft(draftKey)?.images.map(draftImageToAttachedImage) ?? []) : [],
  );
  const [slashMenuOpen, setSlashMenuOpen] = useState(false);
  const [slashActiveIndex, setSlashActiveIndex] = useState(0);
  const [atQuery, setAtQuery] = useState<AtQueryMatch | null>(null);
  const [atMenuOpen, setAtMenuOpen] = useState(false);
  const [atActiveIndex, setAtActiveIndex] = useState(0);
  const [fileIndex, setFileIndex] = useState<{ cwd: string; entries: FileIndexEntry[]; truncated: boolean } | null>(
    null,
  );
  const [fileIndexLoading, setFileIndexLoading] = useState(false);
  const [atServerResult, setAtServerResult] = useState<{
    cwd: string;
    query: string;
    matches: FileIndexEntry[];
  } | null>(null);

  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const modelButtonRef = useRef<HTMLButtonElement>(null);
  const modelDropdownPanelRef = useRef<HTMLDivElement>(null);
  const toolDropdownRef = useRef<HTMLDivElement>(null);
  const thinkingDropdownRef = useRef<HTMLDivElement>(null);
  const controlsMenuRef = useRef<HTMLDivElement>(null);
  const thinkingButtonRef = useRef<HTMLButtonElement>(null);
  const toolButtonRef = useRef<HTMLButtonElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const isComposingRef = useRef(false);
  const lastCompositionEndAtRef = useRef(0);
  const slashCommandsRequestedRef = useRef(false);
  const slashItemRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const atItemRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const fileIndexMetaRef = useRef<{ cwd: string; fetchedAt: number } | null>(null);
  const fileIndexFetchingRef = useRef<string | null>(null);
  const draftKeyRef = useRef(draftKey);
  const valueRef = useRef(value);
  const attachedImagesRef = useRef(attachedImages);
  valueRef.current = value;
  attachedImagesRef.current = attachedImages;

  useImperativeHandle(ref, () => ({
    insertIfEmpty(text: string) {
      const ta = textareaRef.current;
      const current = ta ? ta.value : value;
      if (current.trim()) return;
      setValue(text);
      setAtQuery(null);
      requestAnimationFrame(() => {
        if (!ta) return;
        ta.focus();
        ta.style.height = "auto";
        ta.style.height = `${Math.min(ta.scrollHeight, 200)}px`;
      });
    },
    appendText(text: string) {
      if (!text.trim()) return;
      const ta = textareaRef.current;
      const current = ta ? ta.value : value;
      const combined = [current, text].filter((part) => part.trim()).join("\n\n");
      setValue(combined);
      setAtQuery(null);
      requestAnimationFrame(() => {
        if (!ta) return;
        ta.focus();
        ta.style.height = "auto";
        ta.style.height = `${Math.min(ta.scrollHeight, 200)}px`;
        ta.setSelectionRange(ta.value.length, ta.value.length);
      });
    },
    prependText(text: string) {
      if (!text.trim()) return;
      const ta = textareaRef.current;
      const current = ta ? ta.value : value;
      // Mirrors the TUI's queue restore: queued text first, then whatever
      // the user already typed, separated by a blank line.
      const combined = [text, current].filter((t) => t.trim()).join("\n\n");
      setValue(combined);
      setAtQuery(null);
      requestAnimationFrame(() => {
        if (!ta) return;
        ta.focus();
        ta.setSelectionRange(combined.length, combined.length);
        ta.style.height = "auto";
        ta.style.height = `${Math.min(ta.scrollHeight, 200)}px`;
      });
    },
    insertText(text: string) {
      const ta = textareaRef.current;
      if (!ta) {
        setValue((v) => v + (v ? " " : "") + text);
        return;
      }
      const start = ta.selectionStart ?? ta.value.length;
      const end = ta.selectionEnd ?? ta.value.length;
      const before = ta.value.slice(0, start);
      const after = ta.value.slice(end);
      const sep = before.length > 0 && !before.endsWith(" ") ? " " : "";
      const newVal = before + sep + text + after;
      setValue(newVal);
      setAtQuery(null);
      requestAnimationFrame(() => {
        if (!ta) return;
        const pos = start + sep.length + text.length;
        ta.setSelectionRange(pos, pos);
        ta.focus();
        ta.style.height = "auto";
        ta.style.height = `${Math.min(ta.scrollHeight, 200)}px`;
      });
    },
    addImages(files: File[]) {
      void processImageFiles(files);
    },
  }));

  const processImageFiles = useCallback(
    async (files: File[]) => {
      if (isStreaming) return;
      const imageFiles = files.filter((f) => f.type.startsWith("image/"));
      if (!imageFiles.length) return;
      try {
        // Downscale before sending: a phone-sized photo is both expensive and often rejected.
        const shrunk = await shrinkImageFiles(imageFiles);
        setAttachedImages((prev) => [...prev, ...shrunk].slice(0, MAX_ATTACHED_IMAGES));
      } catch (error) {
        console.error("[pi-desktop] attaching an image failed:", error);
      }
    },
    [isStreaming],
  );

  const removeImage = useCallback((index: number) => {
    setAttachedImages((prev) => {
      const next = [...prev];
      const [removed] = next.splice(index, 1);
      if (removed) revokeImagePreview(removed);
      return next;
    });
  }, []);

  const clearImages = useCallback(() => {
    setAttachedImages((prev) => {
      prev.forEach(revokeImagePreview);
      return [];
    });
  }, []);

  const clearInput = useCallback(() => {
    setValue("");
    setAtQuery(null);
    if (draftKey) clearDraft(draftKey);
    if (draftKeyRef.current && draftKeyRef.current !== draftKey) clearDraft(draftKeyRef.current);
    clearImages();
    if (textareaRef.current) {
      textareaRef.current.style.height = "auto";
    }
  }, [clearImages, draftKey]);

  useEffect(() => {
    if (!draftKey || draftKeyRef.current !== draftKey) return;
    setDraft(draftKey, {
      value,
      images: attachedImages.map(imageToDraftImage),
    });
  }, [attachedImages, draftKey, value]);

  useEffect(() => {
    const previousDraftKey = draftKeyRef.current;
    if (previousDraftKey === draftKey) return;

    if (previousDraftKey) {
      setDraft(previousDraftKey, {
        value: valueRef.current,
        images: attachedImagesRef.current.map(imageToDraftImage),
      });
    }

    const draft = draftKey ? getDraft(draftKey) : null;
    draftKeyRef.current = draftKey;
    setValue(draft?.value ?? "");
    setAtQuery(null);
    setAttachedImages((prev) => {
      prev.forEach(revokeImagePreview);
      return draft?.images.map(draftImageToAttachedImage) ?? [];
    });
  }, [draftKey]);

  useEffect(() => {
    const ta = textareaRef.current;
    if (!ta) return;
    ta.style.height = "auto";
    if (value) ta.style.height = `${Math.min(ta.scrollHeight, 200)}px`;
  }, [value]);

  useEffect(() => {
    return () => {
      attachedImagesRef.current.forEach(revokeImagePreview);
    };
  }, []);

  // Voice input: record, transcribe in the host, append the text to the draft.
  const voice = useVoiceInput((text) => {
    setValue((current) => (current.trim() ? `${current.replace(/\s+$/, "")} ${text}` : text));
    textareaRef.current?.focus();
  });

  const handleSend = useCallback(async () => {
    const msg = value.trim();
    if (!msg && !attachedImages.length) return;
    if (isStreaming) return;
    onAudioUnlock?.();
    // ISSUE-006: snapshot draft before clear; restore on failure
    const snapshot = {
      value,
      images: attachedImages.map((img) => ({ ...img })),
    };
    if (!attachedImages.length && msg.startsWith("/") && onBuiltinCommand) {
      const result = await onBuiltinCommand(msg);
      if (result.handled) {
        if (!result.error) clearInput();
        return;
      }
    }
    try {
      const result = onSend(msg, attachedImages.length ? attachedImages : undefined) as
        void | Promise<unknown> | { ok?: boolean };
      const settled = result instanceof Promise ? await result : result;
      if (settled && typeof settled === "object" && "ok" in settled && settled.ok === false) {
        setValue(snapshot.value);
        setAttachedImages(snapshot.images);
        return;
      }
      clearInput();
    } catch {
      setValue(snapshot.value);
      setAttachedImages(snapshot.images);
    }
  }, [value, attachedImages, isStreaming, onBuiltinCommand, onSend, clearInput, onAudioUnlock]);

  const slashQuery = value.startsWith("/") && !/\s/.test(value.slice(1)) ? value.slice(1).toLowerCase() : null;

  const filteredSlashCommands = (() => {
    if (slashQuery === null) return [];
    const commands = [...(isStreaming ? [] : BUILTIN_SLASH_COMMANDS), ...(slashCommands ?? [])];
    return [...commands]
      .filter((command) => {
        const name = command.name.toLowerCase();
        const description = command.description?.toLowerCase() ?? "";
        return name.includes(slashQuery) || description.includes(slashQuery);
      })
      .sort((a, b) => {
        const rankDelta = slashMatchRank(a, slashQuery) - slashMatchRank(b, slashQuery);
        if (rankDelta !== 0) return rankDelta;
        return (
          SLASH_SOURCE_ORDER[a.source] - SLASH_SOURCE_ORDER[b.source] || MODEL_OPTION_COLLATOR.compare(a.name, b.name)
        );
      });
  })();

  const groupedSlashCommands = (() => {
    const groups = new Map<
      SlashCommandSource,
      { source: SlashCommandSource; items: { command: SlashCommandPaletteItem; index: number }[] }
    >();
    for (const source of SLASH_SOURCES) {
      groups.set(source, { source, items: [] });
    }
    filteredSlashCommands.forEach((command, index) => {
      groups.get(command.source)?.items.push({ command, index });
    });
    return SLASH_SOURCES.map((source) => groups.get(source)!).filter((group) => group.items.length > 0);
  })();

  const slashCommandCountLabel =
    filteredSlashCommands.length === 1
      ? slashQuery
        ? "1 match"
        : "1 command"
      : `${filteredSlashCommands.length} ${slashQuery ? "matches" : "commands"}`;
  const hasInputText = Boolean(value.trim());
  const canQueueStreamingMessage = hasInputText && attachedImages.length === 0;

  // ── @ file autocomplete ──────────────────────────────────────────────────
  // Recomputed from the text before the caret on every change/caret move.
  // Disabled entirely when there is no cwd (new session without a directory).
  const updateAtQuery = useCallback(
    (text: string, cursor: number | null) => {
      if (!cwd) {
        setAtQuery(null);
        return;
      }
      const pos = cursor ?? text.length;
      setAtQuery(extractAtQuery(text.slice(0, pos)));
    },
    [cwd],
  );

  const atQueryText = atQuery?.query ?? null;
  const atLocalMatches: FileIndexEntry[] = React.useMemo(
    () =>
      atQueryText !== null && fileIndex && fileIndex.cwd === cwd
        ? filterFileEntries(fileIndex.entries, atQueryText)
        : [],
    [atQueryText, fileIndex, cwd],
  );

  // When the client index is truncated (repo larger than the index cap),
  // local filtering cannot see deep files, so queries are also ranked
  // server-side against the full listing. Local matches render immediately
  // and are replaced when the (debounced) server result for the current
  // query arrives; stale responses are ignored via the query/cwd tag.
  const needsServerSearch = Boolean(atQueryText && fileIndex?.truncated && fileIndex.cwd === cwd);
  useEffect(() => {
    if (!needsServerSearch || !cwd || !atQueryText) return;
    const fetchCwd = cwd;
    const query = atQueryText;
    const timer = setTimeout(() => {
      void fetchFileIndex(fetchCwd, query)
        .then((data) => setAtServerResult({ cwd: fetchCwd, query, matches: (data.matches ?? []) as FileIndexEntry[] }))
        .catch(() => {
          // Keep showing local matches; the next keystroke retries.
        });
    }, 150);
    return () => clearTimeout(timer);
  }, [needsServerSearch, atQueryText, cwd]);

  const serverResultInUse =
    needsServerSearch && atServerResult !== null && atServerResult.cwd === cwd && atServerResult.query === atQueryText;
  const atMatches: FileIndexEntry[] = serverResultInUse ? atServerResult.matches : atLocalMatches;

  // Open/reset the menu whenever the @token appears or changes (mirrors the
  // slash menu: Escape closes it, the next keystroke re-opens it).
  const atTokenKey = atQuery === null ? null : `${atQuery.start}:${atQuery.quoted ? 1 : 0}:${atQuery.query}`;
  useEffect(() => {
    if (atTokenKey === null) {
      setAtMenuOpen(false);
      setAtActiveIndex(0);
      return;
    }
    setAtMenuOpen(true);
    setAtActiveIndex(0);
  }, [atTokenKey]);

  // Fetch the file index when the menu opens. The server caches per cwd for
  // ~10s, so re-opening refreshes cheaply; while typing nothing refetches.
  const atTokenActive = atQuery !== null;
  useEffect(() => {
    if (!atTokenActive || !cwd) return;
    const meta = fileIndexMetaRef.current;
    if (meta && meta.cwd === cwd && Date.now() - meta.fetchedAt < 10_000) return;
    if (fileIndexFetchingRef.current === cwd) return;
    fileIndexFetchingRef.current = cwd;
    const fetchCwd = cwd;
    setFileIndexLoading(true);
    void fetchFileIndex(fetchCwd)
      .then((data) => {
        setFileIndex({ cwd: fetchCwd, entries: buildEntriesFromFiles(data.files ?? []), truncated: !!data.truncated });
        fileIndexMetaRef.current = { cwd: fetchCwd, fetchedAt: Date.now() };
      })
      .catch(() => {
        // Leave any previous index in place; next open retries.
        fileIndexMetaRef.current = null;
      })
      .finally(() => {
        fileIndexFetchingRef.current = null;
        setFileIndexLoading(false);
      });
  }, [atTokenActive, cwd]);

  const applyAtCompletion = useCallback(
    (entry: FileIndexEntry) => {
      if (!atQuery) return;
      const ta = textareaRef.current;
      const cursor = ta?.selectionStart ?? value.length;
      const before = value.slice(0, atQuery.start);
      let after = value.slice(cursor);
      // Completing inside a quoted token (@"my dir/… with the caret before the
      // closing quote): the replacement carries its own closing quote, so drop
      // the old one right after the caret (mirrors the TUI's applyCompletion).
      if (atQuery.quoted && after.startsWith('"')) {
        after = after.slice(1);
      }
      const insert = buildAtInsertText(entry.path, entry.isDir, atQuery.quoted);
      const newValue = before + insert.text + after;
      const newPos = before.length + insert.cursorOffset;
      setValue(newValue);
      // setValue alone does not fire onChange — re-derive the token here. Files
      // end with a space (token closes, menu hides); directories end with "/"
      // before the caret (token stays open for drill-down into the directory).
      setAtQuery(extractAtQuery(newValue.slice(0, newPos)));
      requestAnimationFrame(() => {
        const el = textareaRef.current;
        if (!el) return;
        el.focus();
        el.setSelectionRange(newPos, newPos);
        el.style.height = "auto";
        el.style.height = `${Math.min(el.scrollHeight, 200)}px`;
      });
    },
    [atQuery, value],
  );

  useEffect(() => {
    if (atActiveIndex >= atMatches.length) {
      setAtActiveIndex(Math.max(0, atMatches.length - 1));
    }
  }, [atMatches.length, atActiveIndex]);

  useEffect(() => {
    atItemRefs.current.length = atMatches.length;
  }, [atMatches.length]);

  useEffect(() => {
    if (!atMenuOpen) return;
    atItemRefs.current[atActiveIndex]?.scrollIntoView({ block: "nearest", inline: "nearest" });
  }, [atActiveIndex, atMenuOpen]);

  const applySlashCommand = useCallback((command: SlashCommandPaletteItem) => {
    const nextValue = `/${command.name} `;
    setValue(nextValue);
    setSlashMenuOpen(false);
    setSlashActiveIndex(0);
    requestAnimationFrame(() => {
      const ta = textareaRef.current;
      if (!ta) return;
      ta.focus();
      ta.setSelectionRange(nextValue.length, nextValue.length);
      ta.style.height = "auto";
      ta.style.height = `${Math.min(ta.scrollHeight, 200)}px`;
    });
  }, []);

  const sendQueued = useCallback(
    async (mode: "steer" | "followup") => {
      const msg = value.trim();
      if (!msg && !attachedImages.length) return;
      if (attachedImages.length) return;
      onAudioUnlock?.();
      const snapshot = value;
      const streamingBehavior = mode === "steer" ? "steer" : "followUp";
      try {
        if (msg.startsWith("/") && onPromptWithStreamingBehavior) {
          await Promise.resolve(onPromptWithStreamingBehavior(msg, streamingBehavior, undefined));
          clearInput();
          return;
        }
        if (mode === "steer" && onSteer) {
          await Promise.resolve(onSteer(msg, undefined));
        } else if (mode === "followup" && onFollowUp) {
          await Promise.resolve(onFollowUp(msg, undefined));
        }
        clearInput();
      } catch {
        setValue(snapshot);
      }
    },
    [value, attachedImages, onPromptWithStreamingBehavior, onSteer, onFollowUp, clearInput, onAudioUnlock],
  );

  const getNextSlashIndex = useCallback(
    (direction: "up" | "down" | "left" | "right") => {
      const lastIndex = filteredSlashCommands.length - 1;
      if (lastIndex < 0) return 0;

      if (direction === "left") return Math.max(0, slashActiveIndex - 1);
      if (direction === "right") return Math.min(lastIndex, slashActiveIndex + 1);

      const currentNode = slashItemRefs.current[slashActiveIndex];
      if (!currentNode) {
        return direction === "down" ? Math.min(lastIndex, slashActiveIndex + 1) : Math.max(0, slashActiveIndex - 1);
      }

      const currentRect = currentNode.getBoundingClientRect();
      const currentX = currentRect.left + currentRect.width / 2;
      const currentY = currentRect.top + currentRect.height / 2;
      let bestIndex = -1;
      let bestScore = Number.POSITIVE_INFINITY;

      for (let index = 0; index <= lastIndex; index += 1) {
        if (index === slashActiveIndex) continue;
        const node = slashItemRefs.current[index];
        if (!node) continue;
        const rect = node.getBoundingClientRect();
        const candidateY = rect.top + rect.height / 2;
        const verticalDelta = candidateY - currentY;
        if (direction === "down" ? verticalDelta <= 4 : verticalDelta >= -4) continue;

        const candidateX = rect.left + rect.width / 2;
        const score = Math.abs(verticalDelta) * 1000 + Math.abs(candidateX - currentX);
        if (score < bestScore) {
          bestIndex = index;
          bestScore = score;
        }
      }

      if (bestIndex >= 0) return bestIndex;
      return direction === "down" ? Math.min(lastIndex, slashActiveIndex + 1) : Math.max(0, slashActiveIndex - 1);
    },
    [filteredSlashCommands.length, slashActiveIndex],
  );

  const handleKeyDown = useCallback(
    (e: KeyboardEvent<HTMLTextAreaElement>) => {
      const nativeEvent = e.nativeEvent;
      const recentlyComposed = Date.now() - lastCompositionEndAtRef.current < COMPOSITION_END_ENTER_GRACE_MS;
      const isComposing = isComposingRef.current || nativeEvent.isComposing || nativeEvent.keyCode === 229;

      if (e.key === "Enter" && !e.shiftKey && (isComposing || recentlyComposed)) {
        if (recentlyComposed) e.preventDefault();
        return;
      }

      if (slashMenuOpen && slashQuery !== null) {
        if (e.key === "ArrowDown") {
          e.preventDefault();
          setSlashActiveIndex(getNextSlashIndex("down"));
          return;
        }
        if (e.key === "ArrowUp") {
          e.preventDefault();
          setSlashActiveIndex(getNextSlashIndex("up"));
          return;
        }
        if (e.key === "ArrowRight") {
          e.preventDefault();
          setSlashActiveIndex(getNextSlashIndex("right"));
          return;
        }
        if (e.key === "ArrowLeft") {
          e.preventDefault();
          setSlashActiveIndex(getNextSlashIndex("left"));
          return;
        }
        if (e.key === "Escape") {
          e.preventDefault();
          setSlashMenuOpen(false);
          return;
        }
        if ((e.key === "Tab" || (e.key === "Enter" && !e.shiftKey)) && filteredSlashCommands[slashActiveIndex]) {
          e.preventDefault();
          applySlashCommand(filteredSlashCommands[slashActiveIndex]);
          return;
        }
      }

      // @ file menu — skip while composing so IME candidate navigation
      // (arrows/Enter/Tab) is never intercepted.
      if (atMenuOpen && atQuery !== null && !isComposing) {
        if (e.key === "ArrowDown") {
          e.preventDefault();
          setAtActiveIndex((i) => Math.min(Math.max(0, atMatches.length - 1), i + 1));
          return;
        }
        if (e.key === "ArrowUp") {
          e.preventDefault();
          setAtActiveIndex((i) => Math.max(0, i - 1));
          return;
        }
        if (e.key === "Escape") {
          e.preventDefault();
          setAtMenuOpen(false);
          return;
        }
        if ((e.key === "Tab" || (e.key === "Enter" && !e.shiftKey)) && atMatches[atActiveIndex]) {
          e.preventDefault();
          applyAtCompletion(atMatches[atActiveIndex]);
          return;
        }
      }

      if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault();
        if (isStreaming && (onSteer || onFollowUp)) {
          // Default Enter sends as steer if available, else followup
          void sendQueued(onSteer ? "steer" : "followup");
        } else {
          void handleSend();
        }
      }
    },
    [
      isStreaming,
      onSteer,
      onFollowUp,
      slashMenuOpen,
      slashQuery,
      filteredSlashCommands,
      slashActiveIndex,
      applySlashCommand,
      sendQueued,
      handleSend,
      getNextSlashIndex,
      atMenuOpen,
      atQuery,
      atMatches,
      atActiveIndex,
      applyAtCompletion,
    ],
  );

  const handleInput = useCallback(() => {
    const ta = textareaRef.current;
    if (!ta) return;
    ta.style.height = "auto";
    ta.style.height = `${Math.min(ta.scrollHeight, 200)}px`;
  }, []);

  const handlePaste = useCallback(
    (e: React.ClipboardEvent) => {
      const items = Array.from(e.clipboardData?.items ?? []);
      const imageItems = items.filter((item) => item.type.startsWith("image/"));
      if (!imageItems.length) return;
      e.preventDefault();
      const files = imageItems.map((item) => item.getAsFile()).filter((f): f is File => f !== null);
      void processImageFiles(files);
    },
    [processImageFiles],
  );

  useEffect(() => {
    if (slashQuery === null) {
      setSlashMenuOpen(false);
      setSlashActiveIndex(0);
      slashCommandsRequestedRef.current = false;
      return;
    }
    setSlashMenuOpen(true);
    setSlashActiveIndex(0);
    if (!slashCommandsRequestedRef.current && onLoadSlashCommands) {
      slashCommandsRequestedRef.current = true;
      Promise.resolve(onLoadSlashCommands()).catch(() => {
        slashCommandsRequestedRef.current = false;
      });
    }
  }, [slashQuery, onLoadSlashCommands]);

  useEffect(() => {
    if (slashActiveIndex >= filteredSlashCommands.length) {
      setSlashActiveIndex(Math.max(0, filteredSlashCommands.length - 1));
    }
  }, [filteredSlashCommands.length, slashActiveIndex]);

  useEffect(() => {
    slashItemRefs.current.length = filteredSlashCommands.length;
  }, [filteredSlashCommands.length]);

  useEffect(() => {
    if (!slashMenuOpen) return;
    slashItemRefs.current[slashActiveIndex]?.scrollIntoView({ block: "nearest", inline: "nearest" });
  }, [slashActiveIndex, slashMenuOpen]);

  // Build model options: prefer modelList (has provider info), fallback to modelNames
  const modelOptions: ModelOption[] = (() => {
    if (modelList && modelList.length > 0) {
      return modelList.map((m) => ({ provider: m.provider, modelId: m.id, name: m.name })).sort(compareModelOptions);
    }
    return Object.entries(modelNames ?? {})
      .map(([modelId, name]) => ({
        provider: model?.provider ?? "unknown",
        modelId,
        name,
      }))
      .sort(compareModelOptions);
  })();

  // Group options by provider, preserving insertion order
  const modelsByProvider: { provider: string; options: ModelOption[] }[] = [];
  for (const opt of modelOptions) {
    const group = modelsByProvider.find((g) => g.provider === opt.provider);
    if (group) group.options.push(opt);
    else modelsByProvider.push({ provider: opt.provider, options: [opt] });
  }

  const displayModelName = model
    ? (modelOptions.find((o) => o.modelId === model.modelId && o.provider === model.provider)?.name ?? model.modelId)
    : null;
  const currentName = displayModelName;

  const compactSavedTokens = compactResult
    ? Math.max(0, compactResult.tokensBefore - compactResult.estimatedTokensAfter)
    : 0;
  const compactVerb =
    compactResult?.reason && compactResult.reason !== "manual"
      ? `${compactResult.reason[0].toUpperCase()}${compactResult.reason.slice(1)} compacted`
      : "Compacted";
  const compactResultText = compactResult
    ? `${compactVerb} ${formatTokenCount(compactResult.tokensBefore)} -> ${formatTokenCount(compactResult.estimatedTokensAfter)} tokens (${formatTokenCount(compactSavedTokens)} saved)`
    : null;
  const isContextCompacting = Boolean(isCompacting);
  // A compaction can take a while; counting the seconds is the only feedback
  // available until it ends.
  const [compactElapsedSeconds, setCompactElapsedSeconds] = useState(0);
  useEffect(() => {
    if (!isContextCompacting) {
      setCompactElapsedSeconds(0);
      return;
    }
    const started = Date.now();
    const timer = setInterval(() => {
      setCompactElapsedSeconds(Math.floor((Date.now() - started) / 1000));
    }, 1000);
    return () => {
      clearInterval(timer);
    };
  }, [isContextCompacting]);
  const contextCompactDisabled = isStreaming && !isContextCompacting;
  const thinkingLabels: Record<(typeof THINKING_LEVELS)[number], string> = {
    auto: t("thinkingAuto", "Auto"),
    off: t("thinkingOff", "Off"),
    minimal: t("thinkingMinimal", "Minimal"),
    low: t("thinkingLow", "Low"),
    medium: t("thinkingMedium", "Medium"),
    high: t("thinkingHigh", "High"),
    xhigh: t("thinkingXHigh", "Extra high"),
  };
  const translateThinkingValue = (value: string): string => {
    return (THINKING_LEVELS as readonly string[]).includes(value)
      ? thinkingLabels[value as (typeof THINKING_LEVELS)[number]]
      : value;
  };
  const thinkingDisplayLabel = (() => {
    const lvl = thinkingLevel ?? "auto";
    if (lvl === "auto" || !thinkingLevelMap) return thinkingLabels[lvl];
    return translateThinkingValue(thinkingLevelMap[lvl] ?? lvl);
  })();
  const closeControlDropdowns = useCallback(() => {
    setThinkingDropdownOpen(false);
    setToolDropdownOpen(false);
  }, []);

  const updateModelDropdownRect = useCallback(() => {
    const button = modelButtonRef.current;
    if (!button) return;
    const rect = button.getBoundingClientRect();
    const next = { top: rect.top, left: rect.left, width: rect.width };
    setModelDropdownRect((previous) =>
      previous && previous.top === next.top && previous.left === next.left && previous.width === next.width
        ? previous
        : next,
    );
  }, []);

  // Close dropdowns on outside click
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (
        dropdownRef.current &&
        !dropdownRef.current.contains(e.target as Node) &&
        modelDropdownPanelRef.current &&
        !modelDropdownPanelRef.current.contains(e.target as Node)
      ) {
        setModelDropdownOpen(false);
      }
      if (toolDropdownRef.current && !toolDropdownRef.current.contains(e.target as Node)) {
        setToolDropdownOpen(false);
      }
      if (thinkingDropdownRef.current && !thinkingDropdownRef.current.contains(e.target as Node)) {
        setThinkingDropdownOpen(false);
      }
      if (controlsMenuRef.current && !controlsMenuRef.current.contains(e.target as Node)) {
        closeControlDropdowns();
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [closeControlDropdowns]);

  useEffect(() => {
    closeControlDropdowns();
  }, [closeControlDropdowns, isMobile, isStreaming]);

  const modelDropdownWasOpenRef = useRef(false);
  useEffect(() => {
    if (modelDropdownWasOpenRef.current && !modelDropdownOpen && modelRefreshing) onModelsRefreshCancel?.();
    modelDropdownWasOpenRef.current = modelDropdownOpen;
  }, [modelDropdownOpen, modelRefreshing, onModelsRefreshCancel]);

  useLayoutEffect(() => {
    if (!modelDropdownOpen) return;
    updateModelDropdownRect();

    const observer = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(() => updateModelDropdownRect());
    if (modelButtonRef.current) observer?.observe(modelButtonRef.current);
    if (dropdownRef.current?.parentElement) observer?.observe(dropdownRef.current.parentElement);

    const visualViewport = window.visualViewport;
    window.addEventListener("resize", updateModelDropdownRect);
    window.addEventListener("scroll", updateModelDropdownRect, true);
    visualViewport?.addEventListener("resize", updateModelDropdownRect);
    visualViewport?.addEventListener("scroll", updateModelDropdownRect);
    return () => {
      observer?.disconnect();
      window.removeEventListener("resize", updateModelDropdownRect);
      window.removeEventListener("scroll", updateModelDropdownRect, true);
      visualViewport?.removeEventListener("resize", updateModelDropdownRect);
      visualViewport?.removeEventListener("scroll", updateModelDropdownRect);
    };
  }, [modelDropdownOpen, updateModelDropdownRect]);

  useEffect(() => {
    if (!thinkingDropdownOpen && !toolDropdownOpen) return;
    const handleEscape = (event: globalThis.KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      event.stopPropagation();
      const restoreThinkingFocus = thinkingDropdownOpen;
      closeControlDropdowns();
      requestAnimationFrame(() => {
        if (restoreThinkingFocus) thinkingButtonRef.current?.focus();
        else toolButtonRef.current?.focus();
      });
    };
    document.addEventListener("keydown", handleEscape, true);
    return () => document.removeEventListener("keydown", handleEscape, true);
  }, [closeControlDropdowns, thinkingDropdownOpen, toolDropdownOpen]);

  return (
    <div
      style={{
        flexShrink: 0,
        background: "transparent",
        padding: "12px 16px",
        paddingRight: isMobile ? 16 : 52, // desktop: 16px base + 36px for ChatMinimap alignment
      }}
    >
      {/* Hidden file input */}
      <input
        ref={fileInputRef}
        type="file"
        accept="image/*"
        multiple
        disabled={isStreaming}
        style={{ display: "none" }}
        onChange={(e) => {
          const files = Array.from(e.target.files ?? []);
          void processImageFiles(files);
          e.target.value = "";
        }}
      />
      <div style={{ maxWidth: "var(--chat-content-max-width)", margin: "0 auto" }}>
        {/* Queued steering / follow-up messages (delivered by pi on upcoming turns) */}
        {(queuedMessages?.steering.length ?? 0) + (queuedMessages?.followUp.length ?? 0) > 0 && (
          <div
            style={{
              marginBottom: 8,
              border: "1px solid var(--border)",
              borderRadius: "var(--radius-sm)",
              background: "var(--bg-panel)",
              padding: "5px 0",
            }}
          >
            <div
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                gap: 8,
                padding: "2px 8px 4px 10px",
              }}
            >
              <span
                style={{
                  fontSize: 10,
                  fontFamily: "var(--font-mono)",
                  color: "var(--text-dim)",
                  textTransform: "uppercase",
                  letterSpacing: 0.4,
                }}
              >
                {t("queued", "Queued")} ·{" "}
                {(queuedMessages?.steering.length ?? 0) + (queuedMessages?.followUp.length ?? 0)}
              </span>
              {onRecallQueue && (
                <button
                  onClick={onRecallQueue}
                  title={t(
                    "recallQueueDescription",
                    "Remove all queued messages and put them back into the input box for editing",
                  )}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 6,
                    padding: "4px 12px",
                    fontSize: 12,
                    color: "var(--text)",
                    background: "transparent",
                    border: "1px solid var(--border)",
                    borderRadius: "var(--radius-sm)",
                    cursor: "pointer",
                    transition: "background 0.12s, border-color 0.12s",
                    whiteSpace: "nowrap",
                  }}
                  onMouseEnter={(e) => {
                    e.currentTarget.style.background = "var(--bg-hover)";
                    e.currentTarget.style.borderColor = "color-mix(in srgb, var(--accent) 45%, var(--border))";
                  }}
                  onMouseLeave={(e) => {
                    e.currentTarget.style.background = "transparent";
                    e.currentTarget.style.borderColor = "var(--border)";
                  }}
                >
                  <svg
                    width="13"
                    height="13"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  >
                    <polyline points="9 14 4 9 9 4" />
                    <path d="M20 20v-7a4 4 0 0 0-4-4H4" />
                  </svg>
                  {t("recallToInput", "Recall to input")}
                </button>
              )}
            </div>
            {queuedMessages?.steering.map((text, i) => (
              <QueuedMessageRow
                key={`steer-${i}`}
                kind="steer"
                text={text}
                onRemove={onRemoveQueued ? () => onRemoveQueued("steering", i) : undefined}
                onRecall={onRecallQueued ? () => onRecallQueued("steering", i) : undefined}
              />
            ))}
            {queuedMessages?.followUp.map((text, i) => (
              <QueuedMessageRow
                key={`followup-${i}`}
                kind="follow-up"
                text={text}
                onRemove={onRemoveQueued ? () => onRemoveQueued("followUp", i) : undefined}
                onRecall={onRecallQueued ? () => onRecallQueued("followUp", i) : undefined}
              />
            ))}
          </div>
        )}
        {/* Retry banner */}
        {retryInfo && (
          <div
            style={{
              marginBottom: 8,
              padding: "5px 10px",
              background: "var(--amber-soft)",
              border: "1px solid var(--amber-border)",
              borderRadius: "var(--radius-sm)",
              fontSize: 12,
              color: "var(--warning)",
              display: "flex",
              alignItems: "center",
              gap: 6,
            }}
          >
            <svg
              width="11"
              height="11"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
              style={{ flexShrink: 0 }}
            >
              <path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8" />
              <path d="M3 3v5h5" />
            </svg>
            {t("retrying", "Retrying")} ({retryInfo.attempt}/{retryInfo.maxAttempts})…
            {retryInfo.errorMessage && <span style={{ opacity: 0.7, marginLeft: 4 }}>— {retryInfo.errorMessage}</span>}
          </div>
        )}
        {compactResultText && (
          <div
            style={{
              marginBottom: 8,
              padding: "5px 10px",
              background: "color-mix(in srgb, var(--success) 10%, transparent)",
              border: "1px solid color-mix(in srgb, var(--success) 28%, transparent)",
              borderRadius: "var(--radius-sm)",
              fontSize: 12,
              color: "var(--success)",
              display: "flex",
              alignItems: "center",
              gap: 6,
            }}
          >
            <svg
              width="11"
              height="11"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
              style={{ flexShrink: 0 }}
            >
              <polyline points="20 6 9 17 4 12" />
            </svg>
            {compactResultText}
          </div>
        )}
        {/* Image previews */}
        {attachedImages.length > 0 && (
          <div style={{ display: "flex", gap: 6, marginBottom: 6, flexWrap: "wrap" }}>
            {attachedImages.map((img, i) => (
              <div key={i} style={{ position: "relative", flexShrink: 0 }}>
                <img
                  src={img.previewUrl}
                  alt=""
                  style={{
                    width: 56,
                    height: 56,
                    objectFit: "cover",
                    borderRadius: "var(--radius-sm)",
                    border: "1px solid var(--border)",
                    display: "block",
                  }}
                />
                <button
                  onClick={() => removeImage(i)}
                  style={{
                    position: "absolute",
                    top: -4,
                    right: -4,
                    width: 16,
                    height: 16,
                    borderRadius: "50%",
                    background: "var(--bg-panel)",
                    border: "1px solid var(--border)",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    cursor: "pointer",
                    padding: 0,
                    color: "var(--text-muted)",
                  }}
                >
                  <svg
                    width="8"
                    height="8"
                    viewBox="0 0 8 8"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="1.5"
                    strokeLinecap="round"
                  >
                    <line x1="1" y1="1" x2="7" y2="7" />
                    <line x1="7" y1="1" x2="1" y2="7" />
                  </svg>
                </button>
              </div>
            ))}
          </div>
        )}

        {/* Main input */}
        <div style={{ position: "relative" }}>
          {slashMenuOpen && slashQuery !== null && (
            <SlashCommandPalette
              loading={Boolean(slashCommandsLoading)}
              countLabel={slashCommandCountLabel}
              groups={groupedSlashCommands}
              isEmpty={filteredSlashCommands.length === 0}
              activeIndex={slashActiveIndex}
              onActiveIndexChange={setSlashActiveIndex}
              itemRefs={slashItemRefs}
              onPick={applySlashCommand}
            />
          )}
          {atMenuOpen && atQuery !== null && (
            <AtMentionMenu
              query={atQuery.query}
              matches={atMatches}
              loading={fileIndexLoading && (!fileIndex || fileIndex.cwd !== cwd)}
              truncated={Boolean(fileIndex?.truncated)}
              serverResultInUse={serverResultInUse}
              activeIndex={atActiveIndex}
              onActiveIndexChange={setAtActiveIndex}
              itemRefs={atItemRefs}
              onPick={applyAtCompletion}
            />
          )}
          <div className="composer-box" data-streaming={isStreaming && (onSteer || onFollowUp) ? "true" : undefined}>
            <div
              className="chat-composer-shell"
              style={{
                display: "flex",
                gap: 8,
                alignItems: "center",
              }}
            >
              <textarea
                ref={textareaRef}
                value={value}
                onChange={(e) => {
                  setValue(e.target.value);
                  updateAtQuery(e.target.value, e.target.selectionStart);
                }}
                onSelect={(e) => {
                  const el = e.currentTarget;
                  updateAtQuery(el.value, el.selectionStart);
                }}
                onKeyDown={handleKeyDown}
                onCompositionStart={() => {
                  isComposingRef.current = true;
                }}
                onCompositionEnd={(e) => {
                  isComposingRef.current = false;
                  lastCompositionEndAtRef.current = Date.now();
                  const el = e.currentTarget;
                  updateAtQuery(el.value, el.selectionStart);
                }}
                onInput={handleInput}
                onPaste={handlePaste}
                placeholder={
                  isStreaming && (onSteer || onFollowUp)
                    ? t("steerOrQueue", "Steer now / queue follow-up…")
                    : isStreaming
                      ? t("agentRunning", "Agent is running…")
                      : t("messagePlaceholder", "Message… Type / for commands, @ for files")
                }
                rows={1}
                style={{
                  flex: 1,
                  background: "none",
                  border: "none",
                  outline: "none",
                  resize: "none",
                  color: "var(--text)",
                  fontSize: 14,
                  lineHeight: 1.6,
                  fontFamily: "inherit",
                  minHeight: 24,
                  maxHeight: 200,
                  overflow: "auto",
                }}
              />
            </div>
            <div
              className="composer-tools"
              style={{
                display: isMobile ? "grid" : "flex",
                gridTemplateColumns: isMobile ? "minmax(0, 1fr) auto" : undefined,
                alignItems: "center",
                gap: 6,
                paddingTop: 6,
                borderTop: "1px solid var(--border-soft)",
              }}
            >
              {/* LEFT: attach + model selector (idle) or steer/followup toggle (streaming) */}
              <div
                style={{
                  flex: isMobile ? "1 1 auto" : "0 0 auto",
                  minWidth: 0,
                  display: "flex",
                  alignItems: "center",
                  gap: isMobile ? 2 : 6,
                }}
              >
                <button
                  onClick={() => fileInputRef.current?.click()}
                  disabled={isStreaming}
                  title={t("attachImage", "Attach image")}
                  style={{
                    flexShrink: 0,
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    width: 32,
                    height: 32,
                    padding: 0,
                    background: attachedImages.length ? "var(--accent-soft)" : "var(--control-chip-bg)",
                    border: "1px solid var(--control-chip-border)",
                    borderRadius: "var(--radius-md)",
                    color: attachedImages.length ? "var(--accent)" : "var(--control-chip-fg)",
                    cursor: isStreaming ? "not-allowed" : "pointer",
                    opacity: isStreaming ? 0.5 : 1,
                    transition: "background 0.12s, color 0.12s",
                  }}
                  onMouseEnter={(e) => {
                    if (isStreaming) return;
                    e.currentTarget.style.background = "var(--bg-hover)";
                    e.currentTarget.style.color = attachedImages.length ? "var(--accent)" : "var(--text)";
                  }}
                  onMouseLeave={(e) => {
                    e.currentTarget.style.background = attachedImages.length
                      ? "var(--accent-soft)"
                      : "var(--control-chip-bg)";
                    e.currentTarget.style.color = attachedImages.length ? "var(--accent)" : "var(--control-chip-fg)";
                  }}
                >
                  <svg
                    width="15"
                    height="15"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="1.8"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  >
                    <rect x="3" y="3" width="18" height="18" rx="2" ry="2" />
                    <circle cx="8.5" cy="8.5" r="1.5" />
                    <polyline points="21 15 16 10 5 21" />
                  </svg>
                </button>
                <ModelSelector
                  options={modelOptions}
                  byProvider={modelsByProvider}
                  currentName={currentName}
                  activeModel={model ?? null}
                  autoSelection={isAutoModelSelection === true}
                  open={modelDropdownOpen}
                  onToggle={() => {
                    updateModelDropdownRect();
                    setModelDropdownOpen((v) => !v);
                  }}
                  onClose={() => setModelDropdownOpen(false)}
                  onSelect={(provider, modelId) => onModelChange?.(provider, modelId)}
                  onRefresh={onModelsRefresh}
                  refreshing={modelRefreshing === true}
                  catalog={modelCatalog}
                  rect={modelDropdownRect}
                  containerRef={dropdownRef}
                  buttonRef={modelButtonRef}
                  panelRef={modelDropdownPanelRef}
                  isMobile={isMobile}
                  isStreaming={isStreaming}
                />
              </div>

              {/* spacer */}
              {!isMobile && <div style={{ flex: 1 }} />}

              {/* RIGHT: reasoning, permissions, compaction, sound, and the streaming stop action. */}
              <div
                ref={controlsMenuRef}
                style={{
                  flex: "0 0 auto",
                  display: "flex",
                  alignItems: "center",
                  gap: isMobile ? 2 : 6,
                  justifyContent: "flex-end",
                  position: "relative",
                  marginLeft: isMobile ? 0 : "auto",
                }}
              >
                <ComposerSettingsControls
                  isMobile={isMobile}
                  isStreaming={isStreaming}
                  onAbort={onAbort}
                  thinkingButtonRef={thinkingButtonRef}
                  thinkingDropdownRef={thinkingDropdownRef}
                  thinkingOpen={thinkingDropdownOpen}
                  thinkingDisplayLabel={thinkingDisplayLabel}
                  thinkingLevel={thinkingLevel}
                  thinkingLevelMap={thinkingLevelMap}
                  availableThinkingLevels={availableThinkingLevels}
                  onThinkingChange={onThinkingLevelChange}
                  toolButtonRef={toolButtonRef}
                  toolDropdownRef={toolDropdownRef}
                  toolOpen={toolDropdownOpen}
                  toolPreset={toolPreset}
                  onToolPresetChange={onToolPresetChange}
                  onToggleThinking={() => setThinkingDropdownOpen((v) => !v)}
                  onToggleTool={() => setToolDropdownOpen((v) => !v)}
                  onCloseDropdowns={closeControlDropdowns}
                  onShowContextMap={onShowContextMap}
                  onCompactContext={onCompactContext}
                  onAbortCompaction={onAbortCompaction}
                  isContextCompacting={isContextCompacting}
                  compactElapsedSeconds={compactElapsedSeconds}
                  compactError={compactError}
                  contextCompactDisabled={contextCompactDisabled}
                  onSoundToggle={onSoundToggle}
                  soundEnabled={soundEnabled}
                />
                <div style={{ display: "flex", alignItems: "center", gap: 6, flexShrink: 0 }}>
                  <ComposerSendCluster
                    onSteer={onSteer ? () => sendQueued("steer") : undefined}
                    onFollowUp={onFollowUp ? () => sendQueued("followup") : undefined}
                    canQueue={canQueueStreamingMessage}
                    voice={voice}
                    onSend={handleSend}
                    canSend={Boolean(value.trim()) || attachedImages.length > 0}
                    hasImages={attachedImages.length > 0}
                  />
                </div>
              </div>
            </div>
          </div>
        </div>

        {voice.error && (
          <div style={{ padding: "0 12px 8px", fontSize: 11, color: "var(--danger)" }} role="alert">
            {voice.error}
          </div>
        )}

        {/* Bottom bar: left | center (context) | right */}
      </div>
    </div>
  );
});
