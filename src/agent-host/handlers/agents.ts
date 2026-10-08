import { existsSync, readFileSync } from "node:fs";
import { RpcError } from "../../contract/types";
import type { AgentInfo } from "../../contract/types";
import type { ApiHandlerSet } from "../../contract/rpc";
import path from "node:path";
import { agentDirectories, discoverAgents, loadAgentFile, type AgentConfig, type AgentScope } from "../subagent/agents";
import { setFrontmatterModel } from "../subagent/frontmatter";
import { writeFileAtomic } from "../json-file";
import { AGENT_TEMPLATES, buildAgentFile, findAgentTemplate, isValidAgentName } from "../../shared/agent-templates";
import { mkdirSync } from "node:fs";
import type { HandlerContext } from "./types";

/**
 * Agent definitions: the markdown files the subagent tool loads. The desktop
 * lists them and lets the user pick the model each one runs on.
 */
function toInfo(agent: AgentConfig): AgentInfo {
  return {
    name: agent.name,
    description: agent.description,
    source: agent.source,
    filePath: agent.filePath,
    ...(agent.model ? { model: agent.model } : {}),
    ...(agent.tools ? { tools: agent.tools } : {}),
  };
}

export function agentHandlers(_ctx: HandlerContext) {
  return {
    "agents.list": (params) => {
      const { cwd, scope } = (params ?? {}) as { cwd?: string; scope?: AgentScope };
      const { agents, projectAgentsDir } = discoverAgents(cwd ?? process.cwd(), scope ?? "both");
      return { agents: agents.map(toInfo), projectAgentsDir };
    },

    "agents.templates": () => ({
      templates: AGENT_TEMPLATES.map(({ id, name, description }) => ({ id, name, description })),
    }),

    "agents.create": (params) => {
      const input = params as {
        templateId: string;
        name: string;
        description?: string;
        scope?: "user" | "project";
        cwd?: string;
      };
      const template = findAgentTemplate(input.templateId);
      if (!template) {
        throw new RpcError({ code: "BAD_REQUEST", message: `Unknown agent template: ${input.templateId}` });
      }
      if (!isValidAgentName(input.name)) {
        throw new RpcError({
          code: "BAD_REQUEST",
          message: "Agent names use lowercase letters, digits, dash and underscore (they become file names)",
        });
      }
      // Project scope needs a project; otherwise the user directory is right.
      const projectCwd = typeof input.cwd === "string" && input.cwd ? input.cwd : process.cwd();
      const scope: AgentScope = input.scope === "project" ? "project" : "user";
      const dir = agentDirectories(projectCwd, scope)[0];
      if (!dir) {
        throw new RpcError({ code: "BAD_REQUEST", message: "No agents directory is available for that scope" });
      }
      const filePath = path.join(dir, `${input.name}.md`);
      if (existsSync(filePath)) {
        throw new RpcError({ code: "CONFLICT", message: `An agent named ${input.name} already exists` });
      }
      mkdirSync(dir, { recursive: true });
      writeFileAtomic(filePath, buildAgentFile(template, input.name, input.description));
      return { filePath };
    },

    "agents.setModel": (params) => {
      const { filePath, model } = params as { filePath: string; model?: string | null };
      if (!filePath || !filePath.endsWith(".md")) {
        throw new RpcError({ code: "BAD_REQUEST", message: "An agent markdown file is required" });
      }
      if (!existsSync(filePath)) {
        throw new RpcError({ code: "NOT_FOUND", message: "Agent file not found" });
      }
      // Only a file the subagent tool would load may be edited: it must sit in an
      // agents directory and parse as a definition.
      const resolved = path.resolve(filePath);
      const inAgentsDir = agentDirectories(process.cwd(), "both").some((dir) =>
        resolved.startsWith(path.resolve(dir) + path.sep),
      );
      if (!inAgentsDir || !loadAgentFile(filePath)) {
        throw new RpcError({ code: "FORBIDDEN", message: "Not an agent definition" });
      }

      const content = readFileSync(filePath, "utf8");
      try {
        writeFileAtomic(filePath, setFrontmatterModel(content, model ?? undefined));
      } catch (error) {
        throw new RpcError({
          code: "BAD_REQUEST",
          message: error instanceof Error ? error.message : String(error),
        });
      }
      return { ok: true as const };
    },
  } satisfies Partial<ApiHandlerSet>;
}
