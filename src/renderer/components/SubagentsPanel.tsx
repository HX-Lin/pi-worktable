import { useEffect, useState } from "react";

import { useI18n } from "@/i18n";
import { useSubagentRuns, type SubagentRun } from "@/hooks/useSubagentRuns";

const STATUS_TONE: Record<SubagentRun["status"], { color: string; label: string }> = {
  running: { color: "var(--accent)", label: "running" },
  done: { color: "var(--green)", label: "done" },
  failed: { color: "var(--red)", label: "failed" },
  cancelled: { color: "var(--text-dim)", label: "cancelled" },
};

function formatElapsed(run: SubagentRun, now: number): string {
  const end = run.finishedAt ?? now;
  const seconds = Math.max(0, Math.round((end - run.startedAt) / 1000));
  if (seconds < 60) return `${String(seconds)}s`;
  const minutes = Math.floor(seconds / 60);
  return `${String(minutes)}m ${String(seconds % 60)}s`;
}

/**
 * What the subagent tool is doing right now: which agent, on which model, for how
 * long, and the last line it streamed.
 */
export function SubagentsPanel() {
  const { t } = useI18n();
  const { runs, error } = useSubagentRuns(true);
  const [now, setNow] = useState(() => Date.now());

  // Only ticks while something is running, so the elapsed column stays honest.
  useEffect(() => {
    if (!runs.some((run) => run.status === "running")) return;
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [runs]);

  return (
    <div style={{ height: "100%", overflow: "auto", padding: "10px 12px" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8 }}>
        <span style={{ fontSize: 12, fontWeight: 600, color: "var(--text)" }}>{t("subagentsTitle", "Subagents")}</span>
        <span style={{ fontSize: 11, color: "var(--text-dim)", fontVariantNumeric: "tabular-nums" }}>
          {runs.filter((run) => run.status === "running").length} {t("running", "running")} · {runs.length}{" "}
          {t("subagentTotal", "total")}
        </span>
      </div>

      {error && <div style={{ fontSize: 11, color: "var(--danger)", marginBottom: 8 }}>{error}</div>}

      {runs.length === 0 ? (
        <div style={{ fontSize: 11.5, color: "var(--text-dim)", padding: "8px 0" }}>
          {t("subagentsEmpty", "No subagent has run in this app session yet.")}
        </div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
          {runs.map((run) => {
            const tone = STATUS_TONE[run.status];
            return (
              <div
                key={run.id}
                style={{
                  border: "1px solid var(--border)",
                  borderLeft: `3px solid ${tone.color}`,
                  borderRadius: "var(--radius-md)",
                  background: "var(--bg-panel)",
                  padding: "7px 9px",
                }}
              >
                <div style={{ display: "flex", alignItems: "center", gap: 7, fontSize: 12 }}>
                  <span style={{ fontWeight: 600, color: "var(--text)" }}>{run.agent}</span>
                  <span style={{ color: tone.color, fontSize: 10.5 }}>{tone.label}</span>
                  <span style={{ marginLeft: "auto", color: "var(--text-dim)", fontSize: 10.5 }}>
                    {formatElapsed(run, now)}
                  </span>
                </div>
                <div style={{ marginTop: 3, fontSize: 11.5, color: "var(--text-muted)", overflowWrap: "anywhere" }}>
                  {run.task}
                </div>
                <div style={{ marginTop: 3, display: "flex", gap: 8, fontSize: 10.5, color: "var(--text-faint)" }}>
                  {run.model && <span style={{ fontFamily: "var(--font-mono)" }}>{run.model}</span>}
                  {typeof run.tokens === "number" && run.tokens > 0 && (
                    <span style={{ fontVariantNumeric: "tabular-nums" }}>{run.tokens.toLocaleString()} tok</span>
                  )}
                </div>
                {run.status === "failed" && run.error && (
                  <div style={{ marginTop: 3, fontSize: 11, color: "var(--danger)", overflowWrap: "anywhere" }}>
                    {run.error}
                  </div>
                )}
                {run.status !== "failed" && run.lastLine && (
                  <div
                    style={{
                      marginTop: 4,
                      fontSize: 11,
                      color: "var(--text-dim)",
                      fontFamily: "var(--font-mono)",
                      overflow: "hidden",
                      textOverflow: "ellipsis",
                      whiteSpace: "nowrap",
                    }}
                  >
                    {run.lastLine}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
