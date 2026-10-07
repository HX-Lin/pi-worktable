import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { pathToFileURL } from "node:url";
import { build } from "esbuild";

const root = path.resolve(import.meta.dirname, "..", "..");
const output = path.join(root, ".artifacts", "test-modules", `runtime-overlay-${process.pid}.mjs`);
mkdirSync(path.dirname(output), { recursive: true });

await build({
  absWorkingDir: root,
  entryPoints: ["src/main/runtime-overlay.ts"],
  outfile: output,
  bundle: true,
  format: "esm",
  platform: "node",
  packages: "external",
  logLevel: "silent",
});
const { RUNTIME_MANIFEST, overlayMatchesApp, readRuntimeManifest } = await import(
  `${pathToFileURL(output).href}?v=${Date.now()}`
);

function overlay(manifest) {
  const dir = mkdtempSync(path.join(tmpdir(), "pi-overlay-"));
  if (manifest !== undefined) {
    const body = typeof manifest === "string" ? manifest : JSON.stringify(manifest);
    writeFileSync(path.join(dir, RUNTIME_MANIFEST), body);
  }
  return dir;
}

test("an overlay built for this app version is trusted", () => {
  assert.equal(overlayMatchesApp(overlay({ appVersion: "1.2.3" }), "1.2.3"), true);
});

test("an overlay from another version is ignored, so a repackage retires it", () => {
  assert.equal(overlayMatchesApp(overlay({ appVersion: "1.2.2" }), "1.2.3"), false);
});

test("a missing manifest is not trusted", () => {
  assert.equal(overlayMatchesApp(overlay(undefined), "1.2.3"), false);
});

test("a corrupt manifest is not trusted", () => {
  assert.equal(overlayMatchesApp(overlay("{ not json"), "1.2.3"), false);
  assert.equal(overlayMatchesApp(overlay('"a string"'), "1.2.3"), false);
});

test("the manifest is readable for diagnostics", () => {
  const dir = overlay({ appVersion: "1.2.3", piVersion: "1.0.1", builtAt: "2026-01-01T00:00:00.000Z" });
  assert.deepEqual(readRuntimeManifest(dir), {
    appVersion: "1.2.3",
    piVersion: "1.0.1",
    builtAt: "2026-01-01T00:00:00.000Z",
  });
});
