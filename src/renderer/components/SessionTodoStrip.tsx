import { useCallback, useEffect, useMemo, useState } from "react";
import { addTask, listTasks, updateTask } from "@/lib/api-client";
import { useI18n } from "@/i18n";
import type { ProjectTask, TaskStatus } from "@contract/types";

interface Props {
  cwd: string | null;
  sessionId: string | null;
  /** Bumped as the conversation moves, so agent edits appear without polling. */
  refreshKey?: number;
}

const GLYPH: Record<TaskStatus, string> = { todo: "○", doing: "◐", blocked: "!", done: "✓" };
const NEXT_STATUS: Record<TaskStatus, TaskStatus> = { todo: "doing", doing: "done", done: "todo", blocked: "doing" };

/**
 * The conversation's own todos, kept right above the composer: what the agent
 * said it would do, and how far it has got. The same `.pi/tasks.json` the board
 * shows, filtered to this session.
 */
export function SessionTodoStrip({ cwd, sessionId, refreshKey = 0 }: Props) {
  const { t } = useI18n();
  const [tasks, setTasks] = useState<ProjectTask[]>([]);
  const [collapsed, setCollapsed] = useState(false);
  const [draft, setDraft] = useState("");
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!cwd || !sessionId) {
      setTasks([]);
      return;
    }
    try {
      const { tasks: listed } = await listTasks(cwd, sessionId);
      setTasks(listed);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }, [cwd, sessionId]);

  useEffect(() => {
    void load();
  }, [load, refreshKey]);

  const done = useMemo(() => tasks.filter((task) => task.status === "done").length, [tasks]);
  const visible = useMemo(
    () =>
      [...tasks].sort(
        (a, b) => Number(a.status === "done") - Number(b.status === "done") || a.createdAt.localeCompare(b.createdAt),
      ),
    [tasks],
  );

  const advance = useCallback(
    async (task: ProjectTask) => {
      if (!cwd) return;
      const status = NEXT_STATUS[task.status];
      setBusyId(task.id);
      try {
        const { task: updated } = await updateTask(cwd, task.id, { status });
        setTasks((current) => current.map((entry) => (entry.id === updated.id ? updated : entry)));
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
      } finally {
        setBusyId(null);
      }
    },
    [cwd],
  );

  const submit = useCallback(async () => {
    const title = draft.trim();
    if (!title || !cwd || !sessionId) return;
    setDraft("");
    try {
      const { task } = await addTask(cwd, title, undefined, sessionId);
      setTasks((current) => [...current, task]);
      setCollapsed(false);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }, [cwd, draft, sessionId]);

  if (!cwd || !sessionId || tasks.length === 0) return null;

  return (
    <div
      style={{
        margin: "0 0 8px",
        border: "1px solid var(--border)",
        borderRadius: "var(--radius-md)",
        background: "var(--bg-panel)",
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
        {error && <span style={{ fontSize: 10, color: "var(--danger)" }}>{error}</span>}
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
                aria-label={`${task.status} → ${NEXT_STATUS[task.status]}`}
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
                {GLYPH[task.status]}
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
