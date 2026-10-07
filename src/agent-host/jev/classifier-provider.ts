/**
 * Jev as an ordinary model-catalog provider.
 *
 * pi ships the System One classifier (`typesafe-system-one`) that both TypeSafe and OpenCode Zen
 * serve, but its implementation always sends `Authorization: Bearer <apiKey>`. OpenCode Zen serves
 * the same protocol at `/zen/v1/systemone` and accepts a request that carries no key at all, which
 * is how the desktop has always reached Jev. Registering a provider whose classifier implementation
 * omits that header keeps the keyless path while making Jev an ordinary classifier model: the gate,
 * the compaction and the virtual-model router all go through `ModelRuntime.classify()`.
 *
 * The provider reports `apiKey: "keyless"` + `authHeader: false` so the runtime treats it as
 * configured without ever attaching a credential to the request.
 */
import type {
  ClassifierContext,
  ClassifierModel,
  ClassifierOptions,
  ClassifierResult,
  ProviderClassifier,
} from "@earendil-works/pi-ai";
import type { InlineExtension, ModelRuntime, ProviderConfig } from "@earendil-works/pi-coding-agent";
import { toClassifierAnswers, toWireQuestions } from "./classifier-shapes";
import { createJevClient } from "./transport";

export const JEV_PROVIDER_ID = "jev";
/** The wire protocol id, shared with TypeSafe and OpenCode Zen. */
export const JEV_CLASSIFIER_API = "typesafe-system-one";
export const JEV_DEFAULT_BASE_URL = "https://opencode.ai/zen/v1";
export const JEV_DEFAULT_MODEL = "jev-1.13-free";

/** Classifier models the provider publishes, cheapest first. */
export const JEV_CLASSIFIER_MODELS: ReadonlyArray<{ id: string; name: string }> = [
  { id: "jev-1.13-free", name: "Jev 1.13 Free" },
  { id: "jev-1.13", name: "Jev 1.13" },
];

/** The System One endpoint of a Zen-style base URL. */
export function systemOneUrl(baseUrl: string): string {
  return `${baseUrl.replace(/\/+$/u, "")}/systemone`;
}

export interface KeylessJevClassifierOptions {
  /** Endpoint base for models that do not carry their own; `/systemone` is appended. */
  baseUrl?: string;
  timeoutMs?: number;
  maxRetries?: number;
}

/**
 * A System One classifier that sends no credential.
 *
 * Wire behavior (retries, timeouts, response validation, failure vocabulary) stays in the shared
 * transport, so a keyless channel and a keyed one differ only in whether `Authorization` is sent.
 */
export function createKeylessJevClassifier(options: KeylessJevClassifierOptions = {}): ProviderClassifier {
  return {
    async classify(
      model: ClassifierModel<string>,
      context: ClassifierContext,
      classOptions?: ClassifierOptions,
    ): Promise<ClassifierResult> {
      const result: ClassifierResult = {
        api: model.api,
        provider: model.provider,
        model: model.id,
        answers: {},
        stopReason: "stop",
        timestamp: Date.now(),
      };
      try {
        const baseUrl = model.baseUrl ?? options.baseUrl ?? JEV_DEFAULT_BASE_URL;
        const client = createJevClient({
          protocol: "decisions",
          baseUrl: systemOneUrl(baseUrl),
          model: model.id,
          apiKey: "",
          keyless: true,
          timeoutMs: classOptions?.timeoutMs ?? options.timeoutMs ?? 30_000,
          maxRetries: options.maxRetries ?? 2,
          ...(classOptions?.fetch ? { fetch: classOptions.fetch as typeof fetch } : {}),
        });
        const outcome = await client.ask(
          context.state,
          toWireQuestions(context.questions),
          classOptions?.signal ? { signal: classOptions.signal } : {},
        );
        if (!outcome.ok) {
          result.stopReason = outcome.reason === "cancelled" ? "aborted" : "error";
          result.errorMessage = outcome.message ?? `Jev unavailable (${outcome.reason})`;
          return result;
        }
        result.answers = toClassifierAnswers(context.questions, outcome.judgment.answers);
        return result;
      } catch (error) {
        result.stopReason = classOptions?.signal?.aborted ? "aborted" : "error";
        result.errorMessage = error instanceof Error ? error.message : String(error);
        return result;
      }
    },
  };
}

/** The provider registration both the host-level runtime and every session reuse. */
export function jevProviderConfig(baseUrl: string = JEV_DEFAULT_BASE_URL): ProviderConfig {
  return {
    name: "Jev (OpenCode Zen)",
    // Marks the provider configured; `authHeader: false` keeps the credential out of the request.
    apiKey: "keyless",
    authHeader: false,
    classifiers: { [JEV_CLASSIFIER_API]: createKeylessJevClassifier({ baseUrl }) },
    models: JEV_CLASSIFIER_MODELS.map((model) => ({
      type: "classifier" as const,
      id: model.id,
      name: model.name,
      api: JEV_CLASSIFIER_API,
      baseUrl,
      input: ["text"] as const,
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
      contextWindow: 32_000,
    })),
  };
}

/** Inline extension that registers Jev in a session's model runtime. */
export const JEV_PROVIDER_EXTENSION: InlineExtension = {
  name: "Jev",
  factory: (pi) => {
    pi.registerProvider(JEV_PROVIDER_ID, jevProviderConfig());
  },
};

/** Register Jev on a host-level runtime (auth APIs, the classifier probe, tests). */
export function registerJevProvider(modelRuntime: ModelRuntime, baseUrl?: string): void {
  modelRuntime.registerProvider(JEV_PROVIDER_ID, jevProviderConfig(baseUrl));
}
