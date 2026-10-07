import assert from "node:assert/strict";
import { mkdirSync, readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import { pathToFileURL } from "node:url";
import { build } from "esbuild";

const root = path.resolve(import.meta.dirname, "..", "..");
const outputDirectory = path.join(root, ".artifacts", "test-modules");
mkdirSync(outputDirectory, { recursive: true });
const outputFile = path.join(outputDirectory, `runtime-version-${process.pid}.mjs`);
await build({
  absWorkingDir: root,
  entryPoints: ["src/agent-host/runtime-version.ts"],
  outfile: outputFile,
  bundle: true,
  format: "esm",
  platform: "node",
  packages: "external",
  sourcemap: false,
  logLevel: "silent",
});
const { readPiRuntimeVersion } = await import(`${pathToFileURL(outputFile).href}?v=${Date.now()}`);

// Read the expected version from the installed package instead of hardcoding it,
// so a Pi upgrade does not have to touch this test.
const expectedPiVersion = JSON.parse(
  readFileSync(path.join(root, "node_modules", "@earendil-works", "pi-coding-agent", "package.json"), "utf8"),
).version;

test("runtime version resolves through the public ESM entry despite package export restrictions", () => {
  assert.equal(readPiRuntimeVersion(), expectedPiVersion);
});
