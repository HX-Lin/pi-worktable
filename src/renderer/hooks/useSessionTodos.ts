import { useCallback, useEffect, useMemo, useState } from "react";

import { addTask, listTasks, updateTask } from "@/lib/api-client";
import { pushToast } from "@/lib/toast-store";
import type { ProjectTask, TaskStatus } from "@contract/types";

export const TASK_GLYPH: Record<TaskStatus, string> = { todo: "○", doing: "◐", blocked: "!", done: "✓" };

export const TASK_NEXT_STATUS: Record<TaskStatus, TaskStatus> = {
  todo: "doing",
  doing: "done",
  done: "todo",
  blocked: "doing",
};

/**
 * Module-level ping: ticking a task in one view has to move the checklist in the
 * other without a polling loop, and both read the same file anyway.
 */
const listeners = new Set<() => void>();

function notifyTodosChanged(): void {
  for (const listener of listeners) listener();
}

interface Params {
  cwd: string | null;
  sessionId: string | null;
  /** Bumped as the conversation moves, so agent edits appear without polling. */
  refreshKey?: number;
}

/**
 * The conversation's own todos — the same `.pi/tasks.json` the board shows,
 * filtered to this session. Shared by the strip above the composer and the
 * checklist that renders inside the message stream, so both read one source and
 * one refresh signal.
 */
export function useSessionTodos({ cwd, sessionId, refreshKey = 0 }: Params) {
  const [tasks, setTasks] = useState<ProjectTask[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

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
      const message = e instanceof Error ? e.message : String(e);
      setError(message);
      pushToast({ level: "error", text: "Could not load this conversation's todos", detail: message });
    }
  }, [cwd, sessionId]);

  useEffect(() => {
    void load();
  }, [load, refreshKey]);

  useEffect(() => {
    const listener = () => {
      void load();
    };
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  }, [load]);

  const done = useMemo(() => tasks.filter((task) => task.status === "done").length, [tasks]);

  /** Open work first, then in creation order — the order you want to read. */
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
      const status = TASK_NEXT_STATUS[task.status];
      setBusyId(task.id);
      try {
        const { task: updated } = await updateTask(cwd, task.id, { status });
        setTasks((current) => current.map((entry) => (entry.id === updated.id ? updated : entry)));
        notifyTodosChanged();
      } catch (e) {
        const message = e instanceof Error ? e.message : String(e);
        setError(message);
        pushToast({ level: "error", text: "Could not update that todo", detail: message });
      } finally {
        setBusyId(null);
      }
    },
    [cwd],
  );

  const add = useCallback(
    async (title: string) => {
      const trimmed = title.trim();
      if (!trimmed || !cwd || !sessionId) return false;
      try {
        const { task } = await addTask(cwd, trimmed, undefined, sessionId);
        setTasks((current) => [...current, task]);
        setError(null);
        notifyTodosChanged();
        return true;
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
        return false;
      }
    },
    [cwd, sessionId],
  );

  return { tasks, visible, done, error, busyId, reload: load, advance, add };
}
