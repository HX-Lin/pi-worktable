import assert from "node:assert/strict";
import test from "node:test";
import {
  PRESET_DEFAULT,
  PRESET_FULL,
  PRESET_FULL_EXTENSIONS,
  getPresetFromTools,
  getToolNamesForPreset,
} from "./tool-presets.ts";

function entries(names) {
  return names.map((name) => ({ name, description: "", active: true }));
}

test("none disables every tool", () => {
  assert.deepEqual(getToolNamesForPreset("none"), []);
});

test("default is the four core coding tools", () => {
  assert.deepEqual(getToolNamesForPreset("default"), [...PRESET_DEFAULT]);
});

test("full adds the extension tools on top of the coding tools", () => {
  const names = getToolNamesForPreset("full");
  assert.deepEqual(names, [...PRESET_FULL, ...PRESET_FULL_EXTENSIONS]);
  assert.ok(names.includes("codemode"));
});

test("preset detection round-trips every preset", () => {
  for (const preset of ["none", "default", "full"]) {
    assert.equal(getPresetFromTools(entries(getToolNamesForPreset(preset))), preset, preset);
  }
});

test("preset detection ignores extension tools an extension activated", () => {
  const tools = [...entries(PRESET_FULL), { name: "tool_search", description: "", active: true }];
  assert.equal(getPresetFromTools(tools), "full");
});

test("preset detection still reports full when codemode is inactive", () => {
  assert.equal(getPresetFromTools(entries(PRESET_FULL)), "full");
});
