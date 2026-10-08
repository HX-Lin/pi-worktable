import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { pathToFileURL } from "node:url";
import { build } from "esbuild";

const root = path.resolve(import.meta.dirname, "..", "..", "..");
const output = path.join(root, ".artifacts", "test-modules", `memory-store-${process.pid}.mjs`);
await build({
  absWorkingDir: root,
  entryPoints: ["src/agent-host/memory/store.ts"],
  outfile: output,
  bundle: true,
  format: "esm",
  platform: "node",
  packages: "external",
  logLevel: "silent",
});
const {
  MAX_INJECTED_CHARS,
  MAX_INJECTED_ENTRIES,
  addMemory,
  memoryFilePath,
  readMemory,
  removeMemory,
  renderMemory,
  resolveMemoryId,
  updateMemory,
} = await import(`${pathToFileURL(output).href}?v=${Date.now()}`);
process.once("exit", () => rmSync(output, { force: true }));

function withProject(run) {
  const dir = mkdtempSync(path.join(tmpdir(), "pi-memory-"));
  try {
    return run(dir);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

test("memory lives in the project's pi config directory", () => {
  withProject((dir) => {
    assert.equal(memoryFilePath(dir), path.join(dir, ".pi", "memory.json"));
    assert.deepEqual(readMemory(dir), []);
    assert.equal(renderMemory([]), "");
  });
});

test("adding the same fact twice refreshes it instead of duplicating", () => {
  withProject((dir) => {
    const first = addMemory(dir, { text: "Run npm run typecheck", tag: "build" });
    const second = addMemory(dir, { text: "Run npm run typecheck" });
    assert.equal(first.id, second.id);
    assert.equal(readMemory(dir).length, 1);
    assert.equal(second.tag, "build");
  });
});

test("update and remove work by id or short prefix", () => {
  withProject((dir) => {
    const entry = addMemory(dir, { text: "old fact" });
    assert.equal(resolveMemoryId(dir, entry.id.slice(0, 8)), entry.id);
    assert.equal(resolveMemoryId(dir, "nope"), null);

    // The tool resolves a short prefix first; update/remove take a full id.
    const updated = updateMemory(dir, { id: resolveMemoryId(dir, entry.id.slice(0, 8)), text: "new fact" });
    assert.equal(updated.text, "new fact");

    assert.equal(removeMemory(dir, entry.id), true);
    assert.equal(removeMemory(dir, entry.id), false);
  });
});

test("clearing a tag removes the key", () => {
  withProject((dir) => {
    const entry = addMemory(dir, { text: "t", tag: "build" });
    const cleared = updateMemory(dir, { id: entry.id, tag: "" });
    assert.equal("tag" in cleared, false);
  });
});

test("injection is capped in both entries and characters", () => {
  const many = Array.from({ length: MAX_INJECTED_ENTRIES + 10 }, (_, index) => ({
    id: `id-${index}`,
    text: `fact ${index}`,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: `2026-01-01T00:00:${String(index).padStart(2, "0")}.000Z`,
  }));
  const rendered = renderMemory(many);
  assert.equal(rendered.split("\n").filter((line) => line.startsWith("- ")).length, MAX_INJECTED_ENTRIES);
  assert.match(rendered, /older entries not shown/);
  // Newest first: the highest timestamp is the first bullet.
  assert.match(rendered, /- fact 69/);

  const huge = Array.from({ length: 50 }, (_, index) => ({
    id: `big-${index}`,
    text: "x".repeat(400),
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
  }));
  const bounded = renderMemory(huge);
  assert.ok(bounded.length < MAX_INJECTED_CHARS + 400);
  assert.match(bounded, /older entries not shown/);
});

test("a corrupt file degrades to the valid entries", () => {
  withProject((dir) => {
    addMemory(dir, { text: "keep me" });
    const file = memoryFilePath(dir);
    const parsed = JSON.parse(readFileSync(file, "utf8"));
    parsed.entries.push({ text: "no id" }, { id: "only-id" });
    writeFileSync(file, JSON.stringify(parsed));
    assert.deepEqual(
      readMemory(dir).map((entry) => entry.text),
      ["keep me"],
    );
  });
});
