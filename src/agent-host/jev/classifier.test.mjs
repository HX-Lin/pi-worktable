import assert from "node:assert/strict";
import { mkdirSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import { pathToFileURL } from "node:url";
import { build } from "esbuild";

const root = path.resolve(import.meta.dirname, "..", "..", "..");
const outDir = path.join(root, ".artifacts", "test-modules");
mkdirSync(outDir, { recursive: true });

async function bundle(entry, name) {
  const output = path.join(outDir, `jev-${name}-${process.pid}.mjs`);
  await build({
    absWorkingDir: root,
    entryPoints: [entry],
    outfile: output,
    bundle: true,
    format: "esm",
    platform: "node",
    packages: "external",
    logLevel: "silent",
  });
  return import(`${pathToFileURL(output).href}?v=${Date.now()}`);
}

const shapes = await bundle("src/agent-host/jev/classifier-shapes.ts", "shapes");
const { createClassifyJevClient } = await bundle("src/agent-host/jev/classify-client.ts", "client");

const classifierQuestions = {
  risk: { type: "bool", instructions: "does it touch the network?", criteria: { true: "yes", false: "no" } },
  difficulty: { type: "score", instructions: "how hard?", criteria: ["easy", "hard"] },
  mode: { type: "choice", instructions: "pick one", criteria: { keep: "keep", drop: "drop" } },
};

test("pi's bool questions travel as the wire's noul questions", () => {
  const wire = shapes.toWireQuestions(classifierQuestions);
  assert.equal(wire.risk.type, "noul");
  assert.deepEqual(wire.risk.criteria, { true: "yes", false: "no" });
  assert.equal(wire.difficulty.type, "score");
  assert.equal(wire.mode.type, "choice");
});

test("wire questions map back to classifier questions", () => {
  const wire = {
    risk: { type: "noul", instructions: "does it touch the network?", criteria: { true: "yes", false: "no" } },
    stale: { type: "score", instructions: "how stale?" },
  };
  const mapped = shapes.toClassifierQuestions(wire);
  assert.equal(mapped.risk.type, "bool");
  assert.equal(mapped.stale.type, "score");
});

test("answers round-trip through both vocabularies", () => {
  const wireAnswers = { risk: { noul: 0.75 }, difficulty: { score: 1, confidence: 0.5 } };
  const classifierAnswers = shapes.toClassifierAnswers(classifierQuestions, wireAnswers);
  assert.deepEqual(classifierAnswers.risk, { type: "bool", probability: 0.75 });
  assert.deepEqual(classifierAnswers.difficulty, { type: "score", score: 1, confidence: 0.5 });
  assert.deepEqual(shapes.toWireAnswers(classifierQuestions, classifierAnswers), {
    risk: { noul: 0.75 },
    difficulty: { score: 1, confidence: 0.5 },
  });
});

test("an answer of the wrong shape is dropped, not coerced", () => {
  const mapped = shapes.toClassifierAnswers(classifierQuestions, { risk: { score: 3 } });
  assert.equal(Object.keys(mapped).length, 0);
});

function fakeRegistry({ missing = false, result } = {}) {
  const model = { api: "typesafe-system-one", provider: "jev", id: "jev-1.13-free" };
  return {
    findOfType: () => (missing ? undefined : model),
    classify: async () => ({
      api: "typesafe-system-one",
      provider: "jev",
      model: "jev-1.13-free",
      answers: {
        risk: { type: "bool", probability: 0.2 },
        difficulty: { type: "score", score: 1, confidence: 0.9 },
      },
      stopReason: "stop",
      timestamp: Date.now(),
      ...result,
    }),
  };
}

const asked = {
  risk: { type: "noul", instructions: "does it touch the network?" },
  difficulty: { type: "score", instructions: "how hard?" },
};

test("a classifier answer becomes a Jev judgment", async () => {
  const client = createClassifyJevClient(fakeRegistry());
  const outcome = await client.ask({ step: "edit" }, asked);
  assert.equal(outcome.ok, true);
  assert.equal(outcome.judgment.answers.risk.noul, 0.2);
  assert.equal(outcome.judgment.answers.difficulty.score, 1);
  assert.deepEqual(outcome.judgment.missing, []);
  assert.equal(outcome.judgment.model, "jev-1.13-free");
});

test("questions the classifier skipped are reported as missing", async () => {
  const client = createClassifyJevClient(
    fakeRegistry({ result: { answers: { risk: { type: "bool", probability: 1 } } } }),
  );
  const outcome = await client.ask({ step: "edit" }, asked);
  assert.equal(outcome.ok, true);
  assert.deepEqual(outcome.judgment.missing, ["difficulty"]);
});

test("a stopped classifier is a failure, never an approval", async () => {
  const client = createClassifyJevClient(
    fakeRegistry({ result: { answers: {}, stopReason: "error", errorMessage: "System One API error (401)" } }),
  );
  const outcome = await client.ask({ step: "edit" }, asked);
  assert.equal(outcome.ok, false);
  assert.equal(outcome.reason, "http");
  assert.match(outcome.message, /401/u);
});

test("an aborted classifier reports cancellation", async () => {
  const client = createClassifyJevClient(fakeRegistry({ result: { answers: {}, stopReason: "aborted" } }));
  const outcome = await client.ask({ step: "edit" }, asked);
  assert.equal(outcome.ok, false);
  assert.equal(outcome.reason, "cancelled");
});

test("an unregistered classifier is unavailable rather than guessed", async () => {
  const client = createClassifyJevClient(fakeRegistry({ missing: true }));
  const outcome = await client.ask({ step: "edit" }, asked);
  assert.equal(outcome.ok, false);
  assert.equal(outcome.reason, "unknown");
  assert.match(outcome.message, /not registered/u);
});

test("askOrThrow raises the app's unavailable error", async () => {
  const client = createClassifyJevClient(fakeRegistry({ missing: true }));
  // The class comes from the client's own bundle, so match on its shape, not on identity.
  await assert.rejects(
    () => client.askOrThrow({ step: "edit" }, asked),
    (error) => error.name === "JevUnavailableError" && error.reason === "unknown",
  );
});
