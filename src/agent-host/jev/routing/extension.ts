/**
 * Jev model routing as a virtual model.
 *
 * `jev/auto` is a virtual model the user selects like any other. Per request, Jev rates the
 * difficulty of the latest user message and the router hands the turn to the configured cheap or
 * strong model; the middle band, a low-confidence answer and a Jev failure all fall back rather
 * than guess. This replaces the old `before_agent_start` hook that switched the session model out
 * from under the user: nothing changes the selected model now, the choice of `jev/auto` *is* the
 * opt-in, and the router state is stored on the session branch so it follows the tree and survives
 * compaction.
 */
import type { Model, ModelThinkingLevel } from "@earendil-works/pi-ai";
import type {
  ExtensionAPI,
  ExtensionContext,
  InlineExtension,
  ModelRegistry,
  ModelRoute,
  ModelRouteRequest,
} from "@earendil-works/pi-coding-agent";
import { getJevRuntime } from "../service";
import { readJevSettings, type JevSettings } from "../settings";
import { DIFFICULTY_LEVELS, decideRouting, routingQuestions, ROUTING_CONTEXT, type RoutingDecision } from "./decide";

export const JEV_ROUTING_PROVIDER = "jev";
export const JEV_ROUTING_MODEL_ID = "auto";
export const JEV_ROUTING_MODEL_NAME = "Auto (Jev)";

/** What the router remembers for a session: the physical model it settled on. */
interface JevRouteState {
  provider: string;
  model: string;
  target: "cheap" | "strong" | null;
  thinkingLevel?: string | null;
}

/**
 * Ask Jev to rate the difficulty of one prompt.
 *
 * A failure throws: the caller keeps the current model, which is the only safe
 * direction for a routing mistake.
 */
export async function runRouting(
  prompt: string,
  settings: JevSettings,
  modelRegistry?: ModelRegistry | null,
): Promise<RoutingDecision | null> {
  const runtime = await getJevRuntime(modelRegistry);
  if (!runtime) return null;
  const outcome = await runtime.client.ask({ context: ROUTING_CONTEXT, prompt }, routingQuestions() as never);
  if (!outcome.ok) throw new Error(`Jev unavailable (${outcome.reason})`);
  const score = outcome.judgment.answers.difficulty;
  return decideRouting(
    { difficulty: { score: score?.score ?? Number.NaN, confidence: score?.confidence ?? 0 } } as never,
    settings.routing,
  );
}

/**
 * Parse a `"provider/model-id"` reference, optionally with a `:thinking` suffix
 * (pi style, e.g. `deepseek/deepseek-flash:high`).
 */
export function parseModelRef(ref: string): { provider: string; id: string; thinking?: string } | undefined {
  const slash = ref.indexOf("/");
  if (slash <= 0 || slash === ref.length - 1) return undefined;
  const rest = ref.slice(slash + 1);
  const colon = rest.lastIndexOf(":");
  if (colon > 0) {
    const thinking = rest.slice(colon + 1);
    if (thinking) return { provider: ref.slice(0, slash), id: rest.slice(0, colon), thinking };
  }
  return { provider: ref.slice(0, slash), id: rest };
}

/** True when routing should run at all for the current settings. */
export function jevRoutingActive(settings: JevSettings): boolean {
  if (!settings.enabled || settings.routing.mode !== "jev") return false;
  return Boolean(settings.routing.cheap || settings.routing.strong);
}

/** The physical model a `provider/id` reference names, when the catalog has it. */
function resolveRef(ref: string | null, ctx: ExtensionContext): Model<never> | undefined {
  if (!ref) return undefined;
  const parsed = parseModelRef(ref);
  if (!parsed) return undefined;
  return ctx.modelRegistry.find(parsed.provider, parsed.id) as Model<never> | undefined;
}

function lastUserText(messages: readonly { role?: string; content?: unknown }[]): string {
  const last = messages.filter((message) => message.role === "user").at(-1);
  const content = last?.content ?? "";
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content
    .flatMap((block) =>
      (block as { type?: string; text?: string }).type === "text" ? [(block as { text: string }).text] : [],
    )
    .join("\n");
}

/** Whether the latest user message carries an image, so a text-only target is never chosen. */
function hasImage(messages: readonly { role?: string; content?: unknown }[]): boolean {
  const last = messages.filter((message) => message.role === "user").at(-1);
  const content = last?.content;
  if (!Array.isArray(content)) return false;
  return content.some((block) => (block as { type?: string }).type === "image");
}

export const JEV_ROUTING_EXTENSION: InlineExtension = {
  name: "JevRouting",
  factory: (pi: ExtensionAPI) => {
    pi.registerVirtualModel<JevRouteState>({
      provider: JEV_ROUTING_PROVIDER,
      id: JEV_ROUTING_MODEL_ID,
      name: JEV_ROUTING_MODEL_NAME,
      thinkingLevels: ["off", "low", "medium", "high", "xhigh"],
      input: ["text", "image"],
      // Limits stay unset: pi switches to the physical model's limits after the first response.
      async route(
        request: ModelRouteRequest<JevRouteState>,
        ctx: ExtensionContext,
      ): Promise<ModelRoute<JevRouteState>> {
        const settings = readJevSettings();
        const cheap = resolveRef(settings.routing.cheap, ctx);
        const strong = resolveRef(settings.routing.strong, ctx);
        const fallback = resolveRef(settings.routing.default ?? null, ctx);
        const previous = request.previous?.model as Model<never> | undefined;

        const pickTarget = (target: "cheap" | "strong" | null): Model<never> | undefined =>
          target === "cheap" ? cheap : target === "strong" ? strong : undefined;

        const level = (target: "cheap" | "strong" | null): ModelThinkingLevel => {
          const configured = target === "cheap" ? settings.routing.cheapThinking : settings.routing.strongThinking;
          return (configured as ModelThinkingLevel | null) ?? request.thinkingLevel;
        };

        // Requests outside the agent loop (compaction summaries and the like) must still resolve to
        // a physical model, but they are not worth a classification call.
        if (request.reason === "direct") {
          const model = fallback ?? strong ?? cheap ?? previous;
          if (!model) throw new Error("Jev routing: no model is configured for jev/auto (Settings → Jev → Routing)");
          return { model, thinkingLevel: request.thinkingLevel };
        }

        // A session that already routed stays where it is, so a session costs one cache miss.
        const stored = request.state;
        if (stored) {
          const model = ctx.modelRegistry.find(stored.provider, stored.model);
          if (model) {
            return {
              model,
              thinkingLevel: (stored.thinkingLevel as ModelThinkingLevel | undefined) ?? request.thinkingLevel,
            };
          }
        }

        let target: "cheap" | "strong" | null = null;
        if (jevRoutingActive(settings)) {
          const prompt = lastUserText(request.messages);
          if (prompt.trim()) {
            try {
              target = (await runRouting(prompt, settings, ctx.modelRegistry))?.target ?? null;
            } catch {
              // A routing failure keeps the fallback; it never blocks the turn.
              target = null;
            }
          }
        }

        let model = pickTarget(target) ?? fallback ?? previous ?? strong ?? cheap;
        if (!model) throw new Error("Jev routing: no model is configured for jev/auto (Settings → Jev → Routing)");
        if (hasImage(request.messages) && !(model.input ?? []).includes("image")) {
          model = strong ?? fallback ?? model;
        }

        return {
          model,
          thinkingLevel: level(target),
          state: { provider: model.provider, model: model.id, target, thinkingLevel: level(target) },
        };
      },
    });
  },
};

/** Exported for the router's own tests. */
export { DIFFICULTY_LEVELS };
