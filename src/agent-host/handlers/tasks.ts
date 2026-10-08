import { RpcError } from "../../contract/types";
import type { ApiHandlerSet } from "../../contract/rpc";
import { addTask, readTasks, removeTask, updateTask, type TaskStatus } from "../tasks/store";
import type { HandlerContext } from "./types";

/**
 * The project task board, as seen by the desktop UI. The agent edits the same
 * file through the `task` tool.
 */
export function taskHandlers(_ctx: HandlerContext) {
  return {
    "tasks.list": (params) => {
      const { cwd, sessionId } = params as { cwd: string; sessionId?: string };
      if (!cwd) throw new RpcError({ code: "BAD_REQUEST", message: "cwd is required" });
      const tasks = readTasks(cwd);
      return { tasks: sessionId ? tasks.filter((task) => task.sessionId === sessionId) : tasks };
    },

    "tasks.add": (params) => {
      const { cwd, title, notes, status, sessionId } = params as {
        cwd: string;
        title: string;
        notes?: string;
        status?: TaskStatus;
        sessionId?: string;
      };
      if (!cwd || !title?.trim()) {
        throw new RpcError({ code: "BAD_REQUEST", message: "cwd and title are required" });
      }
      return { task: addTask(cwd, { title, notes, status, sessionId }) };
    },

    "tasks.update": (params) => {
      const { cwd, id, title, notes, status } = params as {
        cwd: string;
        id: string;
        title?: string;
        notes?: string;
        status?: TaskStatus;
      };
      if (!cwd || !id) throw new RpcError({ code: "BAD_REQUEST", message: "cwd and id are required" });
      const task = updateTask(cwd, { id, title, notes, status });
      if (!task) throw new RpcError({ code: "NOT_FOUND", message: "Task not found" });
      return { task };
    },

    "tasks.remove": (params) => {
      const { cwd, id } = params as { cwd: string; id: string };
      if (!cwd || !id) throw new RpcError({ code: "BAD_REQUEST", message: "cwd and id are required" });
      return { ok: removeTask(cwd, id) as true };
    },
  } satisfies Partial<ApiHandlerSet>;
}
