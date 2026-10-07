import assert from "node:assert/strict";
import test from "node:test";
import { withExtensionTools } from "./tool-activation.ts";

function session({ tools = [], active = [] } = {}) {
  return {
    getAllTools: () => tools,
    getActiveToolNames: () => active,
  };
}

test("an empty preset disables every tool, including extension tools", () => {
  const probe = session({ tools: [{ name: "codemode", exposure: "codemode" }], active: ["codemode"] });
  assert.deepEqual(withExtensionTools(probe, []), []);
});

test("direct extension tools join the preset", () => {
  const probe = session({
    tools: [
      { name: "read", exposure: "direct" },
      { name: "mcp__probe__echo", exposure: "direct" },
      { name: "mcp__probe__secret", exposure: "deferred" },
    ],
  });
  assert.deepEqual(withExtensionTools(probe, ["read", "bash"]), ["read", "bash", "mcp__probe__echo"]);
});

test("indirect tools an extension activated survive a preset rebuild", () => {
  const probe = session({
    tools: [
      { name: "codemode", exposure: "codemode" },
      { name: "tool_search", exposure: "deferred" },
      { name: "mcp__probe__secret", exposure: "deferred" },
    ],
    active: ["codemode", "tool_search", "mcp__probe__secret"],
  });
  assert.deepEqual(withExtensionTools(probe, ["read"]), ["read", "codemode", "tool_search", "mcp__probe__secret"]);
});

test("indirect tools that are not active stay out", () => {
  const probe = session({
    tools: [
      { name: "codemode", exposure: "codemode" },
      { name: "mcp__probe__secret", exposure: "deferred" },
    ],
    active: ["codemode"],
  });
  assert.deepEqual(withExtensionTools(probe, ["read"]), ["read", "codemode"]);
});

test("hidden tools are never activated", () => {
  const probe = session({ tools: [{ name: "hidden_tool", exposure: "hidden" }], active: ["hidden_tool"] });
  assert.deepEqual(withExtensionTools(probe, ["read"]), ["read"]);
});

test("tools without an exposure count as direct", () => {
  const probe = session({ tools: [{ name: "legacy_extension_tool" }] });
  assert.deepEqual(withExtensionTools(probe, ["read"]), ["read", "legacy_extension_tool"]);
});

test("built-in coding tools are never added twice", () => {
  const probe = session({ tools: [{ name: "grep", exposure: "direct" }] });
  assert.deepEqual(withExtensionTools(probe, ["read", "read", "grep"]), ["read", "grep"]);
});
