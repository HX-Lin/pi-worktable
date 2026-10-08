import { useEffect, useState } from "react";

import { useI18n } from "@/i18n";
import { useSubagentRuns, type SubagentRun } from "@/hooks/useSubagentRuns";

const STATUS_COLOR: Record<SubagentRun["status"], string> = {
  running: "var(--accent)",
  done: "var(--green)",
  failed: "var(--red)",
  cancelled: "var(--text-dim)",
};

function formatElapsed(run: SubagentRun, now: number): string {
  const seconds = Math.max(0, Math.round(((run.finishedAt ?? now) - run.startedAt) / 1000));
  if (seconds < 60) return `${String(seconds)}s`;
  return `${String(Math.floor(seconds / 60))}m ${String(seconds % 60)}s`;
}

/**
 * Subagents are rare but long-running, so this is not a permanent panel: it
 * appears above the composer the moment one is dispatched, counts down while it
 * works, and disappears once nothing is running. Expand it for the detail.
 */
export function RunningSubagentsBar() {
  const { t } = useI18n();
  const { runs } = useSubagentRuns(true);
  const [expanded, setExpanded] = useState(false);
  const [now, setNow] = useState(() => Date.now());

  const running = runs.filter((run) => run.status === "running");
  const recent = runs.filter((run) => run.status !== "running").slice(0, 3);
  const visible = expanded ? runs : running;

  useEffect(() => {
    if (running.length === 0) return;
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [running.length]);

  // The host keeps finished runs for a few minutes, so the strip lingers after the
  // last subagent ends — long enough to read what it produced — then disappears.
  if (runs.length === 0) return null;

  return (
    <div
      data-running-subagents
      style={{
        margin: "0 0 8px",
        border: "1px solid var(--control-chip-border)",
        borderRadius: "var(--radius-md)",
        background: "var(--control-chip-bg)",
        overflow: "hidden",
      }}
    >
      <button
        type="button"
        onClick={() => setExpanded((value) => !value)}
        aria-expanded={expanded}
        style={{
          display: "flex",
          alignItems: "center",
          gap: 8,
          width: "100%",
          padding: "6px 10px",
          background: "transparent",
          border: "none",
          color: "var(--control-chip-fg)",
          cursor: "pointer",
          fontSize: 11.5,
          textAlign: "left",
        }}
      >
        <span
          aria-hidden="true"
          style={{
            width: 6,
            height: 6,
            borderRadius: 999,
            background: running.length > 0 ? "var(--accent)" : "var(--green)",
            ...(running.length > 0 ? { animation: "pulse 1.5s infinite" } : {}),
            flexShrink: 0,
          }}
        />
        <span style={{ fontWeight: 600 }}>{t("subagentsTitle", "Subagents")}</span>
        <span style={{ color: "var(--text-muted)", fontVariantNumeric: "tabular-nums" }}>
          {running.length > 0
            ? `${String(running.length)} ${t("running", "running")}`
            : `${String(recent.length)} ${t("subagentsRecentDone", "finished")}`}
        </span>
        <span
          style={{
            flex: 1,
            minWidth: 0,
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
            color: "var(--text-dim)",
            fontFamily: "var(--font-mono)",
          }}
        >
          {(running.length > 0 ? running : recent).map((run) => `${run.agent} ${formatElapsed(run, now)}`).join(" · ")}
        </span>
        <span style={{ color: "var(--text-dim)", flexShrink: 0 }}>{expanded ? "▾" : "▸"}</span>
      </button>

      {expanded && (
        <div style={{ padding: "0 10px 8px", display: "flex", flexDirection: "column", gap: 5 }}>
          {visible.map((run) => (
            <div key={run.id} style={{ display: "flex", alignItems: "flex-start", gap: 7, fontSize: 11.5 }}>
              <span
                aria-hidden="true"
                style={{
                  marginTop: 5,
                  width: 5,
                  height: 5,
                  borderRadius: 999,
                  background: STATUS_COLOR[run.status],
                  flexShrink: 0,
                }}
              />
              <span style={{ fontWeight: 600, color: run.status === "running" ? "var(--text)" : "var(--text-dim)" }}>
                {run.agent}
              </span>
              <span style={{ color: "var(--text-muted)", minWidth: 0, overflowWrap: "anywhere" }}>{run.task}</span>
              <span style={{ marginLeft: "auto", color: "var(--text-dim)", flexShrink: 0 }}>
                {formatElapsed(run, now)}
              </span>
            </div>
          ))}
          {recent.length > 0 && (
            <div style={{ fontSize: 10.5, color: "var(--text-faint)" }}>
              {t("subagentsRecent", "recent")}: {recent.map((run) => run.agent).join(", ")}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
