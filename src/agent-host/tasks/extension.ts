/**
 * The `task` tool: a per-project board the model maintains while it works.
 *
 * The board is the durable version of "what am I doing next" — it survives the
 * session, so a later session (or a subagent) can pick the work up.
 */
import { Type } from "typebox";
import type { ExtensionAPI, InlineExtension } from "@earendil-works/pi-coding-agent";
import { TASK_STATUSES, addTask, readTasks, removeTask, updateTask, type TaskStatus } from "./store";

const TaskParams = Type.Object({
  action: Type.Union([Type.Literal("list"), Type.Literal("add"), Type.Literal("update"), Type.Literal("remove")], {
    description: "list, add, update or remove",
  }),
  id: Type.Optional(Type.String({ description: "Task id (update/remove)" })),
  title: Type.Optional(Type.String({ description: "Task title (add/update)" })),
  notes: Type.Optional(Type.String({ description: "Free-form notes (add/update)" })),
  status: Type.Optional(
    Type.Union(
      TASK_STATUSES.map((status) => Type.Literal(status)),
      { description: "todo, doing, blocked or done" },
    ),
  ),
});

function render(cwd: string): string {
  const tasks = readTasks(cwd);
  if (tasks.length === 0) return "The board is empty.";
  const byStatus = new Map<TaskStatus, string[]>();
  for (const task of tasks) {
    const list = byStatus.get(task.status) ?? [];
    list.push(`  ${task.id.slice(0, 8)}  ${task.title}${task.notes ? ` — ${task.notes}` : ""}`);
    byStatus.set(task.status, list);
  }
  return TASK_STATUSES.filter((status) => byStatus.has(status))
    .map((status) => `${status}:\n${byStatus.get(status)!.join("\n")}`)
    .join("\n");
}

export const TASKS_EXTENSION: InlineExtension = {
  name: "tasks",
  factory: (pi: ExtensionAPI) => {
    pi.registerTool({
      name: "task",
      label: "Task board",
      description: [
        "Maintain the project's task board (.pi/tasks.json) so work survives this session.",
        "Use `add` for each piece of work you take on, `update` to change status or notes as you go,",
        "and `list` to see what is outstanding. Mark a task `done` only when it is verified.",
      ].join(" "),
      parameters: TaskParams,

      async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
        const cwd = ctx.cwd;
        const sessionId = ctx.sessionManager.getSessionId();
        const status = params.status as TaskStatus | undefined;

        if (params.action === "list") {
          return { content: [{ type: "text", text: render(cwd) }], details: { tasks: readTasks(cwd) } };
        }

        if (params.action === "add") {
          if (!params.title?.trim()) {
            return { content: [{ type: "text", text: "A title is required." }], details: {}, isError: true };
          }
          const task = addTask(cwd, {
            title: params.title,
            ...(params.notes !== undefined ? { notes: params.notes } : {}),
            ...(status ? { status } : {}),
            // Attributed so the conversation can show the todos it created.
            sessionId,
          });
          return {
            content: [{ type: "text", text: `Added ${task.id.slice(0, 8)} (${task.status}): ${task.title}` }],
            details: { task },
          };
        }

        if (!params.id?.trim()) {
          return {
            content: [{ type: "text", text: `An id is required for ${params.action}.` }],
            details: {},
            isError: true,
          };
        }
        const id = resolveId(cwd, params.id);
        if (!id) {
          return {
            content: [{ type: "text", text: `No task matches "${params.id}".\n\n${render(cwd)}` }],
            details: {},
            isError: true,
          };
        }

        if (params.action === "remove") {
          removeTask(cwd, id);
          return { content: [{ type: "text", text: `Removed ${id.slice(0, 8)}.` }], details: { id } };
        }

        const updated = updateTask(cwd, {
          id,
          ...(params.title !== undefined ? { title: params.title } : {}),
          ...(params.notes !== undefined ? { notes: params.notes } : {}),
          ...(status ? { status } : {}),
        });
        if (!updated) {
          return { content: [{ type: "text", text: `No task matches "${params.id}".` }], details: {}, isError: true };
        }
        return {
          content: [{ type: "text", text: `Updated ${updated.id.slice(0, 8)} (${updated.status}): ${updated.title}` }],
          details: { task: updated },
        };
      },
    });
  },
};

/** Accept a full id or the short prefix the tool prints. */
function resolveId(cwd: string, reference: string): string | null {
  const trimmed = reference.trim();
  const tasks = readTasks(cwd);
  const exact = tasks.find((task) => task.id === trimmed);
  if (exact) return exact.id;
  const matches = tasks.filter((task) => task.id.startsWith(trimmed));
  return matches.length === 1 ? matches[0].id : null;
}
