import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { useI18n } from "@/i18n";
import {
  buildSections,
  clampSelection,
  flattenSections,
  moveSelection,
  SECTION_LABELS,
  type GlobalSearchAction,
  type GlobalSearchItem,
} from "../lib/global-search";
import { useGlobalSearchData } from "../hooks/useGlobalSearchData";

export interface GlobalSearchProps {
  open: boolean;
  onClose: () => void;
  /** Root whose files can be searched; null when no project is active. */
  fileRoot: string | null;
  projects: Array<{ root: string; label?: string }>;
  actions: GlobalSearchAction[];
  onSelect: (item: GlobalSearchItem) => void;
}

const KIND_ICONS: Record<GlobalSearchItem["kind"], string> = {
  session: "M4 5h16M4 10h16M4 15h10",
  transcript: "M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z",
  file: "M6 2h8l4 4v16H6zM14 2v4h4",
  project: "M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z",
  action: "M13 2 3 14h7l-1 8 10-12h-7z",
};

function KindIcon({ kind }: { kind: GlobalSearchItem["kind"] }) {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      style={{ flexShrink: 0, opacity: 0.75 }}
    >
      <path d={KIND_ICONS[kind]} />
    </svg>
  );
}

/**
 * One palette over everything you can jump to. Same shape as the reference UI:
 * a solid panel over the app, grouped results, arrow keys and Enter.
 */
export function GlobalSearch({ open, onClose, fileRoot, projects, actions, onSelect }: GlobalSearchProps) {
  const { t } = useI18n();
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const { sessions, files, transcriptHits, searchFiles, searchTranscripts } = useGlobalSearchData({ open, fileRoot });

  const actionLabels = useMemo<Record<string, string>>(
    () => ({
      "new-session": t("newSession", "New session"),
      "settings-general": t("settingsGeneral", "Settings · General"),
      "settings-models": t("models", "Models"),
      "settings-agents": t("agents", "Agents"),
      "settings-mcp": t("mcpServers", "MCP servers"),
      "panel-files": t("files", "Files"),
      "panel-git": t("git", "Git"),
      "panel-tasks": t("tasks", "Tasks"),
      "panel-memory": t("memory", "Memory"),
      "toggle-theme": t("toggleTheme", "Toggle theme"),
      "context-map": t("contextMap", "Context map"),
    }),
    [t],
  );

  const sections = useMemo(
    () => buildSections({ sessions, transcriptHits, files, projects, actions, actionLabels, query, fileRoot }),
    [sessions, transcriptHits, files, projects, actions, actionLabels, query, fileRoot],
  );
  const items = useMemo(() => flattenSections(sections), [sections]);

  // Reset per open, and put the caret where you are about to type.
  useEffect(() => {
    if (!open) return;
    setQuery("");
    setSelected(0);
    const timer = setTimeout(() => inputRef.current?.focus(), 0);
    return () => clearTimeout(timer);
  }, [open]);

  // Keep the debounced file search in sync with what was typed.
  useEffect(() => {
    if (!open) return;
    const cancelFiles = searchFiles(query);
    const cancelTranscripts = searchTranscripts(query);
    return () => {
      cancelFiles?.();
      cancelTranscripts?.();
    };
  }, [open, query, searchFiles, searchTranscripts]);

  useEffect(() => {
    setSelected((current) => clampSelection(current, items.length));
  }, [items.length]);

  useEffect(() => {
    const node = listRef.current?.querySelector<HTMLElement>(`[data-index="${String(selected)}"]`);
    node?.scrollIntoView({ block: "nearest" });
  }, [selected]);

  const activate = useCallback(
    (item: GlobalSearchItem | undefined) => {
      if (!item) return;
      onSelect(item);
      onClose();
    },
    [onClose, onSelect],
  );

  const handleKeyDown = (event: React.KeyboardEvent) => {
    if (event.key === "ArrowDown") {
      event.preventDefault();
      setSelected((current) => moveSelection(current, items.length, 1));
      return;
    }
    if (event.key === "ArrowUp") {
      event.preventDefault();
      setSelected((current) => moveSelection(current, items.length, -1));
      return;
    }
    if (event.key === "Enter") {
      event.preventDefault();
      activate(items[selected]);
      return;
    }
    if (event.key === "Escape") {
      event.preventDefault();
      onClose();
    }
  };

  if (!open) return null;

  let rowIndex = -1;
  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={t("globalSearch", "Search")}
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 1100,
        background: "var(--scrim)",
        display: "flex",
        justifyContent: "center",
        alignItems: "flex-start",
        paddingTop: "12vh",
      }}
      onClick={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div
        style={{
          width: "min(680px, 92vw)",
          maxHeight: "64vh",
          display: "flex",
          flexDirection: "column",
          background: "var(--menu-bg)",
          border: "1px solid var(--border)",
          borderRadius: "var(--radius-lg)",
          boxShadow: "var(--shadow-lg)",
          overflow: "hidden",
        }}
      >
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 8,
            padding: "10px 12px",
            borderBottom: "1px solid var(--border-soft)",
            flexShrink: 0,
          }}
        >
          <svg
            width="15"
            height="15"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            aria-hidden="true"
            style={{ color: "var(--text-dim)", flexShrink: 0 }}
          >
            <circle cx="11" cy="11" r="7" />
            <path d="m20 20-3.5-3.5" />
          </svg>
          <input
            ref={inputRef}
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            onKeyDown={handleKeyDown}
            placeholder={t("globalSearchPlaceholder", "Search sessions, files, projects and commands")}
            aria-label={t("globalSearch", "Search")}
            style={{
              flex: 1,
              minWidth: 0,
              background: "transparent",
              border: "none",
              outline: "none",
              color: "var(--text)",
              fontSize: 13.5,
            }}
          />
          <span style={{ fontSize: 10, color: "var(--text-faint)", flexShrink: 0 }}>esc</span>
        </div>

        <div ref={listRef} style={{ overflow: "auto", padding: 6 }}>
          {items.length === 0 ? (
            <div style={{ padding: "22px 10px", textAlign: "center", fontSize: 12, color: "var(--text-dim)" }}>
              {query.trim() ? t("globalSearchEmpty", "Nothing matched") : t("globalSearchIdle", "Type to search")}
            </div>
          ) : (
            sections.map((section) => (
              <div key={section.kind} style={{ marginBottom: 4 }}>
                <div
                  style={{
                    padding: "6px 8px 4px",
                    fontSize: 10,
                    letterSpacing: "0.06em",
                    textTransform: "uppercase",
                    color: "var(--text-faint)",
                  }}
                >
                  {t(`globalSearchSection_${section.kind}`, SECTION_LABELS[section.kind])}
                </div>
                {section.items.map((item) => {
                  rowIndex += 1;
                  const index = rowIndex;
                  const active = index === selected;
                  return (
                    <button
                      key={item.key}
                      type="button"
                      data-index={index}
                      onMouseMove={() => setSelected(index)}
                      onClick={() => activate(item)}
                      style={{
                        display: "flex",
                        alignItems: "center",
                        gap: 8,
                        width: "100%",
                        padding: "6px 8px",
                        border: "none",
                        borderRadius: "var(--radius-sm)",
                        background: active ? "var(--bg-selected)" : "transparent",
                        color: active ? "var(--accent)" : "var(--text)",
                        cursor: "pointer",
                        textAlign: "left",
                        font: "inherit",
                      }}
                    >
                      <KindIcon kind={item.kind} />
                      <span
                        style={{
                          flex: 1,
                          minWidth: 0,
                          overflow: "hidden",
                          textOverflow: "ellipsis",
                          whiteSpace: "nowrap",
                          fontSize: 12.5,
                        }}
                      >
                        {item.title}
                      </span>
                      <span
                        style={{
                          fontSize: 10.5,
                          color: "var(--text-faint)",
                          maxWidth: "42%",
                          overflow: "hidden",
                          textOverflow: "ellipsis",
                          whiteSpace: "nowrap",
                          flexShrink: 0,
                        }}
                      >
                        {item.detail}
                      </span>
                    </button>
                  );
                })}
              </div>
            ))
          )}
        </div>

        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 12,
            padding: "7px 12px",
            borderTop: "1px solid var(--border-soft)",
            fontSize: 10.5,
            color: "var(--text-faint)",
            flexShrink: 0,
          }}
        >
          <span>↑↓ {t("globalSearchMove", "move")}</span>
          <span>↵ {t("globalSearchOpen", "open")}</span>
          <span style={{ marginLeft: "auto" }}>
            {items.length} {t("globalSearchResults", "results")}
          </span>
        </div>
      </div>
    </div>
  );
}
