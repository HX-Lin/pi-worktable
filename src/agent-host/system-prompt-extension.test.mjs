import assert from "node:assert/strict";
import test from "node:test";
import { createDesktopSystemPromptExtension } from "./system-prompt-extension.ts";

test("desktop prompt uses Pi's hook instead of writing its read-only state", () => {
  const settings = { forceEmpty: false, toolchainPrompt: "<toolchain>git</toolchain>" };
  let handler;
  createDesktopSystemPromptExtension(settings).factory({
    on(event, callback) {
      assert.equal(event, "before_agent_start");
      handler = callback;
    },
  });
  assert.deepEqual(handler({ systemPrompt: "Pi" }), { systemPrompt: "Pi\n\n<toolchain>git</toolchain>" });
  settings.forceEmpty = true;
  assert.deepEqual(handler({ systemPrompt: "Pi" }), { systemPrompt: "" });
  settings.forceEmpty = false;
  settings.toolchainPrompt = "";
  assert.deepEqual(handler({ systemPrompt: "Pi" }), { systemPrompt: "Pi" });
});
