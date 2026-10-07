/**
 * The Jev service: one place the RPC, the gate, the compaction and the routing
 * all reach Jev through, so key resolution and channel selection happen once.
 *
 * Every consumer asks for a client and gets one for the currently configured
 * channel; nothing else in the app knows about protocols, vault keys or env
 * variables.
 */
import type { ModelRegistry } from "@earendil-works/pi-coding-agent";
import { findJevChannel, envKeyVariable, JEV_CHANNELS, type JevChannelDefinition } from "./channels";
import { JEV_DEFAULT_MODEL, JEV_PROVIDER_ID } from "./classifier-provider";
import { createClassifyJevClient } from "./classify-client";
import { resolveJevKey, storeJevKey, clearJevKey } from "./keys";
import { readJevSettings, resolveJevEndpoint, writeJevSettings, type JevSettings } from "./settings";
import { createJevClient, type JevClient } from "./transport";
import { DEFAULT_RULES } from "./gate/questions";

export interface JevChannelStatus {
  id: string;
  label: string;
  protocol: "decisions" | "chat" | "evaluate";
  /** Effective endpoint and model, i.e. the override when one is set. */
  baseUrl: string;
  model: string;
  /** What clearing the override gives back, for the field placeholder. */
  defaultBaseUrl: string;
  defaultModel: string;
  keyHint: string;
  /** `env` / `vault` / null (nothing configured). */
  keySource: "env" | "vault" | null;
  keyVariable: string | null;
  hasKey: boolean;
  /** Free/keyless channel: no key is needed and none is sent. */
  keyless: boolean;
}

export interface JevConfigPayload {
  settings: JevSettings;
  channel: JevChannelStatus;
  channels: Array<{
    id: string;
    label: string;
    protocol: "decisions" | "chat" | "evaluate";
    keyHint: string;
    keyless?: boolean;
  }>;
  rules: JevRuleInfo[];
  /** Classifier models the app can reach, keyless entry first. */
  classifiers: JevClassifierInfo[];
}

export interface JevClassifierInfo {
  provider: string;
  id: string;
  name: string;
  /** Registered by the app and served without a key. */
  keyless: boolean;
  /** The one the current settings resolve to. */
  active: boolean;
}

export interface JevRuleInfo {
  id: string;
  label: string;
  threshold: number;
  mode: "required" | "hazard";
  severity: "hazard" | "soft";
  question: string;
}

/** The gate's condition table, so Settings can offer a threshold per rule. */
export function jevRuleTable(): JevRuleInfo[] {
  return DEFAULT_RULES.map((rule) => ({
    id: rule.id,
    label: rule.label,
    threshold: rule.threshold,
    mode: rule.mode,
    severity: rule.severity,
    question: rule.question,
  }));
}

export interface JevTestResult {
  ok: boolean;
  reason?: string;
  message?: string;
  model?: string;
  /** The answered probability, so a wrong model or key is visible immediately. */
  probability?: number;
  latencyMs?: number;
  /** `provider/id` of the classifier that answered. */
  classifier?: string;
}

/** Resolved channel + credentials + client for one judgment. */
export interface JevRuntime {
  settings: JevSettings;
  channel: JevChannelDefinition;
  baseUrl: string;
  model: string;
  client: JevClient;
}

export async function describeJevChannel(settings: JevSettings): Promise<JevChannelStatus> {
  const { channel, baseUrl, model } = resolveJevEndpoint(settings);
  const key = await resolveJevKey(channel);
  return {
    id: channel.id,
    label: channel.label,
    protocol: channel.protocol,
    baseUrl,
    model,
    defaultBaseUrl: channel.baseUrl,
    defaultModel: channel.model,
    keyHint: channel.keyHint,
    keySource: key.source,
    keyVariable: key.source === "env" ? key.envVariable : envKeyVariable(channel),
    hasKey: channel.keyless === true || key.apiKey.length > 0,
    keyless: channel.keyless === true,
  };
}

export async function readJevConfig(modelRegistry?: ModelRegistry | null): Promise<JevConfigPayload> {
  const settings = readJevSettings();
  return {
    settings,
    rules: jevRuleTable(),
    channel: await describeJevChannel(settings),
    channels: JEV_CHANNELS.map((channel) => ({
      id: channel.id,
      label: channel.label,
      protocol: channel.protocol,
      keyHint: channel.keyHint,
      keyless: channel.keyless === true,
    })),
    classifiers: listClassifiers(modelRegistry, settings.classifier),
  };
}

/**
 * The classifiers a user can pick. The app's own `jev` provider is always there and needs no key;
 * any other provider that has credentials and publishes a classifier joins the list.
 */
export function listClassifiers(
  modelRegistry: ModelRegistry | null | undefined,
  active: string | null | undefined,
): JevClassifierInfo[] {
  if (!modelRegistry) return [];
  const activeRef = `${parseClassifierRef(active).provider}/${parseClassifierRef(active).id}`;
  return modelRegistry
    .getModelsOfType("classifier")
    .filter(
      (model) => model.provider === JEV_PROVIDER_ID || modelRegistry.getProviderAuthStatus(model.provider).configured,
    )
    .map((model) => ({
      provider: model.provider,
      id: model.id,
      name: model.name ?? model.id,
      keyless: model.provider === JEV_PROVIDER_ID,
      active: `${model.provider}/${model.id}` === activeRef,
    }))
    .sort((left, right) => Number(right.keyless) - Number(left.keyless) || left.id.localeCompare(right.id));
}

export async function updateJevConfig(patch: unknown, modelRegistry?: ModelRegistry | null): Promise<JevConfigPayload> {
  writeJevSettings(patch);
  return readJevConfig(modelRegistry);
}

/** Store (or clear) the key for the configured channel in the vault. */
export async function setJevKey(apiKey: string, modelRegistry?: ModelRegistry | null): Promise<JevConfigPayload> {
  const channel = findJevChannel(readJevSettings().channel);
  if (apiKey.trim()) await storeJevKey(channel, apiKey);
  else await clearJevKey(channel);
  return readJevConfig(modelRegistry);
}

/**
 * The classifier the settings name, or the app's own keyless Jev provider.
 *
 * `provider/id` selects any classifier in the catalog; a bare id stays on `jev` so an older
 * settings file keeps working.
 */
export function parseClassifierRef(value: string | null | undefined): { provider: string; id: string } {
  const trimmed = (value ?? "").trim();
  if (!trimmed) return { provider: JEV_PROVIDER_ID, id: JEV_DEFAULT_MODEL };
  const slash = trimmed.indexOf("/");
  if (slash <= 0 || slash === trimmed.length - 1) return { provider: JEV_PROVIDER_ID, id: trimmed };
  return { provider: trimmed.slice(0, slash), id: trimmed.slice(slash + 1) };
}

/**
 * Build a client for the current settings, or null when Jev cannot be used
 * (disabled, or no key anywhere). Callers treat null as "no Jev available".
 *
 * When a model registry is available the call goes through pi's classifier API
 * (`ModelRegistry.classify()`); the app's `jev` provider serves that keylessly, and any other
 * classifier the user has credentials for works too. The channel/key path stays as the fallback for
 * a classifier that is not in the catalog and for callers without a registry.
 */
export async function getJevRuntime(
  modelRegistry?: ModelRegistry | null,
  overrides: Partial<JevSettings> = {},
): Promise<JevRuntime | null> {
  const settings = { ...readJevSettings(), ...overrides };
  if (!settings.enabled) return null;
  const { channel, baseUrl, model } = resolveJevEndpoint(settings);

  if (modelRegistry) {
    const ref = parseClassifierRef(settings.classifier);
    const classifier = modelRegistry.findOfType("classifier", ref.provider, ref.id);
    if (classifier) {
      return {
        settings,
        channel,
        baseUrl: baseUrl.trim() || channel.baseUrl,
        model: `${ref.provider}/${ref.id}`,
        client: createClassifyJevClient(modelRegistry, ref),
      };
    }
  }

  const key = await resolveJevKey(channel);
  if (!key.apiKey && !channel.keyless) return null;
  // A channel that is not fully configured is not a runtime: report it as
  // unavailable rather than sending a request to an empty URL.
  if (!baseUrl.trim() || !model.trim()) return null;
  return {
    settings,
    channel,
    baseUrl,
    model,
    client: createJevClient({
      protocol: channel.protocol,
      baseUrl,
      model,
      apiKey: key.apiKey,
      keyless: channel.keyless === true,
      ...(channel.headers ? { headers: channel.headers } : {}),
      timeoutMs: settings.gate.timeoutMs,
      maxRetries: settings.gate.maxRetries,
    }),
  };
}

/**
 * A live end-to-end probe for the Settings button: it proves the key, the
 * protocol and the model slug in one call and reports the answered probability,
 * which is what tells a working channel from one that merely returns 200.
 */
export async function testJevChannel(modelRegistry?: ModelRegistry | null): Promise<JevTestResult> {
  // The classifier path is what the gate, the compaction and the router actually use, so it is what
  // the Test button must prove.
  if (modelRegistry) {
    const runtime = await getJevRuntime(modelRegistry, { enabled: true });
    if (runtime) {
      const classifier = runtime.model;
      const started = Date.now();
      const outcome = await runtime.client.ask({ value: "ok" }, {
        probe: {
          type: "noul",
          instructions: "The text in `value` is exactly the word ok.",
          criteria: { true: "value is the word ok", false: "it is not" },
        },
      } as never);
      const latencyMs = Date.now() - started;
      if (!outcome.ok) {
        return { ok: false, reason: outcome.reason, message: outcome.message, latencyMs, classifier };
      }
      const answer = outcome.judgment.answers.probe;
      if (!answer || typeof answer.noul !== "number") {
        return {
          ok: false,
          reason: "no_answer",
          message: "The classifier replied but did not answer the probe question.",
          model: outcome.judgment.model,
          latencyMs,
          classifier,
        };
      }
      return { ok: true, model: outcome.judgment.model, probability: answer.noul, latencyMs, classifier };
    }
  }

  // Fallback: report the keyed HTTP channel field by field, because `getJevRuntime`'s single null
  // answer cannot say *what* is missing — which is the whole point of a Test button.
  const settings = { ...readJevSettings(), enabled: true };
  const { channel, baseUrl, model } = resolveJevEndpoint(settings);
  if (!baseUrl.trim()) {
    return { ok: false, reason: "no_endpoint", message: `Set the endpoint URL for ${channel.label}.` };
  }
  if (!model.trim()) {
    return { ok: false, reason: "no_model", message: `Set the model name for ${channel.label}.` };
  }
  const key = await resolveJevKey(channel);
  if (!key.apiKey && !channel.keyless) {
    return { ok: false, reason: "no_key", message: `No API key is configured for ${channel.label}.` };
  }

  const runtime = {
    client: createJevClient({
      protocol: channel.protocol,
      baseUrl,
      model,
      apiKey: key.apiKey,
      keyless: channel.keyless === true,
      ...(channel.headers ? { headers: channel.headers } : {}),
      timeoutMs: settings.gate.timeoutMs,
      maxRetries: settings.gate.maxRetries,
    }),
  };

  const started = Date.now();
  const outcome = await runtime.client.ask(
    { value: "ok" },
    {
      probe: {
        type: "noul",
        instructions: "The text in `value` is exactly the word ok.",
        criteria: { true: "value is the word ok", false: "it is not" },
      },
    },
  );
  const latencyMs = Date.now() - started;
  if (!outcome.ok) {
    return { ok: false, reason: outcome.reason, message: outcome.message, latencyMs };
  }
  const answer = outcome.judgment.answers.probe;
  if (!answer || typeof answer.noul !== "number") {
    return {
      ok: false,
      reason: "no_answer",
      message: "The endpoint replied but did not answer the probe question.",
      model: outcome.judgment.model,
      latencyMs,
    };
  }
  return { ok: true, model: outcome.judgment.model, probability: answer.noul, latencyMs };
}
