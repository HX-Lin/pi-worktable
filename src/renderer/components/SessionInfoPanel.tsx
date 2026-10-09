import { useState } from "react";

import { useI18n } from "@/i18n";
import type { SessionStatsInfo } from "@/lib/pi-types";

export type SessionCopyField = "id" | "file";

interface Props {
  stats: SessionStatsInfo | null;
  contextUsage: { percent: number | null; contextWindow?: number } | null;
  isMobile: boolean;
}

/**
 * The session info panel, opened from the status bar. It is a read-only view of
 * what the host knows about this conversation: identity, message counts, tokens.
 */
export function SessionInfoPanel({ stats: sessionStats, contextUsage, isMobile }: Props) {
  const { t, language } = useI18n();
  const [copiedSessionField, setCopiedSessionField] = useState<SessionCopyField | null>(null);

  const handleCopySessionField = (field: SessionCopyField, value: string) => {
    void navigator.clipboard?.writeText(value).then(
      () => {
        setCopiedSessionField(field);
        setTimeout(() => {
          setCopiedSessionField((current) => (current === field ? null : current));
        }, 1500);
      },
      () => undefined,
    );
  };

  return (
    <div
      className="session-info-popover"
      style={{
        background: "var(--view-bg)",
        borderBottom: "1px solid var(--border)",
        boxShadow: "var(--shadow-md)",
        padding: "12px 16px",
      }}
    >
      {sessionStats ? (
        (() => {
          const sessionRows = [
            ...(sessionStats.sessionName
              ? [{ label: t("sessionName", "Name"), value: sessionStats.sessionName, copyField: null }]
              : []),
            {
              label: t("sessionFile", "File"),
              value: sessionStats.sessionFile ?? t("inMemory", "In-memory"),
              copyField: "file" as const,
            },
            { label: t("sessionId", "ID"), value: sessionStats.sessionId, copyField: "id" as const },
          ];
          const messageRows = [
            [t("user", "User"), sessionStats.userMessages.toLocaleString(language)],
            [t("assistant", "Assistant"), sessionStats.assistantMessages.toLocaleString(language)],
            [t("toolCalls", "Tool Calls"), sessionStats.toolCalls.toLocaleString(language)],
            [t("toolResults", "Tool Results"), sessionStats.toolResults.toLocaleString(language)],
            [t("total", "Total"), sessionStats.totalMessages.toLocaleString(language)],
          ];
          const tokenRows = [
            [t("usageInput", "Input"), sessionStats.tokens.input.toLocaleString(language)],
            [t("usageOutput", "Output"), sessionStats.tokens.output.toLocaleString(language)],
            ...(sessionStats.tokens.cacheRead > 0
              ? [[t("cacheRead", "Cache Read"), sessionStats.tokens.cacheRead.toLocaleString(language)]]
              : []),
            ...(sessionStats.tokens.cacheWrite > 0
              ? [[t("cacheWrite", "Cache Write"), sessionStats.tokens.cacheWrite.toLocaleString(language)]]
              : []),
            [t("total", "Total"), sessionStats.tokens.total.toLocaleString(language)],
          ];
          const ctx = contextUsage ?? sessionStats.contextUsage;
          const formatCompact = (n: number) =>
            n >= 1_000_000 ? `${(n / 1_000_000).toFixed(1)}M` : n >= 1000 ? `${(n / 1000).toFixed(0)}k` : String(n);
          const extraTokenRows = [
            ...(sessionStats.cost > 0 ? [[t("usageCost", "Cost"), `$${sessionStats.cost.toFixed(4)}`]] : []),
            ...(ctx?.contextWindow
              ? [
                  [
                    t("usageContext", "Context"),
                    `${ctx.percent !== null ? `${ctx.percent.toFixed(1)}%` : "?"} / ${formatCompact(ctx.contextWindow)}`,
                  ],
                ]
              : []),
          ];
          const section = (
            title: string,
            sectionRows: string[][],
            valueAlign: "left" | "right" = "left",
            compact = false,
          ) => (
            <div style={{ minWidth: 0 }}>
              <div style={{ fontSize: 12, fontWeight: 700, color: "var(--text)", marginBottom: 6 }}>{title}</div>
              <div
                style={{
                  display: "grid",
                  gridTemplateColumns: compact ? "max-content max-content" : "auto minmax(0, 1fr)",
                  columnGap: compact ? 14 : 12,
                  rowGap: 4,
                  justifyContent: compact ? "start" : undefined,
                }}
              >
                {sectionRows.map(([label, value]) => (
                  <div key={`${title}:${label}`} style={{ display: "contents" }}>
                    <div style={{ color: "var(--text-dim)", whiteSpace: "nowrap" }}>{label}</div>
                    <div
                      style={{
                        color: "var(--text-muted)",
                        minWidth: 0,
                        overflowWrap: compact ? "normal" : "anywhere",
                        textAlign: valueAlign,
                        whiteSpace: valueAlign === "right" ? "nowrap" : "normal",
                      }}
                    >
                      {value}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          );
          const copyButton = (field: SessionCopyField, value: string) => {
            const copied = copiedSessionField === field;
            return (
              <button
                type="button"
                title={
                  copied
                    ? t("copied", "Copied")
                    : field === "file"
                      ? t("copyFilePath", "Copy file path")
                      : t("copySessionId", "Copy session ID")
                }
                onClick={() => handleCopySessionField(field, value)}
                style={{
                  alignSelf: "start",
                  display: "inline-flex",
                  alignItems: "center",
                  justifyContent: "center",
                  width: 22,
                  height: 22,
                  marginTop: -2,
                  color: copied ? "var(--accent)" : "var(--text-dim)",
                  background: "transparent",
                  border: "1px solid var(--border)",
                  borderRadius: "var(--radius-sm)",
                  cursor: "pointer",
                  flex: "0 0 auto",
                  transition: "color 0.12s, border-color 0.12s, background 0.12s",
                }}
                onMouseEnter={(e) => {
                  e.currentTarget.style.color = "var(--accent)";
                  e.currentTarget.style.borderColor = "var(--accent)";
                  e.currentTarget.style.background = "var(--bg-hover)";
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.color = copied ? "var(--accent)" : "var(--text-dim)";
                  e.currentTarget.style.borderColor = "var(--border)";
                  e.currentTarget.style.background = "transparent";
                }}
              >
                {copied ? (
                  <svg
                    width="12"
                    height="12"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    aria-hidden="true"
                  >
                    <polyline points="20 6 9 17 4 12" />
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
                    aria-hidden="true"
                  >
                    <rect x="9" y="9" width="13" height="13" rx="2" ry="2" />
                    <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
                  </svg>
                )}
              </button>
            );
          };
          const sessionInfoSection = (
            <div style={{ minWidth: 0 }}>
              <div style={{ fontSize: 12, fontWeight: 700, color: "var(--text)", marginBottom: 6 }}>
                {t("sessionInfo", "Session Info")}
              </div>
              <div
                style={{
                  display: "grid",
                  gridTemplateColumns: "auto minmax(0, 1fr) auto",
                  columnGap: 12,
                  rowGap: 8,
                  alignItems: "start",
                }}
              >
                {sessionRows.map((row) => (
                  <div key={`session-info:${row.label}`} style={{ display: "contents" }}>
                    <div style={{ color: "var(--text-dim)", whiteSpace: "nowrap" }}>{row.label}</div>
                    <div
                      style={{
                        color: "var(--text-muted)",
                        minWidth: 0,
                        overflowWrap: "anywhere",
                        wordBreak: "break-word",
                        whiteSpace: "normal",
                      }}
                    >
                      {row.value}
                    </div>
                    <div>{row.copyField ? copyButton(row.copyField, row.value) : null}</div>
                  </div>
                ))}
              </div>
            </div>
          );

          return (
            <div
              style={{
                display: "grid",
                gridTemplateColumns: isMobile
                  ? "1fr"
                  : "minmax(360px, 1.7fr) minmax(140px, 0.55fr) minmax(190px, 0.75fr)",
                gap: isMobile ? 16 : 24,
                fontSize: 12,
                lineHeight: 1.5,
                fontFamily: "var(--font-mono)",
              }}
            >
              {sessionInfoSection}
              {section(t("messages", "Messages"), messageRows)}
              {section(t("tokens", "Tokens"), [...tokenRows, ...extraTokenRows], "right", true)}
            </div>
          );
        })()
      ) : (
        <div style={{ fontSize: 12, color: "var(--text-muted)", fontStyle: "italic" }}>
          {t("loadSessionInfoHint", "Send a message or run /session to load session info")}
        </div>
      )}
    </div>
  );
}
