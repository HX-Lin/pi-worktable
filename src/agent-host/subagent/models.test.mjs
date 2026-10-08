import assert from "node:assert/strict";
import test from "node:test";
import { effectiveModelRef, formatModelRef, parseModelRef, resolveAgentModel } from "./models.ts";

const model = (provider, id) => ({ provider, id });

/** Minimal stand-in for the SDK's ModelRuntime. */
const runtime = (models) => ({
  getModels: () => models,
  getModel: (provider, id) => models.find((m) => m.provider === provider && m.id === id),
});

const CONFIGURED = [
  model("anthropic", "claude-sonnet-4-5"),
  model("anthropic", "claude-haiku-4-5"),
  model("openai", "gpt-5"),
];

test("a model reference is provider/model-id, or a bare id", () => {
  assert.deepEqual(parseModelRef("anthropic/claude-sonnet-4-5"), {
    provider: "anthropic",
    modelId: "claude-sonnet-4-5",
  });
  assert.deepEqual(parseModelRef("gpt-5"), { provider: "", modelId: "gpt-5" });
  assert.equal(parseModelRef(""), null);
  assert.equal(parseModelRef("/gpt-5"), null);
  assert.equal(parseModelRef("openai/"), null);
});

test("a qualified reference resolves to exactly that model", () => {
  const resolved = resolveAgentModel(runtime(CONFIGURED), "openai/gpt-5");
  assert.equal(resolved.ok, true);
  assert.equal(formatModelRef(resolved.model), "openai/gpt-5");
});

test("a bare id resolves when only one provider offers it", () => {
  const resolved = resolveAgentModel(runtime(CONFIGURED), "gpt-5");
  assert.equal(resolved.ok, true);
  assert.equal(formatModelRef(resolved.model), "openai/gpt-5");
});

test("an ambiguous bare id is rejected and lists the candidates", () => {
  const resolved = resolveAgentModel(runtime(CONFIGURED), "claude-sonnet-4-5");
  assert.equal(resolved.ok, true);

  const ambiguous = resolveAgentModel(runtime([model("anthropic", "shared"), model("openrouter", "shared")]), "shared");
  assert.equal(ambiguous.ok, false);
  assert.match(ambiguous.error, /ambiguous/);
  assert.match(ambiguous.error, /anthropic\/shared/);
  assert.match(ambiguous.error, /openrouter\/shared/);
});

test("an unknown model names what is available", () => {
  const resolved = resolveAgentModel(runtime(CONFIGURED), "anthropic/nope");
  assert.equal(resolved.ok, false);
  assert.match(resolved.error, /Unknown model "anthropic\/nope"/);
  assert.match(resolved.error, /openai\/gpt-5/);
});

test("the call-site override wins over the agent definition", () => {
  assert.equal(effectiveModelRef("anthropic/claude-haiku-4-5", "openai/gpt-5"), "openai/gpt-5");
  assert.equal(effectiveModelRef("anthropic/claude-haiku-4-5", undefined), "anthropic/claude-haiku-4-5");
  assert.equal(effectiveModelRef("anthropic/claude-haiku-4-5", "  "), "anthropic/claude-haiku-4-5");
  assert.equal(effectiveModelRef(undefined, undefined), undefined);
  assert.equal(effectiveModelRef("  ", undefined), undefined);
});
