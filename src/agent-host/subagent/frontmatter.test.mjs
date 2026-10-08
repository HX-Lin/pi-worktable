import assert from "node:assert/strict";
import test from "node:test";
import { setFrontmatterModel } from "./frontmatter.ts";

const withModel = `---\nname: scout\ndescription: Fast recon\nmodel: anthropic/claude-haiku-4-5\ntools: read\n---\n\nYou are a scout.\n`;
const withoutModel = `---\nname: scout\ndescription: Fast recon\n---\n\nYou are a scout.\n`;

test("a new model line is appended to the frontmatter", () => {
  const updated = setFrontmatterModel(withoutModel, "openai/gpt-5");
  assert.match(updated, /model: openai\/gpt-5/);
  assert.match(updated, /name: scout/);
  assert.match(updated, /You are a scout\./);
});

test("an existing model line is replaced, not duplicated", () => {
  const updated = setFrontmatterModel(withModel, "openai/gpt-5");
  assert.equal(updated.match(/^model:/gm).length, 1);
  assert.match(updated, /model: openai\/gpt-5/);
  assert.equal(updated.includes("claude-haiku-4-5"), false);
});

test("clearing the model removes the line and leaves the rest alone", () => {
  const updated = setFrontmatterModel(withModel, undefined);
  assert.equal(updated.includes("model:"), false);
  assert.equal(updated, `---\nname: scout\ndescription: Fast recon\ntools: read\n---\n\nYou are a scout.\n`);
});

test("the body is preserved byte for byte", () => {
  const body = "\n# Title\n\nLine with  trailing spaces  \n\n- [ ] task\n";
  const updated = setFrontmatterModel(`---\nname: a\ndescription: b\n---\n${body}`, "x/y");
  assert.ok(updated.endsWith(body));
});

test("a file without frontmatter gains one", () => {
  const updated = setFrontmatterModel("Just a prompt.\n", "x/y");
  assert.equal(updated, `---\nmodel: x/y\n---\n\nJust a prompt.\n`);
  assert.equal(setFrontmatterModel("Just a prompt.\n", undefined), "Just a prompt.\n");
});

test("a model value that needs quoting is quoted", () => {
  assert.match(setFrontmatterModel(withoutModel, "vendor/model:beta"), /model: "vendor\/model:beta"/);
});

test("a value with a line break is rejected instead of injected", () => {
  assert.throws(() => setFrontmatterModel(withoutModel, "x/y\nname: evil"), /line break/);
  assert.throws(() => setFrontmatterModel(withoutModel, "x/y\r\nname: evil"), /line break/);
});
