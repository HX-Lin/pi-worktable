import { useEffect, useMemo, useState } from "react";

import { useI18n } from "@/i18n";
import { getSession } from "@/lib/api-client";
import {
  buildTrajectory,
  formatDuration,
  spanGeometry,
  type TrajectoryKind,
  type TrajectorySpan,
} from "@/lib/trajectory";
import type { AgentMessage } from "@shared/types";

const KIND_COLOR: Record<TrajectoryKind, string> = {
  user: "var(--blue)",
  answer: "var(--accent)",
  tool: "var(--green)",
  custom: "var(--text-dim)",
  error: "var(--red)",
};

const KIND_LABEL: Record<TrajectoryKind, string> = {
  user: "用户",
  answer: "回答",
  tool: "工具",
  custom: "自定义",
  error: "错误",
};

interface Props {
  sessionId: string | null;
  refreshKey: number;
}

/**
 * What actually happened in a conversation, from the transcript itself: a
 * timeline of steps and the tool calls inside them. Timings come from message
 * and tool-result timestamps, so nothing here is estimated.
 */
export function TrajectoryView({ sessionId, refreshKey }: Props) {
  const { t } = useI18n();
  const [messages, setMessages] = useState<AgentMessage[]>([]);
  const [selected, setSelected] = useState<TrajectorySpan | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!sessionId) {
      setMessages([]);
      return;
    }
    let cancelled = false;
    setLoading(true);
    setError(null);
    void getSession(sessionId, false)
      .then((detail) => {
        if (cancelled) return;
        setMessages((detail.context?.messages ?? []) as AgentMessage[]);
      })
      .catch((cause: unknown) => {
        if (cancelled) return;
        setMessages([]);
        setError(cause instanceof Error ? cause.message : String(cause));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [sessionId, refreshKey]);

  const summary = useMemo(() => buildTrajectory(messages), [messages]);
  const window = useMemo(() => {
    const first = summary.spans[0]?.start ?? 0;
    const last = summary.spans.reduce((max, span) => Math.max(max, span.end), first);
    return { start: first, end: last };
  }, [summary]);

  if (!sessionId) {
    return <div style={EMPTY_STYLE}>{t("trajectoryNoSession", "Open a conversation to see its trajectory")}</div>;
  }
  if (loading && summary.spans.length === 0) {
    return <div style={EMPTY_STYLE}>{t("loading", "Loading…")}</div>;
  }
  if (error) {
    return <div style={{ ...EMPTY_STYLE, color: "var(--red)" }}>{error}</div>;
  }
  if (summary.spans.length === 0) {
    return <div style={EMPTY_STYLE}>{t("trajectoryEmpty", "This conversation has no timed entries yet")}</div>;
  }

  return (
    <div style={{ height: "100%", display: "flex", flexDirection: "column", background: "var(--bg)" }}>
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 16,
          flexWrap: "wrap",
          padding: "10px 14px",
          borderBottom: "1px solid var(--border)",
          fontSize: 11.5,
          color: "var(--text-muted)",
          flexShrink: 0,
        }}
      >
        <Stat label={t("trajectoryTotal", "总时长")} value={formatDuration(summary.totalMs)} />
        <Stat
          label={t("trajectoryTools", "工具")}
          value={`${formatDuration(summary.toolMs)} · ${String(summary.toolCount)}`}
        />
        <Stat label={t("trajectorySteps", "步骤")} value={String(summary.spans.length)} />
        {summary.errorCount > 0 && <Stat label={t("trajectoryErrors", "失败")} value={String(summary.errorCount)} />}
        <span style={{ marginLeft: "auto", display: "flex", gap: 10 }}>
          {(["user", "answer", "tool"] as const).map((kind) => (
            <span key={kind} style={{ display: "flex", alignItems: "center", gap: 5 }}>
              <span style={{ width: 8, height: 8, borderRadius: 2, background: KIND_COLOR[kind] }} />
              {KIND_LABEL[kind]}
            </span>
          ))}
        </span>
      </div>

      {/* Timeline: one row per kind, bars positioned by timestamp. */}
      <div style={{ padding: "10px 14px", borderBottom: "1px solid var(--border)", flexShrink: 0 }}>
        {(["user", "answer", "tool"] as const).map((kind) => (
          <div key={kind} style={{ display: "flex", alignItems: "center", gap: 8, height: 18 }}>
            <span style={{ width: 32, fontSize: 10.5, color: "var(--text-faint)" }}>{KIND_LABEL[kind]}</span>
            <div style={{ position: "relative", flex: 1, height: 10, background: "var(--sunken-bg)", borderRadius: 3 }}>
              {summary.spans
                .filter((span) => span.kind === kind)
                .map((span, index) => {
                  const geometry = spanGeometry(span, window);
                  return (
                    <span
                      key={`${span.label}-${String(span.start)}-${String(index)}`}
                      title={`${span.label} · ${formatDuration(span.end - span.start)}`}
                      style={{
                        position: "absolute",
                        left: `${String(geometry.left)}%`,
                        width: `${String(geometry.width)}%`,
                        top: 0,
                        bottom: 0,
                        borderRadius: 3,
                        background: span.isError ? KIND_COLOR.error : KIND_COLOR[kind],
                        opacity: selected === span ? 1 : 0.85,
                      }}
                    />
                  );
                })}
            </div>
          </div>
        ))}
      </div>

      <div style={{ flex: 1, minHeight: 0, display: "flex" }}>
        <div style={{ flex: 1, minWidth: 0, overflowY: "auto" }}>
          {summary.spans.map((span, index) => {
            const active = selected === span;
            return (
              <button
                key={`${span.kind}-${String(span.start)}-${String(index)}`}
                type="button"
                onClick={() => setSelected(active ? null : span)}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 8,
                  width: "100%",
                  padding: "5px 14px",
                  border: "none",
                  background: active ? "var(--bg-selected)" : "transparent",
                  color: "var(--text)",
                  cursor: "pointer",
                  textAlign: "left",
                  font: "inherit",
                  fontSize: 11.5,
                }}
              >
                <span
                  style={{
                    width: 46,
                    flexShrink: 0,
                    fontSize: 10.5,
                    color: "var(--text-faint)",
                    fontVariantNumeric: "tabular-nums",
                  }}
                >
                  {new Date(span.start).toLocaleTimeString([], {
                    hour: "2-digit",
                    minute: "2-digit",
                    second: "2-digit",
                  })}
                </span>
                <span
                  style={{
                    flexShrink: 0,
                    padding: "1px 5px",
                    borderRadius: 4,
                    fontSize: 10,
                    color: span.isError ? KIND_COLOR.error : KIND_COLOR[span.kind],
                    background: "color-mix(in srgb, currentColor 14%, transparent)",
                  }}
                >
                  {span.isError ? "失败" : KIND_LABEL[span.kind]}
                </span>
                <span
                  style={{
                    flexShrink: 0,
                    fontWeight: 600,
                    maxWidth: 140,
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                  }}
                >
                  {span.label}
                </span>
                <span
                  style={{
                    flex: 1,
                    minWidth: 0,
                    color: "var(--text-muted)",
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                    whiteSpace: "nowrap",
                  }}
                >
                  {span.preview || "—"}
                </span>
                <span
                  style={{
                    flexShrink: 0,
                    color: "var(--text-dim)",
                    fontVariantNumeric: "tabular-nums",
                    fontSize: 10.5,
                  }}
                >
                  {formatDuration(span.end - span.start)}
                </span>
              </button>
            );
          })}
        </div>

        {selected && (
          <div
            style={{
              width: 360,
              flexShrink: 0,
              borderLeft: "1px solid var(--border)",
              overflowY: "auto",
              padding: "10px 12px",
            }}
          >
            <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8 }}>
              <span style={{ fontWeight: 600, fontSize: 12 }}>{selected.label}</span>
              <span style={{ fontSize: 10.5, color: "var(--text-faint)" }}>
                {formatDuration(selected.end - selected.start)}
              </span>
              <button
                type="button"
                onClick={() => setSelected(null)}
                style={{
                  marginLeft: "auto",
                  border: "none",
                  background: "transparent",
                  color: "var(--text-dim)",
                  cursor: "pointer",
                  fontSize: 12,
                }}
              >
                ✕
              </button>
            </div>
            <pre
              style={{
                margin: 0,
                padding: 10,
                background: "var(--code-bg)",
                color: "var(--code-text)",
                borderRadius: "var(--radius-sm)",
                fontSize: 11,
                lineHeight: 1.5,
                whiteSpace: "pre-wrap",
                overflowWrap: "anywhere",
                fontFamily: "var(--font-mono)",
              }}
            >
              {selected.detail ?? selected.preview ?? ""}
            </pre>
          </div>
        )}
      </div>
    </div>
  );
}

const EMPTY_STYLE: React.CSSProperties = {
  height: "100%",
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  color: "var(--text-dim)",
  fontSize: 12,
};

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <span style={{ display: "flex", alignItems: "baseline", gap: 5 }}>
      <span style={{ color: "var(--text-faint)" }}>{label}</span>
      <span style={{ color: "var(--text)", fontVariantNumeric: "tabular-nums" }}>{value}</span>
    </span>
  );
}
