import { createPortal } from "react-dom";
import type { CSSProperties, RefObject } from "react";

import { useI18n } from "@/i18n";

export interface ModelOption {
  provider: string;
  modelId: string;
  name: string;
}

export interface ModelGroup {
  provider: string;
  options: ModelOption[];
}

export interface ModelCatalogWarnings {
  provider: string;
  code: string;
  message: string;
}

interface Props {
  /** Options decide whether the control renders at all. */
  options: ModelOption[];
  byProvider: ModelGroup[];
  currentName: string | null;
  activeModel: { provider: string; modelId: string } | null;
  /** True while the host picked the model for us. */
  autoSelection: boolean;
  open: boolean;
  /** Opens or closes the panel; the composer recomputes the anchor rect first. */
  onToggle: () => void;
  onClose: () => void;
  onSelect: (provider: string, modelId: string) => void;
  /** Absent when the host has no model directory to refresh. */
  onRefresh?: () => void;
  refreshing: boolean;
  catalog?: { source?: string; warnings?: ModelCatalogWarnings[] } | null;
  /** Viewport-anchored panel rect, measured by the composer. */
  rect: { top: number; left: number; width: number } | null;
  containerRef: RefObject<HTMLDivElement | null>;
  buttonRef: RefObject<HTMLButtonElement | null>;
  panelRef: RefObject<HTMLDivElement | null>;
  isMobile: boolean;
  isStreaming: boolean;
}

/**
 * The model picker in the composer. The panel is portalled to the body and
 * positioned from a measured rect, so it escapes the composer's overflow.
 */
export function ModelSelector({
  options,
  byProvider,
  currentName,
  activeModel,
  autoSelection,
  open,
  onToggle,
  onClose,
  onSelect,
  onRefresh,
  refreshing,
  catalog,
  rect,
  containerRef,
  buttonRef,
  panelRef,
  isMobile,
  isStreaming,
}: Props) {
  const { t } = useI18n();

  if (!(onRefresh || (options.length > 0 && currentName && onSelect))) return null;

  return (
    <div ref={containerRef} style={{ position: "relative", flex: isMobile ? "1 1 auto" : undefined, minWidth: 0 }}>
      <button
        ref={buttonRef}
        onClick={onToggle}
        disabled={isStreaming}
        style={{
          display: "flex",
          alignItems: "center",
          gap: 6,
          justifyContent: isMobile ? "flex-start" : undefined,
          padding: isMobile ? "8px 10px" : "8px 12px",
          height: 32,
          width: isMobile ? "100%" : undefined,
          maxWidth: isMobile ? "100%" : 220,
          overflow: "hidden",
          background: open ? "var(--bg-selected)" : "var(--control-chip-bg)",
          border: "1px solid var(--control-chip-border)",
          borderRadius: "var(--radius-md)",
          color: "var(--control-chip-fg)",
          cursor: isStreaming ? "not-allowed" : "pointer",
          fontSize: 12,
          opacity: isStreaming ? 0.5 : 1,
          transition: "background 0.12s, color 0.12s",
        }}
        onMouseEnter={(e) => {
          if (isStreaming) return;
          e.currentTarget.style.background = "var(--bg-hover)";
          e.currentTarget.style.color = "var(--text)";
        }}
        onMouseLeave={(e) => {
          e.currentTarget.style.background = open ? "var(--bg-selected)" : "var(--bg-panel)";
          e.currentTarget.style.color = "var(--text-muted)";
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
        >
          <rect x="4" y="4" width="16" height="16" rx="2" />
          <rect x="9" y="9" width="6" height="6" />
          <line x1="9" y1="1" x2="9" y2="4" />
          <line x1="15" y1="1" x2="15" y2="4" />
          <line x1="9" y1="20" x2="9" y2="23" />
          <line x1="15" y1="20" x2="15" y2="23" />
          <line x1="20" y1="9" x2="23" y2="9" />
          <line x1="20" y1="14" x2="23" y2="14" />
          <line x1="1" y1="9" x2="4" y2="9" />
          <line x1="1" y1="14" x2="4" y2="14" />
        </svg>
        <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", minWidth: 0 }}>
          {currentName ?? t("models", "Models")}
        </span>
      </button>
      {open &&
        rect &&
        typeof document !== "undefined" &&
        createPortal(
          (() => {
            const viewportHeight = window.visualViewport?.height ?? window.innerHeight;
            const bottom = viewportHeight - rect.top + 6;
            const maxH = Math.max(120, Math.min(rect.top - 8, viewportHeight * 0.6));
            // On mobile, pin to a small left margin and cap width to the
            // viewport so long model names never push the panel off-screen.
            const panelPos: CSSProperties = isMobile
              ? { left: 8, right: 8, maxWidth: "calc(100vw - 16px)" }
              : { left: rect.left, width: "max-content", minWidth: rect.width };
            return (
              <div
                ref={panelRef}
                style={{
                  position: "fixed",
                  bottom,
                  ...panelPos,
                  zIndex: 500,
                  background: "var(--bg)",
                  border: "1px solid var(--border)",
                  borderRadius: "var(--radius-md)",
                  boxShadow: "var(--shadow-md)",
                  overflow: "hidden",
                  maxHeight: maxH,
                  overflowY: "auto",
                }}
              >
                {onRefresh && (
                  <div
                    style={{
                      padding: "7px 8px",
                      borderBottom: "1px solid var(--border)",
                      minWidth: 240,
                    }}
                  >
                    <button
                      type="button"
                      disabled={refreshing}
                      onClick={() => void onRefresh?.()}
                      style={{
                        width: "100%",
                        padding: "7px 9px",
                        border: "1px solid var(--border)",
                        borderRadius: "var(--radius-sm)",
                        background: "var(--bg-panel)",
                        color: "var(--text)",
                        cursor: refreshing ? "wait" : "pointer",
                        fontSize: 12,
                        textAlign: "left",
                      }}
                    >
                      {refreshing
                        ? t("refreshingModels", "Refreshing model directory…")
                        : t("refreshModels", "Refresh model directory")}
                    </button>
                    {catalog?.source === "offline" && (
                      <div style={{ marginTop: 6, color: "var(--text-dim)", fontSize: 11 }}>
                        {t("modelsOfflineCache", "Offline: using the cached model directory.")}
                      </div>
                    )}
                    {(catalog?.warnings ?? []).map((warning) => (
                      <div
                        key={`${warning.provider}:${warning.code}`}
                        role="alert"
                        style={{
                          marginTop: 6,
                          color: "var(--warning)",
                          fontSize: 11,
                          whiteSpace: "normal",
                        }}
                      >
                        {warning.message}
                      </div>
                    ))}
                  </div>
                )}
                {byProvider.map((group, gi) => (
                  <div key={group.provider}>
                    {byProvider.length > 1 && (
                      <div
                        style={{
                          padding: "6px 12px 4px",
                          fontSize: 10,
                          fontWeight: 600,
                          color: "var(--text-dim)",
                          textTransform: "uppercase",
                          letterSpacing: "0.07em",
                          borderTop: gi > 0 ? "1px solid var(--border)" : "none",
                        }}
                      >
                        {group.provider}
                      </div>
                    )}
                    {group.options.map((opt) => {
                      const isActive = opt.modelId === activeModel?.modelId && opt.provider === activeModel?.provider;
                      return (
                        <button
                          key={`${opt.provider}:${opt.modelId}`}
                          onClick={() => {
                            onClose();
                            if (!isActive || autoSelection) onSelect(opt.provider, opt.modelId);
                          }}
                          style={{
                            display: "flex",
                            alignItems: "center",
                            gap: 8,
                            width: "100%",
                            padding: "7px 12px",
                            background: isActive ? "var(--bg-selected)" : "none",
                            border: "none",
                            color: isActive ? "var(--text)" : "var(--text-muted)",
                            cursor: "pointer",
                            fontSize: 12,
                            textAlign: "left",
                            fontWeight: isActive ? 600 : 400,
                            whiteSpace: "nowrap",
                          }}
                          onMouseEnter={(e) => {
                            if (!isActive) e.currentTarget.style.background = "var(--bg-hover)";
                          }}
                          onMouseLeave={(e) => {
                            if (!isActive) e.currentTarget.style.background = "none";
                          }}
                        >
                          {isActive ? (
                            <svg
                              width="10"
                              height="10"
                              viewBox="0 0 10 10"
                              fill="none"
                              stroke="var(--accent)"
                              strokeWidth="2"
                              strokeLinecap="round"
                              strokeLinejoin="round"
                              style={{ flexShrink: 0 }}
                            >
                              <polyline points="1.5 5 4 7.5 8.5 2.5" />
                            </svg>
                          ) : (
                            <span style={{ width: 10, flexShrink: 0 }} />
                          )}
                          {opt.name}
                        </button>
                      );
                    })}
                  </div>
                ))}
              </div>
            );
          })(),
          document.body,
        )}
    </div>
  );
}
