/**
 * The host-side Jev client: pi's `ModelRegistry.classify()` behind the asker interface the gate, the
 * compaction and the router already speak.
 *
 * Keeping the `JevClient` shape means the decision logic (policy, thresholds, verdicts, compaction
 * planning) is untouched by the move to upstream classifiers — only where the answers come from
 * changes. Failures keep the app's vocabulary, so every consumer still treats them as "no answer"
 * rather than as an approval.
 */
import type { ModelRegistry } from "@earendil-works/pi-coding-agent";
import { JEV_DEFAULT_MODEL, JEV_PROVIDER_ID } from "./classifier-provider";
import { toClassifierQuestions, toWireAnswers } from "./classifier-shapes";
import {
  JevUnavailableError,
  type JevAskOptions,
  type JevClient,
  type JevJudgment,
  type JevOutcome,
  type JevQuestionShape,
} from "./transport";

export interface JevClassifierRef {
  provider: string;
  id: string;
}

/** A classifier-backed client for one Jev classifier model. */
export function createClassifyJevClient(registry: ModelRegistry, ref: Partial<JevClassifierRef> = {}): JevClient {
  const provider = ref.provider ?? JEV_PROVIDER_ID;
  const id = ref.id ?? JEV_DEFAULT_MODEL;

  const ask = async (
    state: unknown,
    questions: Record<string, JevQuestionShape>,
    options: JevAskOptions = {},
  ): Promise<JevOutcome> => {
    const model = registry.findOfType("classifier", provider, id);
    if (!model) {
      return { ok: false, reason: "unknown", message: `classifier ${provider}/${id} is not registered` };
    }
    const classifierQuestions = toClassifierQuestions(questions);
    const started = Date.now();
    try {
      const result = await registry.classify(
        model,
        { state: state as never, questions: classifierQuestions },
        options.signal ? { signal: options.signal } : {},
      );
      if (result.stopReason !== "stop") {
        return {
          ok: false,
          reason: result.stopReason === "aborted" ? "cancelled" : "http",
          message: result.errorMessage ?? `Jev classifier stopped with ${result.stopReason}`,
        };
      }
      const answers = toWireAnswers(classifierQuestions, result.answers);
      const judgment: JevJudgment = {
        model: result.model,
        answers,
        missing: Object.keys(questions).filter((name) => !answers[name]),
        inputTokens: result.usage?.input ?? 0,
        outputTokens: result.usage?.output ?? 0,
        ms: Date.now() - started,
        requests: 1,
      };
      return { ok: true, judgment };
    } catch (error) {
      // Cancellation is control flow, not a verdict.
      if (options.signal?.aborted) throw error;
      return { ok: false, reason: "unknown", message: error instanceof Error ? error.message : String(error) };
    }
  };

  return {
    ask,
    async askOrThrow(state, questions, options) {
      const outcome = await ask(state, questions, options);
      if (!outcome.ok) throw new JevUnavailableError(outcome.reason, outcome.status, outcome.message);
      return outcome.judgment;
    },
  };
}
