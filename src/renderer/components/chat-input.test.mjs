import assert from "node:assert/strict";
import { mkdirSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import { pathToFileURL } from "node:url";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { build } from "esbuild";

const root = path.resolve(import.meta.dirname, "..", "..", "..");
const output = path.join(root, ".artifacts", "test-modules", `chat-input-${process.pid}.mjs`);
mkdirSync(path.dirname(output), { recursive: true });
await build({
  absWorkingDir: root,
  entryPoints: ["src/renderer/components/ChatInput.tsx"],
  outfile: output,
  tsconfig: path.join(root, "tsconfig.renderer.json"),
  bundle: true,
  format: "esm",
  platform: "node",
  external: ["react", "react-dom", "react-dom/*"],
  logLevel: "silent",
});
const { ChatInput } = await import(`${pathToFileURL(output).href}?v=${Date.now()}`);

function controls(props) {
  const html = renderToStaticMarkup(
    createElement(ChatInput, {
      onSend: () => {},
      onAbort: () => {},
      onCompactMemory: () => {},
      onCompactContext: () => {},
      onAbortCompaction: () => {},
      isStreaming: false,
      ...props,
    }),
  );
  const context = html.match(/<button[^>]*title="(?:Stop compaction|Compact context)"[^>]*>/)?.[0];
  const memory = html.match(/<button[^>]*>[^<]*(?:Compact to memory|Compacting…)<\/button>/)?.[0];
  assert.ok(context, "context compaction button is always visible");
  assert.ok(memory, "memory compaction button is always visible");
  return { context, memory };
}

test("memory compaction leaves only its own stop button enabled", () => {
  const { context, memory } = controls({ isCompacting: true, isMemoryCompacting: true });
  assert.match(context, /disabled=""/);
  assert.match(context, /title="Compact context"/);
  assert.doesNotMatch(memory, /disabled=""/);
});

test("context compaction leaves only its own stop button enabled", () => {
  const { context, memory } = controls({ isCompacting: true, isMemoryCompacting: false });
  assert.doesNotMatch(context, /disabled=""/);
  assert.match(context, /title="Stop compaction"/);
  assert.match(memory, /disabled=""/);
});
