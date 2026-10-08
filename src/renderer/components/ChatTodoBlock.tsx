import { useI18n } from "@/i18n";
import { TASK_GLYPH, useSessionTodos } from "@/hooks/useSessionTodos";

interface Props {
  cwd: string | null;
  sessionId: string | null;
  /** Bumped as the conversation moves, so agent edits appear without polling. */
  refreshKey?: number;
}

/**
 * The conversation's checklist, rendered in the message stream the way the pi
 * TUI shows it: open work first, struck through as it lands. Read-only — the
 * strip above the composer is where you tick things off.
 */
export function ChatTodoBlock({ cwd, sessionId, refreshKey = 0 }: Props) {
  const { t } = useI18n();
  const { visible, done } = useSessionTodos({ cwd, sessionId, refreshKey });
  if (visible.length === 0) return null;

  const total = visible.length;
  const percent = Math.round((done / total) * 100);
  const allDone = done === total;

  return (
    <div
      data-chat-todos
      style={{
        margin: "10px 0 4px",
        border: `1px solid ${allDone ? "color-mix(in srgb, var(--green) 45%, transparent)" : "var(--border)"}`,
        borderRadius: "var(--radius-md)",
        background: "var(--bg-panel)",
        overflow: "hidden",
      }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 8,
          padding: "6px 10px",
          borderBottom: "1px solid var(--border-soft)",
          fontSize: 11.5,
        }}
      >
        <span style={{ color: allDone ? "var(--green)" : "var(--accent)", fontWeight: 600 }}>
          {t("todos", "Todos")}
        </span>
        <span style={{ color: "var(--text-muted)", fontVariantNumeric: "tabular-nums" }}>
          {done}/{total}
        </span>
        <span
          aria-hidden="true"
          style={{
            flex: 1,
            height: 3,
            borderRadius: 2,
            background: "var(--bg-subtle)",
            overflow: "hidden",
            minWidth: 40,
          }}
        >
          <span
            style={{
              display: "block",
              width: `${String(percent)}%`,
              height: "100%",
              background: allDone ? "var(--green)" : "var(--accent)",
              transition: "width 0.2s",
            }}
          />
        </span>
      </div>
      <div style={{ padding: "5px 10px 7px", display: "flex", flexDirection: "column", gap: 2 }}>
        {visible.map((task, index) => (
          <div key={task.id} style={{ display: "flex", alignItems: "flex-start", gap: 7, fontSize: 12 }}>
            <span
              style={{
                color:
                  task.status === "done"
                    ? "var(--green)"
                    : task.status === "doing"
                      ? "var(--accent)"
                      : task.status === "blocked"
                        ? "var(--red)"
                        : "var(--text-faint)",
                flexShrink: 0,
                width: 12,
                textAlign: "center",
              }}
            >
              {TASK_GLYPH[task.status]}
            </span>
            <span style={{ color: "var(--text-faint)", flexShrink: 0, fontVariantNumeric: "tabular-nums" }}>
              {index + 1}.
            </span>
            <span
              style={{
                color: task.status === "done" ? "var(--text-faint)" : "var(--text)",
                textDecoration: task.status === "done" ? "line-through" : "none",
                minWidth: 0,
                overflowWrap: "anywhere",
              }}
            >
              {task.title}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}
