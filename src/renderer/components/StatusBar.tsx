import type { ReactNode } from "react";

import { useI18n } from "@/i18n";

export interface StatusBarStats {
  tokens: { input: number; output: number; cacheRead: number; cacheWrite: number; total: number };
  cost: number;
  totalMessages: number;
}

interface Props {
  /** Context window occupancy; null when the host has not reported one yet. */
  contextUsage: { percent: number | null; contextWindow?: number; usedTokens?: number } | null;
  stats: StatusBarStats | null;
  /** Channel binding control, rendered here because the top bar has no room. */
  binding?: ReactNode;
  /** Opens the session info panel, which is anchored above this bar. */
  onToggleSessionInfo?: () => void;
  sessionInfoOpen?: boolean;
  /** Host connection state, e.g. relay or agent link. */
  connected?: boolean;
  hidden?: boolean;
}

function formatCompact(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1000) return `${String(Math.round(n / 1000))}k`;
  return String(n);
}

/**
 * The status bar: the numbers that describe the conversation, out of the way at
 * the bottom. The context bar is the point of it — occupancy is the one figure
 * that changes what you should do next, so it gets a bar rather than a number
 * buried in a popover.
 */
export function StatusBar({
  contextUsage,
  stats,
  binding,
  onToggleSessionInfo,
  sessionInfoOpen = false,
  connected,
  hidden,
}: Props) {
  const { t, language } = useI18n();
  if (hidden) return null;

  const percent = contextUsage?.percent ?? null;
  const contextWindow = contextUsage?.contextWindow ?? 0;
  const used = contextUsage?.usedTokens ?? (percent !== null && contextWindow ? (percent / 100) * contextWindow : 0);
  const tone =
    percent === null
      ? "var(--text-dim)"
      : percent >= 90
        ? "var(--red)"
        : percent >= 75
          ? "var(--amber)"
          : "var(--accent)";

  return (
    <div
      data-status-bar
      style={{
        display: "flex",
        alignItems: "center",
        gap: 12,
        flexShrink: 0,
        height: 26,
        padding: "0 10px",
        background: "var(--view-bg)",
        borderTop: "1px solid var(--border)",
        fontSize: 11,
        color: "var(--text-muted)",
        fontVariantNumeric: "tabular-nums",
        overflow: "hidden",
      }}
    >
      {connected !== undefined && (
        <span style={{ display: "flex", alignItems: "center", gap: 5, flexShrink: 0 }}>
          <span
            aria-hidden="true"
            style={{
              width: 6,
              height: 6,
              borderRadius: 999,
              background: connected ? "var(--green)" : "var(--text-faint)",
            }}
          />
          {connected ? t("connected", "已连接") : t("disconnected", "未连接")}
        </span>
      )}

      {/* Context window: a bar, because it decides what happens next. */}
      <button
        type="button"
        onClick={onToggleSessionInfo}
        title={
          percent !== null
            ? `${t("usageContext", "Context")}: ${percent.toFixed(1)}% — ${used.toLocaleString(language)} / ${contextWindow.toLocaleString(language)} ${t("tokens", "tokens")}`
            : t("contextUnknown", "Context usage is not known yet")
        }
        style={{
          display: "flex",
          alignItems: "center",
          gap: 8,
          flex: 1,
          minWidth: 120,
          maxWidth: 420,
          height: "100%",
          padding: "0 6px",
          background: "transparent",
          border: "none",
          cursor: onToggleSessionInfo ? "pointer" : "default",
          color: "inherit",
          textAlign: "left",
        }}
      >
        <span style={{ flexShrink: 0, color: "var(--text-dim)" }}>{t("usageContext", "上下文")}</span>
        <span
          aria-hidden="true"
          style={{
            position: "relative",
            flex: 1,
            minWidth: 60,
            height: 6,
            borderRadius: 999,
            background: "var(--sunken-bg)",
            overflow: "hidden",
          }}
        >
          <span
            style={{
              position: "absolute",
              inset: "0 auto 0 0",
              width: `${String(Math.max(0, Math.min(100, percent ?? 0)))}%`,
              background: tone,
              borderRadius: 999,
              transition: "width 0.3s ease",
            }}
          />
        </span>
        <span style={{ flexShrink: 0, color: tone, minWidth: 74, textAlign: "right" }}>
          {percent !== null ? `${percent.toFixed(0)}%` : "?"}
          {contextWindow ? ` / ${formatCompact(contextWindow)}` : ""}
        </span>
      </button>

      {stats && stats.tokens.total > 0 && (
        <span style={{ flexShrink: 0, color: "var(--text-dim)" }}>
          {formatCompact(stats.tokens.total)} {t("tokens", "tokens")}
        </span>
      )}
      {stats && stats.cost > 0 && (
        <span style={{ flexShrink: 0, color: "var(--text-dim)" }}>${stats.cost.toFixed(4)}</span>
      )}
      {stats && (
        <span style={{ flexShrink: 0, color: "var(--text-dim)" }}>
          {stats.totalMessages.toLocaleString(language)} {t("messages", "消息")}
        </span>
      )}

      {binding && <span style={{ marginLeft: "auto", flexShrink: 0 }}>{binding}</span>}
      {onToggleSessionInfo && (
        <button
          type="button"
          onClick={onToggleSessionInfo}
          aria-pressed={sessionInfoOpen}
          title={t("sessionInfo", "会话信息")}
          aria-label={t("sessionInfo", "会话信息")}
          style={{
            flexShrink: 0,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            width: 20,
            height: 20,
            padding: 0,
            background: sessionInfoOpen ? "var(--accent-soft)" : "transparent",
            border: "none",
            borderRadius: "var(--radius-sm)",
            color: sessionInfoOpen ? "var(--accent)" : "var(--text-dim)",
            cursor: "pointer",
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
            <circle cx="12" cy="12" r="10" />
            <line x1="12" y1="16" x2="12" y2="12" />
            <line x1="12" y1="8" x2="12.01" y2="8" />
          </svg>
        </button>
      )}
    </div>
  );
}
