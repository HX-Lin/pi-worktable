/**
 * The `subagent` tool: delegate a task to a specialised agent with an isolated
 * context window.
 *
 * Modes: single (`agent` + `task`) and parallel (`tasks`). Definitions are
 * markdown files with YAML frontmatter (`name`, `description`, optional `model`
 * and `tools`); the body becomes the agent's system prompt.
 */
import { Type } from "typebox";
import type { ExtensionAPI, InlineExtension } from "@earendil-works/pi-coding-agent";
import { discoverAgents, type AgentConfig, type AgentScope } from "./agents";
import { runSubagent, type SubagentResult } from "./runner";

const TaskItem = Type.Object({
  agent: Type.String({ description: "Agent name" }),
  task: Type.String({ description: "Task for that agent" }),
});

const SubagentParams = Type.Object({
  agent: Type.Optional(Type.String({ description: "Agent name (single mode)" })),
  task: Type.Optional(Type.String({ description: "Task to delegate (single mode)" })),
  tasks: Type.Optional(Type.Array(TaskItem, { description: "Array of {agent, task} for parallel execution" })),
  agentScope: Type.Optional(
    Type.Union([Type.Literal("user"), Type.Literal("project"), Type.Literal("both")], {
      description: 'Where to load agent definitions from. Default "user".',
    }),
  ),
  cwd: Type.Optional(Type.String({ description: "Working directory for the subagents" })),
});

interface RunRecord {
  agent: string;
  result: SubagentResult;
}

function summarize(records: RunRecord[]): string {
  return records
    .map(({ agent, result }) => {
      const head = result.ok ? `${agent}: done` : `${agent}: failed — ${result.error ?? "unknown error"}`;
      const body = result.text.trim();
      return body ? `${head}\n\n${body}` : head;
    })
    .join("\n\n---\n\n");
}

function agentList(agents: AgentConfig[]): string {
  if (agents.length === 0) return "none";
  return agents.map((a) => `${a.name} (${a.source}): ${a.description}`).join("; ");
}

export const SUBAGENT_EXTENSION: InlineExtension = {
  name: "subagent",
  factory: (pi: ExtensionAPI) => {
    pi.registerTool({
      name: "subagent",
      label: "Subagent",
      description: [
        "Delegate tasks to specialised subagents, each with its own isolated context window.",
        "Modes: single (agent + task) or parallel (tasks array).",
        "Only the subagent's final answer returns to this conversation.",
        `Agents come from the user's agent directory; project-local agents require agentScope "project" or "both".`,
      ].join(" "),
      parameters: SubagentParams,

      async execute(_toolCallId, params, signal, onUpdate, ctx) {
        const scope: AgentScope = (params.agentScope as AgentScope | undefined) ?? "user";
        const { agents } = discoverAgents(ctx.cwd, scope);
        const cwd = typeof params.cwd === "string" && params.cwd ? params.cwd : ctx.cwd;

        const byName = new Map(agents.map((agent) => [agent.name, agent]));
        const hasTasks = (params.tasks?.length ?? 0) > 0;
        const hasSingle = Boolean(params.agent && params.task);
        if (Number(hasTasks) + Number(hasSingle) !== 1) {
          return {
            content: [
              {
                type: "text",
                text: `Provide exactly one mode: (agent + task) or tasks[]. Available agents: ${agentList(agents)}`,
              },
            ],
            details: { results: [] },
            isError: true,
          };
        }

        const jobs = hasSingle
          ? [{ agent: params.agent as string, task: params.task as string }]
          : (params.tasks ?? []).map((t) => ({ agent: t.agent, task: t.task }));

        const missing = jobs.map((job) => job.agent).filter((name) => !byName.has(name));
        if (missing.length > 0) {
          return {
            content: [
              {
                type: "text",
                text: `Unknown agent(s): ${missing.join(", ")}. Available agents: ${agentList(agents)}`,
              },
            ],
            details: { results: [] },
            isError: true,
          };
        }

        const started: string[] = [];
        const runOne = async (job: { agent: string; task: string }): Promise<RunRecord> => {
          const agent = byName.get(job.agent)!;
          started.push(agent.name);
          const result = await runSubagent({
            agent,
            task: job.task,
            cwd,
            signal,
            onUpdate: (line) =>
              onUpdate?.({
                content: [{ type: "text", text: `[${started.join(", ")}] ${line}` }],
                details: { running: [...started] },
              }),
          });
          return { agent: agent.name, result };
        };

        const records = hasSingle ? [await runOne(jobs[0])] : await Promise.all(jobs.map(runOne));
        const failed = records.filter((record) => !record.result.ok);
        const totalTokens = records.reduce(
          (sum, record) => sum + record.result.usage.inputTokens + record.result.usage.outputTokens,
          0,
        );
        const summary = `${summarize(records)}\n\n(${records.length} subagent${records.length === 1 ? "" : "s"}, ${totalTokens} tokens)`;

        return {
          content: [{ type: "text", text: summary }],
          isError: failed.length === records.length,
          details: {
            results: records.map(({ agent, result }) => ({
              agent,
              ok: result.ok,
              error: result.error,
              usage: result.usage,
              tools: result.tools,
            })),
          },
        };
      },
    });
  },
};
