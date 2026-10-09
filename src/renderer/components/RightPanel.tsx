import type {
  CSSProperties,
  PointerEvent as ReactPointerEvent,
  KeyboardEvent as ReactKeyboardEvent,
  ReactNode,
} from "react";

import { FileExplorer } from "./FileExplorer";
import { FileViewer } from "./FileViewer";
import { TabBar, type Tab } from "./TabBar";
import { useI18n } from "@/i18n";

/** Tab id of the file browser, which is not a file tab. */
export const EXPLORER_TAB_ID = "explorer";

export interface PanelTab {
  id: string;
  label: string;
  icon: ReactNode;
}

interface Props {
  open: boolean;
  resizing: boolean;
  width: number;
  bounds: { minWidth: number; maxWidth: number };
  onResizeStart: (event: ReactPointerEvent<HTMLDivElement>) => void;
  onResizeKeyDown: (event: ReactKeyboardEvent<HTMLDivElement>) => void;
  isMobile: boolean;
  windowControlsWidth: number;
  /** Project-scoped views (files, git, tasks, memory) shown as an icon rail. */
  panelTabs: PanelTab[];
  activePanelId: string | null;
  onSelectPanel: (id: string) => void;
  /** Open file tabs, scoped to this conversation. */
  tabs: Tab[];
  activeFileTab: Tab | undefined;
  onCloseTab: (id: string) => void;
  onOpenFile: (filePath: string) => void;
  explorerCwd: string | null;
  explorerRefreshKey: number;
  onRefreshExplorer: () => void;
  onAtMention: (relativePath: string, isDir: boolean) => void;
  activeCwd: string | null;
  /** A selection in the viewer, quoted into the composer. */
  onQuote: (quote: { path: string; text: string }) => void;
}

/**
 * The right dock: a resizable column holding the project panel rail, the open
 * file tabs, and the viewer. Both halves stay mounted so switching tabs does not
 * lose scroll position or viewer state.
 */
export function RightPanel({
  open,
  resizing,
  width,
  bounds,
  onResizeStart,
  onResizeKeyDown,
  isMobile,
  windowControlsWidth,
  panelTabs,
  activePanelId,
  onSelectPanel,
  tabs,
  activeFileTab,
  onCloseTab,
  onOpenFile,
  explorerCwd,
  explorerRefreshKey,
  onRefreshExplorer,
  onAtMention,
  activeCwd,
  onQuote,
}: Props) {
  const { t } = useI18n();

  return (
    <div
      className={`right-panel-container${open ? " right-panel-open" : " right-panel-closed"}${resizing ? " right-panel-resizing" : ""}`}
      style={
        {
          display: "flex",
          flexDirection: "column",
          borderLeft: "1px solid var(--border)",
          background: "var(--bg)",
          "--right-panel-width": `${width}px`,
          "--right-panel-min-width": `${bounds.minWidth}px`,
        } as CSSProperties
      }
    >
      <div
        className="right-panel-resizer"
        role="separator"
        aria-label={t("resizeRightPanel", "Resize right panel")}
        aria-orientation="vertical"
        aria-valuemin={bounds.minWidth}
        aria-valuemax={bounds.maxWidth}
        aria-valuenow={Math.round(width)}
        aria-valuetext={`${Math.round(width)} pixels`}
        tabIndex={isMobile ? -1 : 0}
        onPointerDown={onResizeStart}
        onKeyDown={onResizeKeyDown}
      />
      {/* Right panel tab bar */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          flexShrink: 0,
          background: "var(--bg-panel)",
          borderBottom: "1px solid var(--border)",
          height: 36,
          paddingRight: 36 + windowControlsWidth,
          boxSizing: "border-box",
        }}
      >
        {/* Project panels: an icon rail, so the file tabs keep the width.
      Scope matters here — these four describe the repository, the tabs
      after the divider belong to this conversation. */}
        <div
          role="tablist"
          aria-label={t("projectPanels", "Project panels")}
          style={{
            display: "flex",
            alignItems: "center",
            gap: 2,
            padding: 3,
            margin: "0 6px",
            flexShrink: 0,
            background: "var(--control-chip-bg)",
            border: "1px solid var(--control-chip-border)",
            borderRadius: "var(--radius-md)",
          }}
        >
          {panelTabs.map((panel) => {
            const active = activePanelId === panel.id;
            return (
              <button
                key={panel.id}
                type="button"
                role="tab"
                aria-selected={active}
                title={panel.label}
                aria-label={panel.label}
                data-panel-tab={panel.id}
                onClick={() => onSelectPanel(panel.id)}
                style={{
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  width: 28,
                  height: 28,
                  padding: 0,
                  border: "none",
                  borderRadius: "var(--radius-md)",
                  background: active ? "var(--accent-soft)" : "transparent",
                  color: active ? "var(--accent)" : "var(--text-muted)",
                  cursor: "pointer",
                }}
                onMouseEnter={(e) => {
                  if (!active) e.currentTarget.style.color = "var(--text)";
                }}
                onMouseLeave={(e) => {
                  if (!active) e.currentTarget.style.color = "var(--text-muted)";
                }}
              >
                {panel.icon}
              </button>
            );
          })}
        </div>
        <div
          aria-hidden="true"
          style={{ width: 1, height: 18, background: "var(--border)", flexShrink: 0, margin: "0 6px" }}
        />
        <div style={{ flex: 1, overflow: "hidden", display: "flex", alignItems: "center", minWidth: 0 }}>
          <div style={{ flex: 1, overflow: "hidden", minWidth: 0 }}>
            <TabBar tabs={tabs} activeTabId={activePanelId ?? ""} onSelectTab={onSelectPanel} onCloseTab={onCloseTab} />
          </div>
        </div>
        {activePanelId === EXPLORER_TAB_ID && explorerCwd && (
          <button
            type="button"
            onClick={onRefreshExplorer}
            title={t("refreshExplorer", "Refresh explorer")}
            aria-label={t("refreshExplorer", "Refresh explorer")}
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              width: 34,
              height: 34,
              padding: 0,
              marginRight: 2,
              flexShrink: 0,
              background: "var(--control-chip-bg)",
              border: "1px solid var(--control-chip-border)",
              color: "var(--control-chip-fg)",
              cursor: "pointer",
              borderRadius: "var(--radius-sm)",
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.color = "var(--accent)";
              e.currentTarget.style.background = "var(--control-chip-bg-hover)";
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.color = "var(--control-chip-fg)";
              e.currentTarget.style.background = "var(--control-chip-bg)";
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
              aria-hidden="true"
            >
              <path d="M3 12a9 9 0 1 0 3-6.7L3 8" />
              <path d="M3 3v5h5" />
            </svg>
          </button>
        )}
      </div>

      {/* Explorer / Terminal / file content - mounted persistently so a
    running terminal survives tab switches (display toggled). */}
      <div style={{ flex: 1, overflow: "hidden" }}>
        <div style={{ height: "100%", display: activePanelId === EXPLORER_TAB_ID ? "block" : "none" }}>
          {explorerCwd ? (
            <div style={{ height: "100%", overflowY: "auto", overflowX: "hidden", paddingTop: 4 }}>
              <FileExplorer
                cwd={explorerCwd}
                onOpenFile={onOpenFile}
                refreshKey={explorerRefreshKey}
                onAtMention={onAtMention}
              />
            </div>
          ) : (
            <div
              style={{
                height: "100%",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                color: "var(--text-dim)",
                fontSize: 12,
              }}
            >
              {t("selectProjectPlaceholder", "Select a project to browse files")}
            </div>
          )}
        </div>
        <div
          style={{
            height: "100%",
            display: panelTabs.some((panel) => panel.id === activePanelId) ? "none" : "block",
          }}
        >
          {activeFileTab?.filePath ? (
            <FileViewer
              key={activeFileTab.id ?? activeFileTab.filePath}
              filePath={activeFileTab.filePath}
              cwd={activeCwd ?? undefined}
              sourceSessionId={activeFileTab.sourceSessionId}
              onQuote={onQuote}
            />
          ) : (
            <div
              style={{
                height: "100%",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                color: "var(--text-dim)",
                fontSize: 12,
              }}
            >
              Select Explorer or open a file
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
