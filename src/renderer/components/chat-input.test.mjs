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
      onCompactContext: () => {},
      onAbortCompaction: () => {},
      isStreaming: false,
      ...props,
    }),
  );
  const context = html.match(/<button[^>]*title="(?:Stop compaction|Compact context)"[^>]*>/)?.[0];
  assert.ok(context, "context compaction button is always visible");
  return { context };
}

test("the context compaction control is the only compaction control", () => {
  const idle = controls({ isCompacting: false }).context;
  assert.match(idle, /title="Compact context"/);
  const running = controls({ isCompacting: true }).context;
  assert.match(running, /title="Stop compaction"/);
  assert.doesNotMatch(running, /disabled=""/);
});
