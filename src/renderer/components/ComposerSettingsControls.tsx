import type { RefObject } from "react";

import { useI18n } from "@/i18n";

const THINKING_LEVELS = ["auto", "off", "minimal", "low", "medium", "high", "xhigh"] as const;
const TOOL_PRESETS = ["off", "default", "full"] as const;

const TOOL_PRESET_MAP: Record<"off" | "default" | "full", "none" | "default" | "full"> = {
  off: "none",
  default: "default",
  full: "full",
};

interface Props {
  isMobile: boolean;
  isStreaming: boolean;
  onAbort: () => void;
  thinkingButtonRef: RefObject<HTMLButtonElement | null>;
  thinkingDropdownRef: RefObject<HTMLDivElement | null>;
  thinkingOpen: boolean;
  thinkingDisplayLabel: string;
  thinkingLevel?: string;
  thinkingLevelMap?: Record<string, string | null> | null;
  availableThinkingLevels?: string[] | null;
  onThinkingChange?: (level: (typeof THINKING_LEVELS)[number]) => void;
  toolButtonRef: RefObject<HTMLButtonElement | null>;
  toolDropdownRef: RefObject<HTMLDivElement | null>;
  toolOpen: boolean;
  toolPreset?: "none" | "default" | "full";
  onToolPresetChange?: (preset: "none" | "default" | "full") => void;
  onToggleThinking: () => void;
  onToggleTool: () => void;
  onCloseDropdowns: () => void;
  onShowContextMap?: () => void;
  onCompactContext?: () => void;
  onAbortCompaction?: () => void;
  isContextCompacting: boolean;
  compactElapsedSeconds: number;
  compactError?: string | null;
  contextCompactDisabled: boolean;
  onSoundToggle?: () => void;
  soundEnabled?: boolean;
}

/**
 * The composer's right-hand settings: stop, reasoning level, permission preset,
 * context map, compaction and the completion sound. The composer owns the
 * dropdown state and the handlers; this only renders them.
 */
export function ComposerSettingsControls({
  isMobile,
  isStreaming,
  onAbort,
  thinkingButtonRef,
  thinkingDropdownRef,
  thinkingOpen,
  thinkingDisplayLabel,
  thinkingLevel,
  thinkingLevelMap,
  availableThinkingLevels,
  onThinkingChange,
  toolButtonRef,
  toolDropdownRef,
  toolOpen,
  toolPreset,
  onToolPresetChange,
  onToggleThinking,
  onToggleTool,
  onCloseDropdowns,
  onShowContextMap,
  onCompactContext,
  onAbortCompaction,
  isContextCompacting,
  compactElapsedSeconds,
  compactError,
  contextCompactDisabled,
  onSoundToggle,
  soundEnabled,
}: Props) {
  const { t } = useI18n();

  const thinkingLabels: Record<(typeof THINKING_LEVELS)[number], string> = {
    auto: t("thinkingAuto", "Auto"),
    off: t("thinkingOff", "Off"),
    minimal: t("thinkingMinimal", "Minimal"),
    low: t("thinkingLow", "Low"),
    medium: t("thinkingMedium", "Medium"),
    high: t("thinkingHigh", "High"),
    xhigh: t("thinkingXHigh", "Extra high"),
  };
  const thinkingDescriptions: Record<(typeof THINKING_LEVELS)[number], string> = {
    auto: t("thinkingDefaultDescription", "Use Pi default"),
    off: t("thinkingOffDescription", "Reasoning off"),
    minimal: t("thinkingMinimalDescription", "Minimal reasoning"),
    low: t("thinkingLowDescription", "Low reasoning"),
    medium: t("thinkingMediumDescription", "Medium reasoning"),
    high: t("thinkingHighDescription", "High reasoning"),
    xhigh: t("thinkingXHighDescription", "Max reasoning"),
  };
  const translateThinkingValue = (value: string): string =>
    (THINKING_LEVELS as readonly string[]).includes(value)
      ? thinkingLabels[value as (typeof THINKING_LEVELS)[number]]
      : value;
  const toolPresetKey =
    (Object.entries(TOOL_PRESET_MAP).find(([, value]) => value === (toolPreset ?? "default"))?.[0] as
      "off" | "default" | "full" | undefined) ?? "default";
  const toolPresetLabels: Record<"off" | "default" | "full", string> = {
    off: t("permissionReadOnly", "Read only"),
    default: t("permissionStandard", "Standard"),
    full: t("permissionFull", "Full access"),
  };
  const toolPresetLabel = toolPresetLabels[toolPresetKey];

  return (
    <>
      {isStreaming && (
        <button
          type="button"
          onClick={() => {
            onCloseDropdowns();
            onAbort();
          }}
          title={t("stopAgent", "Stop agent")}
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            gap: 6,
            width: isMobile ? 32 : undefined,
            padding: isMobile ? 0 : "8px 14px",
            height: 32,
            background: "var(--danger-soft)",
            border: "1px solid var(--danger-border)",
            borderRadius: "var(--radius-md)",
            color: "var(--danger)",
            cursor: "pointer",
            fontSize: 12,
            fontWeight: 600,
            whiteSpace: "nowrap",
            letterSpacing: "-0.01em",
            transition: "background 0.12s",
          }}
          onMouseEnter={(e) => {
            e.currentTarget.style.background = "var(--danger-soft)";
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.background = "var(--danger-soft)";
          }}
        >
          <svg width="10" height="10" viewBox="0 0 10 10" fill="none">
            <rect x="1.5" y="1.5" width="7" height="7" rx="1.5" fill="currentColor" />
          </svg>
          {!isMobile && t("stop", "Stop")}
        </button>
      )}
      <div style={{ display: "contents" }}>
        {onThinkingChange && (
          <div ref={thinkingDropdownRef} style={{ position: "relative" }}>
            <button
              ref={thinkingButtonRef}
              type="button"
              aria-haspopup="menu"
              aria-expanded={thinkingOpen}
              onClick={() => {
                if (isStreaming) return;
                onCloseDropdowns();
                onToggleThinking();
              }}
              disabled={isStreaming}
              title={`${t("changeThinkingLevel", "Change reasoning level")}: ${thinkingDisplayLabel}`}
              aria-label={`${t("changeThinkingLevel", "Change reasoning level")}: ${thinkingDisplayLabel}`}
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                gap: 5,
                padding: isMobile ? 0 : "0 9px",
                minWidth: 32,
                height: 32,
                background: thinkingOpen ? "var(--bg-selected)" : "var(--control-chip-bg)",
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
                e.currentTarget.style.background = thinkingOpen ? "var(--bg-selected)" : "var(--bg-panel)";
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
                <path d="M9.5 2A5.5 5.5 0 0 0 4 7.5c0 1.7.78 3.21 2 4.21V14a1 1 0 0 0 1 1h5a1 1 0 0 0 1-1v-2.29c1.22-1 2-2.51 2-4.21A5.5 5.5 0 0 0 9.5 2z" />
                <line x1="7" y1="18" x2="12" y2="18" />
                <line x1="8" y1="21" x2="11" y2="21" />
              </svg>
              {!isMobile && <span style={{ whiteSpace: "nowrap" }}>{thinkingDisplayLabel}</span>}
            </button>
            {thinkingOpen && (
              <div
                role="menu"
                aria-label={t("changeThinkingLevel", "Change reasoning level")}
                style={{
                  position: "absolute",
                  bottom: "calc(100% + 6px)",
                  right: 0,
                  zIndex: 100,
                  background: "var(--bg)",
                  border: "1px solid var(--border)",
                  borderRadius: "var(--radius-md)",
                  boxShadow: "var(--shadow-md)",
                  overflow: "hidden",
                  minWidth: 180,
                }}
              >
                {THINKING_LEVELS.filter((lvl) => {
                  if (!availableThinkingLevels) return true;
                  if (lvl === "auto") return true;
                  return availableThinkingLevels.includes(lvl);
                }).map((lvl) => {
                  const isActive = (thinkingLevel ?? "auto") === lvl;
                  const desc = thinkingDescriptions[lvl];
                  const mappedVal = lvl !== "auto" && thinkingLevelMap ? thinkingLevelMap[lvl] : undefined;
                  const displayLabel = translateThinkingValue(mappedVal != null && mappedVal !== lvl ? mappedVal : lvl);
                  const showOriginal = mappedVal != null && mappedVal !== lvl;
                  return (
                    <button
                      key={lvl}
                      type="button"
                      role="menuitemradio"
                      aria-checked={isActive}
                      onClick={() => {
                        if (!isActive) onThinkingChange(lvl);
                        onCloseDropdowns();
                        requestAnimationFrame(() => thinkingButtonRef.current?.focus());
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
                      <span style={{ flex: 1 }}>
                        {displayLabel}
                        {showOriginal && (
                          <span
                            style={{
                              fontSize: 10,
                              color: "var(--text-dim)",
                              fontFamily: "var(--font-mono)",
                              marginLeft: 5,
                            }}
                          >
                            ({thinkingLabels[lvl]})
                          </span>
                        )}
                      </span>
                      <span style={{ fontSize: 11, color: "var(--text-dim)", marginLeft: 8 }}>{desc}</span>
                    </button>
                  );
                })}
              </div>
            )}
          </div>
        )}
        {onToolPresetChange && (
          <div ref={toolDropdownRef} style={{ position: "relative" }}>
            <button
              ref={toolButtonRef}
              type="button"
              aria-haspopup="menu"
              aria-expanded={toolOpen}
              onClick={() => {
                if (isStreaming) return;
                onCloseDropdowns();
                onToggleTool();
              }}
              disabled={isStreaming}
              title={`${t("changePermission", "Change permission settings")}: ${toolPresetLabel}`}
              aria-label={`${t("changePermission", "Change permission settings")}: ${toolPresetLabel}`}
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                gap: 5,
                padding: isMobile ? 0 : "0 9px",
                minWidth: 32,
                height: 32,
                background: toolOpen ? "var(--bg-selected)" : "var(--control-chip-bg)",
                border: `1px solid ${toolPresetKey === "full" ? "var(--danger-border)" : "var(--control-chip-border)"}`,
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
                e.currentTarget.style.background = toolOpen ? "var(--bg-selected)" : "var(--bg-panel)";
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
                <path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z" />
              </svg>
              {!isMobile && <span style={{ whiteSpace: "nowrap" }}>{toolPresetLabel}</span>}
            </button>
            {toolOpen && (
              <div
                role="menu"
                aria-label={t("changePermission", "Change permission settings")}
                style={{
                  position: "absolute",
                  bottom: "calc(100% + 6px)",
                  right: 0,
                  zIndex: 100,
                  background: "var(--bg)",
                  border: "1px solid var(--border)",
                  borderRadius: "var(--radius-md)",
                  boxShadow: "var(--shadow-md)",
                  overflow: "hidden",
                  minWidth: 120,
                }}
              >
                {TOOL_PRESETS.map((lvl) => {
                  const preset = TOOL_PRESET_MAP[lvl];
                  const isActive = (toolPreset ?? "default") === preset;
                  const desc =
                    lvl === "off"
                      ? t("permissionReadOnlyDescription", "No tools, read-only")
                      : lvl === "default"
                        ? t("permissionStandardDescription", "4 built-in tools")
                        : t("permissionFullDescription", "All built-in tools");
                  return (
                    <button
                      key={lvl}
                      type="button"
                      role="menuitemradio"
                      aria-checked={isActive}
                      onClick={() => {
                        if (!isActive) onToolPresetChange(preset);
                        onCloseDropdowns();
                        requestAnimationFrame(() => toolButtonRef.current?.focus());
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
                      <span style={{ flex: 1 }}>{toolPresetLabels[lvl]}</span>
                      <span style={{ fontSize: 11, color: "var(--text-dim)", marginLeft: 8 }}>{desc}</span>
                    </button>
                  );
                })}
              </div>
            )}
          </div>
        )}

        {onShowContextMap && (
          <button
            type="button"
            onClick={() => {
              onCloseDropdowns();
              onShowContextMap();
            }}
            title={t("contextMapHint", "See what the model is being sent")}
            aria-label={t("contextMap", "Context map")}
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              minWidth: 32,
              height: 32,
              background: "var(--control-chip-bg)",
              border: "1px solid var(--control-chip-border)",
              borderRadius: "var(--radius-md)",
              color: "var(--control-chip-fg)",
              cursor: "pointer",
              flexShrink: 0,
            }}
          >
            <svg
              width="14"
              height="14"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.8"
              aria-hidden="true"
            >
              <rect x="3" y="3" width="7" height="7" rx="1.5" />
              <rect x="14" y="3" width="7" height="4" rx="1.5" />
              <rect x="14" y="11" width="7" height="10" rx="1.5" />
              <rect x="3" y="14" width="7" height="7" rx="1.5" />
            </svg>
          </button>
        )}

        {onCompactContext && (
          <div style={{ position: "relative" }}>
            {compactError && (
              <div
                style={{
                  position: "absolute",
                  bottom: "calc(100% + 6px)",
                  right: 0,
                  background: "var(--tool-bg)",
                  color: "var(--danger)",
                  fontSize: 11,
                  padding: "4px 8px",
                  borderRadius: "var(--radius-sm)",
                  whiteSpace: "nowrap",
                  pointerEvents: "none",
                  boxShadow: "var(--shadow-sm)",
                  zIndex: 50,
                }}
              >
                {compactError}
              </div>
            )}
            <button
              type="button"
              onClick={() => {
                onCloseDropdowns();
                if (isContextCompacting) onAbortCompaction?.();
                else onCompactContext();
              }}
              disabled={contextCompactDisabled}
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                gap: 5,
                padding: isMobile ? 0 : "0 9px",
                minWidth: 32,
                height: 32,
                background: isContextCompacting ? "var(--danger-soft)" : "var(--bg-panel)",
                border: `1px solid ${isContextCompacting ? "var(--danger-border)" : "var(--border)"}`,
                borderRadius: "var(--radius-md)",
                color: isContextCompacting ? "var(--danger)" : "var(--text-muted)",
                cursor: contextCompactDisabled ? "not-allowed" : "pointer",
                fontSize: 12,
                opacity: contextCompactDisabled ? 0.5 : 1,
                transition: "background 0.12s, color 0.12s",
              }}
              onMouseEnter={(e) => {
                if (contextCompactDisabled) return;
                e.currentTarget.style.background = isContextCompacting ? "var(--danger-soft)" : "var(--bg-hover)";
                e.currentTarget.style.color = isContextCompacting ? "var(--danger)" : "var(--text)";
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.background = isContextCompacting ? "var(--danger-soft)" : "var(--bg-panel)";
                e.currentTarget.style.color = isContextCompacting ? "var(--danger)" : "var(--text-muted)";
              }}
              title={isContextCompacting ? t("stopCompaction", "Stop compaction") : t("compact", "Compact context")}
              aria-label={
                isContextCompacting ? t("stopCompaction", "Stop compaction") : t("compact", "Compact context")
              }
            >
              {isContextCompacting ? (
                <>
                  <svg width="10" height="10" viewBox="0 0 10 10" fill="none">
                    <rect x="2" y="2" width="6" height="6" rx="1" fill="currentColor" />
                  </svg>
                  {!isMobile && (
                    <span style={{ whiteSpace: "nowrap" }}>
                      {t("compacting", "Compacting…")}
                      {compactElapsedSeconds > 0 ? ` ${String(compactElapsedSeconds)}s` : ""}
                    </span>
                  )}
                </>
              ) : (
                <>
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
                    <polyline points="4 14 10 14 10 20" />
                    <polyline points="20 10 14 10 14 4" />
                    <line x1="10" y1="14" x2="3" y2="21" />
                    <line x1="21" y1="3" x2="14" y2="10" />
                  </svg>
                  {!isMobile && <span style={{ whiteSpace: "nowrap" }}>{t("compact", "Compact")}</span>}
                </>
              )}
            </button>
          </div>
        )}

        {onSoundToggle !== undefined && (
          <button
            type="button"
            aria-pressed={soundEnabled === true}
            onClick={() => {
              onCloseDropdowns();
              onSoundToggle();
            }}
            title={
              soundEnabled
                ? t("disableCompletionSound", "Disable completion sound")
                : t("enableCompletionSound", "Enable completion sound")
            }
            aria-label={
              soundEnabled
                ? t("disableCompletionSound", "Disable completion sound")
                : t("enableCompletionSound", "Enable completion sound")
            }
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              width: 32,
              height: 32,
              padding: 0,
              background: "var(--bg-panel)",
              border: "1px solid var(--border)",
              borderRadius: "var(--radius-md)",
              color: soundEnabled ? "var(--text-muted)" : "var(--text-dim)",
              cursor: "pointer",
              opacity: soundEnabled ? 1 : 0.55,
              transition: "background 0.12s, color 0.12s, opacity 0.12s",
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.background = "var(--bg-hover)";
              e.currentTarget.style.color = "var(--text)";
              e.currentTarget.style.opacity = "1";
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.background = "var(--bg-panel)";
              e.currentTarget.style.color = soundEnabled ? "var(--text-muted)" : "var(--text-dim)";
              e.currentTarget.style.opacity = soundEnabled ? "1" : "0.55";
            }}
          >
            {soundEnabled ? (
              <svg
                width="12"
                height="12"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5" />
                <path d="M15.54 8.46a5 5 0 0 1 0 7.07" />
                <path d="M19.07 4.93a10 10 0 0 1 0 14.14" />
              </svg>
            ) : (
              <svg
                width="12"
                height="12"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5" />
                <line x1="23" y1="9" x2="17" y2="15" />
                <line x1="17" y1="9" x2="23" y2="15" />
              </svg>
            )}
          </button>
        )}
      </div>
    </>
  );
}
