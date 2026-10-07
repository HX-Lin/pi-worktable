/**
 * Extensions bundled with the app and injected into every agent session via the
 * resource loader's inline extension factories: the providers users should see
 * in the model picker without installing anything, plus the memory-script index
 * that tells the model which executables it already has.
 */
import {
  createCodemodeExtension,
  createMcpExtension,
  createToolSearchExtension,
  type InlineExtension,
  type ModelRuntime,
} from "@earendil-works/pi-coding-agent";
import { JEV_PROVIDER_EXTENSION, registerJevProvider } from "./jev/classifier-provider";
import { CONTEXT_FOLD_EXTENSION } from "./context-fold-extension";
import { JEV_COMPACTION_EXTENSION } from "./jev/compaction/hook";
import { JEV_GATE_EXTENSION } from "./jev/gate/extension";
import { JEV_ROUTING_EXTENSION } from "./jev/routing/extension";

export const BUILTIN_PROVIDER_EXTENSIONS: InlineExtension[] = [JEV_PROVIDER_EXTENSION];

/**
 * Upstream built-in extensions the desktop opts into.
 *
 * The SDK never loads pi's built-ins on its own: they are inline extensions the host supplies.
 * We take `codemode`, `tool_search`, and `mcp`, and deliberately leave `llama.cpp` out (no local
 * models). `codemode` and `tool_search` load inactive and are enabled by `setActiveToolsByName`,
 * the MCP extension, or the tool presets; MCP registers tools as `mcp__<server>__<tool>`.
 * `replaceable` keeps a user extension that registers the same tool or `/mcp` command working.
 */
export const PI_BUILTIN_EXTENSIONS: InlineExtension[] = [
  { name: "codemode", builtin: true, replaceable: true, factory: createCodemodeExtension() },
  { name: "tool-search", builtin: true, replaceable: true, factory: createToolSearchExtension() },
  { name: "mcp", builtin: true, replaceable: true, factory: createMcpExtension() },
];

/** Every inline extension the app injects into agent sessions. */
export const BUILTIN_SESSION_EXTENSIONS: InlineExtension[] = [
  ...BUILTIN_PROVIDER_EXTENSIONS,
  ...PI_BUILTIN_EXTENSIONS,
  CONTEXT_FOLD_EXTENSION,
  JEV_COMPACTION_EXTENSION,
  JEV_GATE_EXTENSION,
  JEV_ROUTING_EXTENSION,
];

/** Register app-bundled providers on a host-level runtime used by auth APIs. */
export async function registerBuiltinProviders(modelRuntime: ModelRuntime): Promise<void> {
  registerJevProvider(modelRuntime);
  await modelRuntime.refresh({ allowNetwork: false });
}
