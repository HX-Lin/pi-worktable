/**
 * Model resolution for subagents.
 *
 * An agent's model is a reference, not a live object: `provider/model-id`, or a
 * bare `model-id` that is looked up across every configured provider. A bare id
 * that matches more than one provider is ambiguous and rejected rather than
 * guessed, because silently running on the wrong model is worse than an error
 * the caller can fix.
 */
import type { ModelRuntime } from "@earendil-works/pi-coding-agent";

export interface ResolvedModelRef {
  provider: string;
  modelId: string;
}

/** A live model from the runtime (never undefined once resolved). */
export type ResolvedModel = NonNullable<ReturnType<ModelRuntime["getModel"]>>;

export type ModelResolution = { ok: true; model: ResolvedModel } | { ok: false; error: string };

/** "provider/model-id" -> its two halves. */
export function parseModelRef(ref: string): ResolvedModelRef | null {
  const trimmed = ref.trim();
  if (!trimmed) return null;
  const slash = trimmed.indexOf("/");
  if (slash === -1) return { provider: "", modelId: trimmed };
  if (slash === 0 || slash === trimmed.length - 1) return null;
  return { provider: trimmed.slice(0, slash), modelId: trimmed.slice(slash + 1) };
}

/** The canonical `provider/model-id` spelling for a live model. */
export function formatModelRef(model: { provider: string; id: string }): string {
  return `${model.provider}/${model.id}`;
}

function availableModels(modelRuntime: ModelRuntime, limit = 12): string {
  const all = modelRuntime.getModels();
  if (all.length === 0) return "no models are configured";
  const shown = all.slice(0, limit).map((model) => formatModelRef(model));
  const rest = all.length - shown.length;
  return rest > 0 ? `${shown.join(", ")} (+${rest} more)` : shown.join(", ");
}

/**
 * Resolve a model reference against the configured providers.
 *
 * `provider/model-id` must exist exactly; a bare `model-id` must be unique.
 */
export function resolveAgentModel(modelRuntime: ModelRuntime, ref: string): ModelResolution {
  const parsed = parseModelRef(ref);
  if (!parsed) return { ok: false, error: `Invalid model reference "${ref}"` };

  if (parsed.provider) {
    const model = modelRuntime.getModel(parsed.provider, parsed.modelId);
    if (!model) {
      return {
        ok: false,
        error: `Unknown model "${ref}". Available: ${availableModels(modelRuntime)}`,
      };
    }
    return { ok: true, model };
  }

  const matches = modelRuntime.getModels().filter((model) => model.id === parsed.modelId);
  if (matches.length === 0) {
    return {
      ok: false,
      error: `Unknown model "${ref}". Available: ${availableModels(modelRuntime)}`,
    };
  }
  if (matches.length > 1) {
    const providers = matches.map((model) => formatModelRef(model)).join(", ");
    return { ok: false, error: `Model "${ref}" is ambiguous — use one of: ${providers}` };
  }
  return { ok: true, model: matches[0] };
}

/** The model an agent runs on: the call-site override wins over the definition. */
export function effectiveModelRef(agentModel: string | undefined, override: string | undefined): string | undefined {
  const trimmed = override?.trim();
  return trimmed ? trimmed : agentModel?.trim() || undefined;
}
