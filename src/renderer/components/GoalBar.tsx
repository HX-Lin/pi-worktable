import { useState } from "react";

import { useI18n } from "@/i18n";
import { useGoal } from "@/hooks/useGoal";
import { MAX_ROUNDS_LIMIT } from "@shared/goal-limits";

interface Props {
  sessionId: string | null;
  /** Hidden when there is nothing to attach a goal to. */
  enabled: boolean;
}

const STATUS_STYLE: Record<string, { color: string; key: string; fallback: string }> = {
  active: { color: "var(--accent)", key: "goalActive", fallback: "进行中" },
  met: { color: "var(--green)", key: "goalMet", fallback: "已达成" },
  exhausted: { color: "var(--amber)", key: "goalExhausted", fallback: "已达轮数上限" },
  stopped: { color: "var(--text-dim)", key: "goalStopped", fallback: "已停止" },
};

/**
 * Goal mode for the conversation, above the composer.
 *
 * The bar is the whole feature from the UI side: state a goal, decide whether
 * the host should keep reviewing it on its own, and read the reviewer's last
 * objection. Nothing here runs a model by itself — the host does that.
 */
export function GoalBar({ sessionId, enabled }: Props) {
  const { t } = useI18n();
  const { state, busy, error, setGoal, clearGoal } = useGoal(sessionId);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState("");
  const [rounds, setRounds] = useState(3);
  const [autoReview, setAutoReview] = useState(false);

  if (!enabled) return null;

  const submit = () => {
    const text = draft.trim();
    if (!text) {
      setEditing(false);
      return;
    }
    void setGoal(text, rounds, autoReview);
    setEditing(false);
    setDraft("");
  };

  if (!state && !editing) {
    return (
      <button
        type="button"
        data-goal-bar
        onClick={() => setEditing(true)}
        style={{
          display: "flex",
          alignItems: "center",
          gap: 6,
          margin: "0 0 8px",
          padding: "4px 10px",
          background: "var(--control-chip-bg)",
          border: "1px dashed var(--control-chip-border)",
          borderRadius: "var(--radius-md)",
          color: "var(--text-muted)",
          cursor: "pointer",
          fontSize: 11.5,
        }}
      >
        <span aria-hidden="true">◎</span>
        {t("goalSet", "设一个目标，让审查子代理每轮核对")}
      </button>
    );
  }

  if (editing) {
    return (
      <div
        data-goal-bar
        style={{
          margin: "0 0 8px",
          padding: 10,
          background: "var(--control-chip-bg)",
          border: "1px solid var(--control-chip-border)",
          borderRadius: "var(--radius-md)",
          display: "flex",
          flexDirection: "column",
          gap: 8,
        }}
      >
        <input
          autoFocus
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter") submit();
            if (event.key === "Escape") setEditing(false);
          }}
          placeholder={t("goalPlaceholder", "这个会话要达成什么？")}
          aria-label={t("goalSet", "Goal")}
          style={{
            width: "100%",
            padding: "6px 9px",
            background: "var(--menu-bg)",
            border: "1px solid var(--border)",
            borderRadius: "var(--radius-sm)",
            color: "var(--text)",
            fontSize: 12.5,
          }}
        />
        <div style={{ display: "flex", alignItems: "center", gap: 12, fontSize: 11.5, color: "var(--text-muted)" }}>
          <label style={{ display: "flex", alignItems: "center", gap: 5 }}>
            {t("goalMaxRounds", "最多审查")}
            <select
              value={rounds}
              onChange={(event) => setRounds(Number(event.target.value))}
              style={{
                background: "var(--menu-bg)",
                color: "var(--text)",
                border: "1px solid var(--border)",
                borderRadius: "var(--radius-sm)",
                padding: "2px 4px",
              }}
            >
              {Array.from({ length: MAX_ROUNDS_LIMIT }, (_, index) => index + 1).map((value) => (
                <option key={value} value={value}>
                  {value}
                </option>
              ))}
            </select>
            {t("goalRounds", "轮")}
          </label>
          <label style={{ display: "flex", alignItems: "center", gap: 5 }}>
            <input type="checkbox" checked={autoReview} onChange={(event) => setAutoReview(event.target.checked)} />
            {t("goalAutoReview", "每轮自动审查并继续（会消耗 token）")}
          </label>
          <button
            type="button"
            onClick={submit}
            style={{
              marginLeft: "auto",
              padding: "4px 12px",
              background: "var(--accent)",
              color: "var(--on-accent)",
              border: "none",
              borderRadius: "var(--radius-sm)",
              cursor: "pointer",
              fontSize: 11.5,
            }}
          >
            {t("goalStart", "开始")}
          </button>
        </div>
      </div>
    );
  }

  const status = STATUS_STYLE[state?.status ?? "stopped"] ?? STATUS_STYLE.stopped;
  return (
    <div
      data-goal-bar
      style={{
        margin: "0 0 8px",
        padding: "6px 10px",
        background: "var(--control-chip-bg)",
        border: "1px solid var(--control-chip-border)",
        borderRadius: "var(--radius-md)",
        display: "flex",
        flexDirection: "column",
        gap: 3,
        fontSize: 11.5,
        color: "var(--control-chip-fg)",
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
        <span aria-hidden="true" style={{ color: status.color }}>
          ◎
        </span>
        <span style={{ fontWeight: 600, flex: 1, minWidth: 0, overflowWrap: "anywhere" }}>{state?.text}</span>
        <span style={{ color: status.color, flexShrink: 0 }}>{t(status.key, status.fallback)}</span>
        <span style={{ color: "var(--text-dim)", flexShrink: 0, fontVariantNumeric: "tabular-nums" }}>
          {state?.rounds}/{state?.maxRounds}
        </span>
        {state?.autoReview && (
          <span style={{ color: "var(--text-faint)", flexShrink: 0 }}>{t("goalAuto", "自动审查")}</span>
        )}
        <button
          type="button"
          onClick={() => {
            setDraft(state?.text ?? "");
            setRounds(state?.maxRounds ?? 3);
            setAutoReview(state?.autoReview ?? false);
            setEditing(true);
          }}
          style={LINK_BUTTON}
        >
          {t("edit", "编辑")}
        </button>
        <button type="button" onClick={() => void clearGoal()} disabled={busy} style={LINK_BUTTON}>
          {t("goalClear", "清除")}
        </button>
      </div>
      {state?.lastReason && <div style={{ color: "var(--text-muted)", paddingLeft: 20 }}>{state.lastReason}</div>}
      {error && <div style={{ color: "var(--red)", paddingLeft: 20 }}>{error}</div>}
    </div>
  );
}

const LINK_BUTTON: React.CSSProperties = {
  flexShrink: 0,
  background: "transparent",
  border: "none",
  color: "var(--accent)",
  cursor: "pointer",
  fontSize: 11,
  padding: 0,
};
