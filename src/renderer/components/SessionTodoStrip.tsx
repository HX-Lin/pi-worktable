import { useState } from "react";
import { useI18n } from "@/i18n";
import { TASK_GLYPH, TASK_NEXT_STATUS, useSessionTodos } from "@/hooks/useSessionTodos";

interface Props {
  cwd: string | null;
  sessionId: string | null;
  /** Bumped as the conversation moves, so agent edits appear without polling. */
  refreshKey?: number;
}

/**
 * The conversation's own todos, kept right above the composer: what the agent
 * said it would do, and how far it has got. The same `.pi/tasks.json` the board
 * shows, filtered to this session — and the same hook the checklist inside the
 * message stream reads, so ticking here moves it there.
 */
export function SessionTodoStrip({ cwd, sessionId, refreshKey = 0 }: Props) {
  const { t } = useI18n();
  const [collapsed, setCollapsed] = useState(false);
  const [draft, setDraft] = useState("");
  const { tasks, visible, done, busyId, advance, add } = useSessionTodos({ cwd, sessionId, refreshKey });

  const submit = async () => {
    const title = draft.trim();
    if (!title) return;
    setDraft("");
    if (await add(title)) setCollapsed(false);
  };

  if (!cwd || !sessionId || tasks.length === 0) return null;

  return (
    <div
      style={{
        margin: "0 0 8px",
        border: "1px solid var(--control-chip-border)",
        borderRadius: "var(--radius-md)",
        background: "var(--control-chip-bg)",
        overflow: "hidden",
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "6px 10px" }}>
        <button
          type="button"
          onClick={() => setCollapsed((value) => !value)}
          aria-expanded={!collapsed}
          style={{
            display: "flex",
            alignItems: "center",
            gap: 6,
            flex: 1,
            minWidth: 0,
            background: "transparent",
            border: "none",
            color: "var(--text-muted)",
            cursor: "pointer",
            fontSize: 11,
            padding: 0,
            textAlign: "left",
          }}
        >
          <span style={{ transform: collapsed ? "rotate(-90deg)" : "none", transition: "transform 0.12s" }}>▾</span>
          <span style={{ color: "var(--text)" }}>{t("sessionTodos", "Todos")}</span>
          <span style={{ fontVariantNumeric: "tabular-nums" }}>
            {done}/{tasks.length} {t("sessionTodosDone", "done")}
          </span>
        </button>
      </div>

      {!collapsed && (
        <div style={{ padding: "0 10px 8px", display: "flex", flexDirection: "column", gap: 2 }}>
          {visible.map((task) => (
            <div key={task.id} style={{ display: "flex", alignItems: "flex-start", gap: 6, padding: "2px 0" }}>
              <button
                type="button"
                onClick={() => void advance(task)}
                disabled={busyId === task.id}
                title={t("sessionTodosAdvance", "Advance status")}
                aria-label={`${task.status} → ${TASK_NEXT_STATUS[task.status]}`}
                style={{
                  flexShrink: 0,
                  width: 16,
                  background: "transparent",
                  border: "none",
                  color:
                    task.status === "done"
                      ? "var(--accent)"
                      : task.status === "doing"
                        ? "var(--text)"
                        : "var(--text-dim)",
                  cursor: "pointer",
                  fontSize: 12,
                  lineHeight: "16px",
                  padding: 0,
                }}
              >
                {TASK_GLYPH[task.status]}
              </button>
              <span
                style={{
                  fontSize: 12,
                  lineHeight: "16px",
                  color: task.status === "done" ? "var(--text-dim)" : "var(--text)",
                  textDecoration: task.status === "done" ? "line-through" : "none",
                  wordBreak: "break-word",
                }}
              >
                {task.title}
              </span>
            </div>
          ))}

          <input
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") void submit();
            }}
            placeholder={t("sessionTodosAdd", "Add a todo for this conversation…")}
            style={{
              marginTop: 4,
              padding: "4px 6px",
              fontSize: 11,
              borderRadius: "var(--radius-sm)",
              background: "var(--bg)",
              color: "var(--text)",
              border: "1px solid var(--border)",
            }}
          />
        </div>
      )}
    </div>
  );
}
