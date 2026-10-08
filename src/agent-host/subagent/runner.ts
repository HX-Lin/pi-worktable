/**
 * Runs one subagent: an isolated in-process pi session with its own context
 * window, system prompt, tool set and (optionally) model.
 *
 * Isolation is the point — a subagent's transcript never enters the caller's
 * context, so only its final answer comes back. Subagents cannot spawn further
 * subagents: the session is built without the subagent extension.
 */
import {
  createAgentSessionFromServices,
  createAgentSessionServices,
  getAgentDir,
  SessionManager,
  type ExtensionAPI,
  type InlineExtension,
  type ModelRuntime,
} from "@earendil-works/pi-coding-agent";
import { BASE_SESSION_EXTENSIONS } from "../builtin-providers";
import { withExtensionTools } from "../tool-activation";
import type { AgentConfig } from "./agents";

export interface SubagentUsage {
  inputTokens: number;
  outputTokens: number;
  turns: number;
}

export interface SubagentResult {
  ok: boolean;
  text: string;
  error?: string;
  usage: SubagentUsage;
  /** Tool names the agent ran, in order. */
  tools: string[];
}

export interface RunSubagentParams {
  agent: AgentConfig;
  task: string;
  cwd: string;
  signal?: AbortSignal;
  /** Streamed progress lines (tool calls and assistant text so far). */
  onUpdate?: (text: string) => void;
}

/** The agent's markdown body is appended to the session's system prompt. */
function createAgentPromptExtension(systemPrompt: string): InlineExtension {
  return {
    name: "SubagentSystemPrompt",
    factory: (pi: ExtensionAPI) => {
      pi.on("before_agent_start", (event) => ({
        systemPrompt: [event.systemPrompt, systemPrompt].filter(Boolean).join("\n\n"),
      }));
    },
  };
}

/** "provider/model-id" -> its two halves. */
function splitModelRef(ref: string): { provider: string; modelId: string } | null {
  const slash = ref.indexOf("/");
  if (slash <= 0 || slash === ref.length - 1) return null;
  return { provider: ref.slice(0, slash), modelId: ref.slice(slash + 1) };
}

function resolveModel(modelRuntime: ModelRuntime, ref: string) {
  const parsed = splitModelRef(ref);
  if (!parsed) return undefined;
  return modelRuntime.getModel(parsed.provider, parsed.modelId);
}

function textOf(message: unknown): string {
  const content = (message as { content?: unknown })?.content;
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content
    .map((part) =>
      part && typeof part === "object" && (part as { type?: string }).type === "text"
        ? ((part as { text?: string }).text ?? "")
        : "",
    )
    .filter(Boolean)
    .join("");
}

export async function runSubagent(params: RunSubagentParams): Promise<SubagentResult> {
  const { agent, task, cwd, signal, onUpdate } = params;
  const usage: SubagentUsage = { inputTokens: 0, outputTokens: 0, turns: 0 };
  const tools: string[] = [];
  let text = "";
  let aborted = false;

  const services = await createAgentSessionServices({
    cwd,
    agentDir: getAgentDir(),
    resourceLoaderOptions: {
      extensionFactories: [...BASE_SESSION_EXTENSIONS, createAgentPromptExtension(agent.systemPrompt)],
    },
  });

  const sessionManager = SessionManager.create(cwd, undefined);
  const { session } = await createAgentSessionFromServices({ services, sessionManager });

  if (agent.model) {
    const model = resolveModel(services.modelRuntime, agent.model);
    if (!model) {
      session.dispose();
      return { ok: false, text: "", error: `Unknown model "${agent.model}"`, usage, tools };
    }
    await session.setModel(model);
  }
  if (agent.tools && agent.tools.length > 0) {
    session.setActiveToolsByName(withExtensionTools(session, agent.tools));
  }

  const unsubscribe = session.subscribe((event) => {
    const type = (event as { type?: string }).type;
    if (type === "tool_call") {
      const name = (event as { name?: string }).name;
      if (name) {
        tools.push(name);
        onUpdate?.(`→ ${name}`);
      }
    } else if (type === "message" || type === "assistant_message") {
      const message = (event as { message?: unknown }).message;
      const chunk = textOf(message);
      if (chunk) text = chunk;
    } else if (type === "turn_end") {
      usage.turns += 1;
      const turnUsage = (event as { usage?: { inputTokens?: number; outputTokens?: number } }).usage;
      if (turnUsage) {
        usage.inputTokens += turnUsage.inputTokens ?? 0;
        usage.outputTokens += turnUsage.outputTokens ?? 0;
      }
    }
  });

  const onAbort = () => {
    aborted = true;
    void session.abort();
  };
  signal?.addEventListener("abort", onAbort, { once: true });

  try {
    await session.prompt(task, { source: "rpc" });
    return { ok: true, text, usage, tools };
  } catch (error) {
    return {
      ok: false,
      text,
      error: aborted ? "Subagent aborted" : error instanceof Error ? error.message : String(error),
      usage,
      tools,
    };
  } finally {
    signal?.removeEventListener("abort", onAbort);
    unsubscribe();
    session.dispose();
  }
}
