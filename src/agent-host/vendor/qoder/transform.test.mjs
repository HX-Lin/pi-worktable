import assert from "node:assert/strict";
import test from "node:test";
import { prepareQoderContext } from "./transform.ts";

const tool = (name) => ({ name, description: name, parameters: { type: "object", properties: {} } });

test("Qoder reads the current prompt and tool declarations from Pi's transcript", () => {
  const context = {
    messages: [
      { role: "system", content: "Base instructions", toolsAdded: [tool("old")], timestamp: 0 },
      { role: "user", content: "first", timestamp: 1 },
      {
        role: "system",
        content: "Updated instructions",
        toolsRemoved: [{ name: "old" }],
        toolsAdded: [tool("current")],
        timestamp: 2,
      },
      { role: "user", content: "next", timestamp: 3 },
    ],
  };
  const { normalizedMessages, systemText, toolsRaw } = prepareQoderContext(context);
  assert.equal(systemText, "Base instructions\n\nUpdated instructions");
  assert.deepEqual(normalizedMessages, [
    { role: "user", content: "first" },
    { role: "user", content: "next" },
  ]);
  assert.deepEqual(toolsRaw?.map((tool) => tool.function.name), ["current"]);
});

test("Qoder handles a transcript without system messages or tools", () => {
  const { normalizedMessages, systemText, toolsRaw } = prepareQoderContext({
    messages: [{ role: "user", content: "hello", timestamp: 1 }],
  });
  assert.deepEqual(normalizedMessages, [{ role: "user", content: "hello" }]);
  assert.equal(systemText, "");
  assert.equal(toolsRaw, undefined);
});
