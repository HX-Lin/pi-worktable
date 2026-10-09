import { useCallback, useEffect, useMemo, useState } from "react";
import { addTask, listTasks, removeTask, updateTask } from "@/lib/api-client";
import { useI18n } from "@/i18n";
import type { ProjectTask, TaskStatus } from "@contract/types";

const COLUMNS: { id: TaskStatus; labelKey: string; label: string }[] = [
  { id: "todo", labelKey: "taskTodo", label: "To do" },
  { id: "doing", labelKey: "taskDoing", label: "In progress" },
  { id: "blocked", labelKey: "taskBlocked", label: "Blocked" },
  { id: "done", labelKey: "taskDone", label: "Done" },
];

/** Per-project board: the same `.pi/tasks.json` the agent's `task` tool edits. */
export function TaskBoard({ cwd }: { cwd: string | null }) {
  const { t } = useI18n();
  const [tasks, setTasks] = useState<ProjectTask[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  const [busyId, setBusyId] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!cwd) {
      setTasks([]);
      setLoading(false);
      return;
    }
    setError(null);
    try {
      const { tasks: listed } = await listTasks(cwd);
      setTasks(listed);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, [cwd]);

  useEffect(() => {
    setLoading(true);
    void load();
  }, [load]);

  const grouped = useMemo(() => {
    const byStatus = new Map<TaskStatus, ProjectTask[]>(COLUMNS.map((column) => [column.id, []]));
    for (const task of tasks) byStatus.get(task.status)?.push(task);
    return byStatus;
  }, [tasks]);

  const submitDraft = useCallback(async () => {
    const title = draft.trim();
    if (!title || !cwd) return;
    setDraft("");
    try {
      const { task } = await addTask(cwd, title);
      setTasks((current) => [...current, task]);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }, [cwd, draft]);

  const move = useCallback(
    async (task: ProjectTask, status: TaskStatus) => {
      if (!cwd || task.status === status) return;
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

  const remove = useCallback(
    async (task: ProjectTask) => {
      if (!cwd) return;
      setBusyId(task.id);
      try {
        await removeTask(cwd, task.id);
        setTasks((current) => current.filter((entry) => entry.id !== task.id));
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
      } finally {
        setBusyId(null);
      }
    },
    [cwd],
  );

  if (!cwd) {
    return (
      <div style={{ padding: 12, fontSize: 12, color: "var(--text-dim)" }}>
        {t("tasksNoProject", "Open a project to see its task board.")}
      </div>
    );
  }

  return (
    <div style={{ height: "100%", display: "flex", flexDirection: "column", overflow: "hidden" }}>
      <div style={{ display: "flex", gap: 6, padding: "10px 12px", borderBottom: "1px solid var(--border)" }}>
        <input
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") void submitDraft();
          }}
          placeholder={t("tasksAddPlaceholder", "Add a task…")}
          style={{
            flex: 1,
            minWidth: 0,
            padding: "6px 8px",
            fontSize: 12,
            borderRadius: "var(--radius-sm)",
            background: "var(--view-bg)",
            color: "var(--text)",
            border: "1px solid var(--border)",
          }}
        />
        <button
          type="button"
          onClick={() => void submitDraft()}
          disabled={!draft.trim()}
          style={{
            padding: "6px 12px",
            fontSize: 12,
            borderRadius: "var(--radius-sm)",
            border: "1px solid var(--border)",
            background: "var(--bg-hover)",
            color: "var(--text)",
            cursor: draft.trim() ? "pointer" : "default",
          }}
        >
          {t("tasksAdd", "Add")}
        </button>
      </div>

      {error && (
        <div style={{ padding: "6px 12px", fontSize: 11, color: "var(--danger)" }} role="alert">
          {error}
        </div>
      )}

      {loading ? (
        <div style={{ padding: 12, fontSize: 12, color: "var(--text-dim)" }}>{t("loading", "Loading…")}</div>
      ) : tasks.length === 0 ? (
        <div style={{ padding: 12, fontSize: 12, color: "var(--text-dim)", lineHeight: 1.6 }}>
          {t(
            "tasksEmpty",
            "No tasks yet. The agent can add them with the `task` tool, or add one above — the board is stored in .pi/tasks.json.",
          )}
        </div>
      ) : (
        <div
          style={{
            flex: 1,
            overflowY: "auto",
            padding: "10px 12px",
            display: "flex",
            flexDirection: "column",
            gap: 12,
          }}
        >
          {COLUMNS.map((column) => {
            const columnTasks = grouped.get(column.id) ?? [];
            if (columnTasks.length === 0 && column.id !== "todo") return null;
            return (
              <div key={column.id} style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                <div style={{ fontSize: 11, color: "var(--text-dim)", textTransform: "uppercase", letterSpacing: 0.4 }}>
                  {t(column.labelKey, column.label)} · {columnTasks.length}
                </div>
                {columnTasks.map((task) => (
                  <div
                    key={task.id}
                    style={{
                      display: "flex",
                      flexDirection: "column",
                      gap: 6,
                      padding: "8px 10px",
                      borderRadius: "var(--radius-sm)",
                      background: "var(--bg-panel)",
                      border: "1px solid var(--border)",
                      opacity: busyId === task.id ? 0.6 : 1,
                    }}
                  >
                    <div
                      style={{
                        fontSize: 12,
                        color: task.status === "done" ? "var(--text-muted)" : "var(--text)",
                        lineHeight: 1.5,
                      }}
                    >
                      {task.status === "done" ? "✓ " : ""}
                      {task.title}
                    </div>
                    {task.notes && (
                      <div style={{ fontSize: 11, color: "var(--text-muted)", lineHeight: 1.5 }}>{task.notes}</div>
                    )}
                    <div style={{ display: "flex", alignItems: "center", gap: 4, flexWrap: "wrap" }}>
                      {COLUMNS.filter((option) => option.id !== task.status).map((option) => (
                        <button
                          key={option.id}
                          type="button"
                          onClick={() => void move(task, option.id)}
                          style={{
                            padding: "2px 7px",
                            fontSize: 10,
                            borderRadius: 999,
                            border: "1px solid var(--border)",
                            background: "transparent",
                            color: "var(--text-muted)",
                            cursor: "pointer",
                          }}
                        >
                          → {t(option.labelKey, option.label)}
                        </button>
                      ))}
                      <button
                        type="button"
                        onClick={() => void remove(task)}
                        title={t("tasksRemove", "Delete task")}
                        style={{
                          marginLeft: "auto",
                          padding: "2px 7px",
                          fontSize: 10,
                          borderRadius: 999,
                          border: "1px solid var(--border)",
                          background: "transparent",
                          color: "var(--danger)",
                          cursor: "pointer",
                        }}
                      >
                        ✕
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
