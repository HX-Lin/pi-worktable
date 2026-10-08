import { RpcError } from "../../contract/types";
import type { ApiHandlerSet } from "../../contract/rpc";
import { addMemory, readMemory, removeMemory, updateMemory } from "../memory/store";
import type { HandlerContext } from "./types";

/** The project memory the desktop shows; the agent edits it with the `memory` tool. */
export function memoryHandlers(_ctx: HandlerContext) {
  return {
    "memory.list": (params) => {
      const { cwd } = params as { cwd: string };
      if (!cwd) throw new RpcError({ code: "BAD_REQUEST", message: "cwd is required" });
      return { entries: readMemory(cwd) };
    },

    "memory.add": (params) => {
      const { cwd, text, tag } = params as { cwd: string; text: string; tag?: string };
      if (!cwd || !text?.trim()) throw new RpcError({ code: "BAD_REQUEST", message: "cwd and text are required" });
      return { entry: addMemory(cwd, { text, tag }) };
    },

    "memory.update": (params) => {
      const { cwd, id, text, tag } = params as { cwd: string; id: string; text?: string; tag?: string };
      if (!cwd || !id) throw new RpcError({ code: "BAD_REQUEST", message: "cwd and id are required" });
      const entry = updateMemory(cwd, { id, text, tag });
      if (!entry) throw new RpcError({ code: "NOT_FOUND", message: "Memory entry not found" });
      return { entry };
    },

    "memory.remove": (params) => {
      const { cwd, id } = params as { cwd: string; id: string };
      if (!cwd || !id) throw new RpcError({ code: "BAD_REQUEST", message: "cwd and id are required" });
      return { ok: removeMemory(cwd, id) as true };
    },
  } satisfies Partial<ApiHandlerSet>;
}
