import type { ApiHandlerSet } from "../../contract/rpc";
import type { HandlerContext } from "./types";
import { RpcError } from "../../contract/types";
import { readJevConfig, setJevKey, testJevChannel, updateJevConfig } from "../jev/service";
import {
  patchMcpServer,
  readMcpConfig,
  removeMcpServer,
  runPiMcpCommand,
  setAutoEnableCodemode,
  setMcpServer,
  type McpExposure,
  type McpScope,
} from "../mcp-config";
import { jevModelRegistry, resolveModelsCwd } from "./helpers";

/**
 * jevMcp handlers.
 */
export function jevMcpHandlers(_ctx: HandlerContext) {
  return {
    "jev.getConfig": async () => readJevConfig(await jevModelRegistry()),

    "jev.updateConfig": async (params) => {
      const { patch } = params as { patch?: unknown };
      return updateJevConfig(patch ?? {}, await jevModelRegistry());
    },

    "jev.setKey": async (params) => {
      const { apiKey } = params as { apiKey?: string };
      return setJevKey(typeof apiKey === "string" ? apiKey : "", await jevModelRegistry());
    },

    "jev.test": async () => testJevChannel(await jevModelRegistry()),

    "mcp.getConfig": async (params) => readMcpConfig(resolveModelsCwd(params as { cwd?: string } | void)),

    "mcp.setServer": async (params) => {
      const { cwd, name, config, scope } = params as {
        cwd?: string;
        name: string;
        config: Record<string, unknown>;
        scope?: McpScope;
      };
      const root = resolveModelsCwd({ cwd });
      setMcpServer(root, name, config, scope ?? "global");
      return readMcpConfig(root);
    },

    "mcp.patchServer": async (params) => {
      const { cwd, name, patch, scope } = params as {
        cwd?: string;
        name: string;
        patch: { enabled?: boolean; exposure?: McpExposure; description?: string | null };
        scope?: McpScope;
      };
      const root = resolveModelsCwd({ cwd });
      patchMcpServer(root, name, patch, scope ?? "global");
      return readMcpConfig(root);
    },

    "mcp.removeServer": async (params) => {
      const { cwd, name, scope } = params as { cwd?: string; name: string; scope?: McpScope };
      const root = resolveModelsCwd({ cwd });
      removeMcpServer(root, name, scope ?? "global");
      return readMcpConfig(root);
    },

    "mcp.setAutoEnableCodemode": async (params) => {
      const { cwd, value, scope } = params as { cwd?: string; value: boolean; scope?: McpScope };
      const root = resolveModelsCwd({ cwd });
      setAutoEnableCodemode(root, value, scope ?? "global");
      return readMcpConfig(root);
    },

    "mcp.runCommand": async (params) => {
      const { cwd, args } = params as { cwd?: string; args: string[] };
      if (!Array.isArray(args) || args.some((arg) => typeof arg !== "string")) {
        throw new RpcError({ code: "BAD_REQUEST", message: "args must be an array of strings" });
      }
      return runPiMcpCommand(args, { cwd: resolveModelsCwd({ cwd }) });
    },
  } satisfies Partial<ApiHandlerSet>;
}
