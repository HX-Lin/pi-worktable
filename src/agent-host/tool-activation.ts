/**
 * Active-tool computation for agent sessions.
 *
 * Lives in its own module so the rules stay unit-testable without booting the host.
 */
import type { AgentSessionLike, ToolExposure } from "../shared/pi-types";

/** Built-in coding tools the desktop presets select. */
export const CODING_TOOL_NAMES = ["read", "bash", "edit", "write", "grep", "find", "ls"];

/** Tools with these exposures are callable from scripts without being declared to the model. */
export const NON_DIRECT_EXPOSURES = new Set(["codemode", "deferred", "hidden"]);

/** Exposures an extension may activate on its own: MCP turns these on for indirect tools. */
const EXTENSION_ACTIVATED_EXPOSURES = new Set(["codemode", "deferred"]);

/**
 * Build the active tool set from a preset plus the extension tools the app always enables.
 *
 * Only `direct` extension tools join the set. `codemode`/`deferred` tools (MCP tools, by default)
 * are reached through codemode scripts and `tool_search`, and declaring every one of them on every
 * request would be wasteful; `hidden` tools stay unreachable.
 *
 * The MCP extension activates `codemode`/`tool_search` — and `tool_search` records the tools it
 * loads — on its own. Rebuilding the set from a preset must not switch those off, or every
 * indirect MCP tool becomes unreachable the next time the user changes the tool preset.
 */
export function withExtensionTools(session: AgentSessionLike, toolNames: string[]): string[] {
  if (toolNames.length === 0) return [];

  const codingToolNames = new Set(CODING_TOOL_NAMES);
  const extensionTools = session.getAllTools().filter((tool) => !codingToolNames.has(tool.name));
  const isIndirect = (exposure: ToolExposure | undefined) => NON_DIRECT_EXPOSURES.has(exposure ?? "direct");

  const directToolNames = extensionTools.filter((tool) => !isIndirect(tool.exposure)).map((tool) => tool.name);
  const extensionActivatedNames = new Set(
    extensionTools
      .filter((tool) => EXTENSION_ACTIVATED_EXPOSURES.has(tool.exposure ?? "direct"))
      .map((tool) => tool.name),
  );
  const managedToolNames = session.getActiveToolNames().filter((name) => extensionActivatedNames.has(name));

  return [...new Set([...toolNames, ...directToolNames, ...managedToolNames])];
}
