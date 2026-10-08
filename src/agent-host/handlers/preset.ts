import { existsSync, mkdirSync } from "node:fs";
import path from "node:path";

import type { ApiHandlerSet } from "../../contract/rpc";
import { RpcError } from "../../contract/types";
import { PRESET_KIND, PRESET_VERSION, parsePreset, presetToJson, sanitizeMcpServer } from "../../shared/preset";
import type { WorktablePreset } from "../../shared/preset";
import { agentDirectories, discoverAgents } from "../subagent/agents";
import { readJevSettings, writeJevSettings } from "../jev/settings";
import { mcpGlobalPath, readMcpConfig, setMcpServer } from "../mcp-config";
import { writeFileAtomic } from "../json-file";
import type { HandlerContext } from "./types";

/**
 * Presets: export the portable half of a setup, import it somewhere else.
 *
 * Agents are the main payload (they are just markdown), plus MCP endpoints with
 * secrets stripped, the Jev gate rules, and the appearance/tool choices the
 * renderer owns. Everything is additive on import — nothing is deleted or
 * overwritten, because a preset arrives from someone else's machine.
 */
export function presetHandlers(_ctx: HandlerContext) {
  return {
    "preset.export": (params) => {
      const { cwd } = (params ?? {}) as { cwd?: string };
      const projectCwd = typeof cwd === "string" && cwd ? cwd : process.cwd();
      const { agents } = discoverAgents(projectCwd, "both");
      const mcp = readMcpConfig(projectCwd);

      const preset: WorktablePreset = {
        kind: PRESET_KIND,
        version: PRESET_VERSION,
        exportedAt: new Date().toISOString(),
        agents: agents.map((agent) => ({
          name: agent.name,
          description: agent.description,
          systemPrompt: agent.systemPrompt,
          ...(agent.model ? { model: agent.model } : {}),
          ...(agent.tools ? { tools: agent.tools } : {}),
        })),
        mcpServers: mcp.servers
          .map((server) => sanitizeMcpServer({ name: server.name, ...server.config }))
          .filter((server): server is NonNullable<typeof server> => server !== null),
        jev: readJevSettings() as unknown as Record<string, unknown>,
      };

      return {
        json: presetToJson(preset),
        counts: { agents: preset.agents?.length ?? 0, mcpServers: preset.mcpServers?.length ?? 0 },
      };
    },

    "preset.import": (params) => {
      const { json, cwd } = params as { json: string; cwd?: string };
      const parsed = parsePreset(json);
      if (!parsed.ok) throw new RpcError({ code: "BAD_REQUEST", message: parsed.error });
      const preset = parsed.preset;
      const projectCwd = typeof cwd === "string" && cwd ? cwd : process.cwd();
      const dir = agentDirectories(projectCwd, "user")[0];
      const warnings = [...parsed.warnings];

      let agentsAdded = 0;
      let agentsSkipped = 0;
      if (preset.agents && preset.agents.length > 0) {
        if (!dir) {
          warnings.push("no user agents directory is available, agents were not imported");
        } else {
          mkdirSync(dir, { recursive: true });
          for (const agent of preset.agents) {
            const filePath = path.join(dir, `${agent.name}.md`);
            if (existsSync(filePath)) {
              agentsSkipped += 1;
              warnings.push(`${agent.name}: an agent with that name already exists, left untouched`);
              continue;
            }
            const frontmatter = [
              "---",
              `name: ${agent.name}`,
              `description: ${agent.description.replace(/\s+/g, " ").trim()}`,
              ...(agent.model ? [`model: ${agent.model}`] : []),
              ...(agent.tools && agent.tools.length > 0 ? [`tools: ${agent.tools.join(", ")}`] : []),
              "---",
              "",
              agent.systemPrompt,
              "",
            ].join("\n");
            writeFileAtomic(filePath, frontmatter);
            agentsAdded += 1;
          }
        }
      }

      let mcpAdded = 0;
      let mcpSkipped = 0;
      if (preset.mcpServers && preset.mcpServers.length > 0) {
        const existing = new Set(readMcpConfig(projectCwd).servers.map((server) => server.name));
        for (const server of preset.mcpServers) {
          if (existing.has(server.name)) {
            mcpSkipped += 1;
            warnings.push(`${server.name}: an MCP server with that name already exists, left untouched`);
            continue;
          }
          const config: Record<string, unknown> = {
            transport: server.transport,
            ...(server.url ? { url: server.url } : {}),
            ...(server.command ? { command: server.command } : {}),
            ...(server.args ? { args: server.args } : {}),
            ...(typeof server.enabled === "boolean" ? { enabled: server.enabled } : {}),
          };
          setMcpServer(projectCwd, server.name, config, "global", path.dirname(mcpGlobalPath()));
          mcpAdded += 1;
        }
      }

      if (preset.jev) writeJevSettings(preset.jev);

      return {
        applied: { agentsAdded, agentsSkipped, mcpAdded, mcpSkipped },
        warnings,
      };
    },
  } satisfies Partial<ApiHandlerSet>;
}
