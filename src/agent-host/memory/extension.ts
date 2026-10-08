/**
 * The `memory` tool, plus the system-prompt injection that makes it useful.
 *
 * The tool lets the agent record what it learned; the injection means every
 * later session in the project starts knowing it.
 */
import { Type } from "typebox";
import type { ExtensionAPI, InlineExtension } from "@earendil-works/pi-coding-agent";
import { addMemory, readMemory, removeMemory, renderMemory, resolveMemoryId, updateMemory } from "./store";

const MemoryParams = Type.Object({
  action: Type.Union([Type.Literal("list"), Type.Literal("add"), Type.Literal("update"), Type.Literal("remove")], {
    description: "list, add, update or remove",
  }),
  id: Type.Optional(Type.String({ description: "Entry id (update/remove)" })),
  text: Type.Optional(Type.String({ description: "The fact to remember (add/update)" })),
  tag: Type.Optional(Type.String({ description: "Optional grouping label, e.g. build, convention, gotcha" })),
});

function render(cwd: string): string {
  const entries = readMemory(cwd);
  if (entries.length === 0) return "Project memory is empty.";
  return entries
    .map((entry) => `${entry.id.slice(0, 8)}  ${entry.tag ? `[${entry.tag}] ` : ""}${entry.text}`)
    .join("\n");
}

export const MEMORY_EXTENSION: InlineExtension = {
  name: "memory",
  factory: (pi: ExtensionAPI) => {
    // Everything the project already knows goes into the system prompt.
    pi.on("before_agent_start", (event, ctx) => {
      const memory = renderMemory(readMemory(ctx.cwd));
      if (!memory) return;
      return { systemPrompt: [event.systemPrompt, memory].filter(Boolean).join("\n\n") };
    });

    pi.registerTool({
      name: "memory",
      label: "Project memory",
      description: [
        "Record durable facts about this project in .pi/memory.json, so later sessions do not",
        "rediscover them. Memory is injected into every session's system prompt.",
        "Save build/test commands, architectural decisions, hard-won constraints and gotchas —",
        "not transient state, and not anything the repository already states plainly.",
        "Use `list` to see what is stored, `update` to correct an entry that stopped being true,",
        "and `remove` to drop one.",
      ].join(" "),
      parameters: MemoryParams,

      async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
        const cwd = ctx.cwd;

        if (params.action === "list") {
          return { content: [{ type: "text", text: render(cwd) }], details: { entries: readMemory(cwd) } };
        }

        if (params.action === "add") {
          if (!params.text?.trim()) {
            return { content: [{ type: "text", text: "Text is required." }], details: {}, isError: true };
          }
          const entry = addMemory(cwd, { text: params.text, ...(params.tag ? { tag: params.tag } : {}) });
          return {
            content: [{ type: "text", text: `Remembered ${entry.id.slice(0, 8)}: ${entry.text}` }],
            details: { entry },
          };
        }

        if (!params.id?.trim()) {
          return {
            content: [{ type: "text", text: `An id is required for ${params.action}.` }],
            details: {},
            isError: true,
          };
        }
        const id = resolveMemoryId(cwd, params.id);
        if (!id) {
          return {
            content: [{ type: "text", text: `No memory entry matches "${params.id}".\n\n${render(cwd)}` }],
            details: {},
            isError: true,
          };
        }

        if (params.action === "remove") {
          removeMemory(cwd, id);
          return { content: [{ type: "text", text: `Forgot ${id.slice(0, 8)}.` }], details: { id } };
        }

        const updated = updateMemory(cwd, {
          id,
          ...(params.text !== undefined ? { text: params.text } : {}),
          ...(params.tag !== undefined ? { tag: params.tag } : {}),
        });
        if (!updated) {
          return {
            content: [{ type: "text", text: `No memory entry matches "${params.id}".` }],
            details: {},
            isError: true,
          };
        }
        return {
          content: [{ type: "text", text: `Updated ${updated.id.slice(0, 8)}: ${updated.text}` }],
          details: { entry: updated },
        };
      },
    });
  },
};
