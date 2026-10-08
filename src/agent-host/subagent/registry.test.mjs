import assert from "node:assert/strict";
import test from "node:test";

import { buildAgentFile, findAgentTemplate, isValidAgentName, AGENT_TEMPLATES } from "../../shared/agent-templates.ts";
import { listSubagentRuns, resetSubagentRunsForTests, startSubagentRun } from "./registry.ts";

test("agent templates are unique, named plainly, and carry a body", () => {
  const ids = new Set(AGENT_TEMPLATES.map((template) => template.id));
  assert.equal(ids.size, AGENT_TEMPLATES.length);
  for (const template of AGENT_TEMPLATES) {
    assert.ok(isValidAgentName(template.name), `${template.name} should be a valid agent name`);
    assert.ok(template.body.trim().length > 40, `${template.id} needs a usable prompt`);
    assert.ok(template.description.trim().length > 0);
  }
});

test("agent names are constrained because they become file names", () => {
  assert.ok(isValidAgentName("reviewer"));
  assert.ok(isValidAgentName("my-agent_2"));
  assert.ok(!isValidAgentName("Reviewer"));
  assert.ok(!isValidAgentName("-leading"));
  assert.ok(!isValidAgentName("has space"));
  assert.ok(!isValidAgentName("a".repeat(49)));
});

test("buildAgentFile writes frontmatter the loader can read", () => {
  const template = findAgentTemplate("review");
  assert.ok(template);
  const file = buildAgentFile(template, "reviewer", "  review   my\nchanges ");
  const [head, name, description] = file.split("\n");
  assert.equal(head, "---");
  assert.equal(name, "name: reviewer");
  assert.equal(description, "description: review my changes");
  assert.ok(file.includes(template.body));
  assert.ok(file.endsWith("\n"));
});

test("subagent runs are listed running-first, then newest, and pruned", () => {
  resetSubagentRunsForTests();
  const first = startSubagentRun({ agent: "scout", task: "find it", cwd: "/w" });
  first.update("read src/index.ts");
  const second = startSubagentRun({ agent: "reviewer", task: "review it", cwd: "/w", model: "openai/gpt" });
  first.finish({ ok: true, tokens: 120 });

  const runs = listSubagentRuns();
  assert.equal(runs.length, 2);
  assert.equal(runs[0].agent, "reviewer");
  assert.equal(runs[0].status, "running");
  assert.equal(runs[1].status, "done");
  assert.equal(runs[1].lastLine, "read src/index.ts");
  assert.equal(runs[1].tokens, 120);
  assert.equal(runs[0].model, "openai/gpt");
  assert.ok(runs[1].finishedAt !== undefined);

  second.finish({ ok: false, error: "boom" });
  const failed = listSubagentRuns().find((run) => run.id === second.id);
  assert.ok(failed);
  assert.equal(failed.status, "failed");
  assert.equal(failed.error, "boom");

  // A cancelled run is terminal too, and must not stay "running".
  const third = startSubagentRun({ agent: "worker", task: "chore", cwd: "/w" });
  third.cancel();
  assert.equal(listSubagentRuns().find((run) => run.id === third.id)?.status, "cancelled");
  resetSubagentRunsForTests();
});
