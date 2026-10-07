import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { pathToFileURL } from "node:url";
import { build } from "esbuild";

const root = path.resolve(import.meta.dirname, "..", "..");
const output = path.join(root, ".artifacts", "test-modules", `resume-interrupted-${process.pid}.mjs`);
mkdirSync(path.dirname(output), { recursive: true });

await build({
  absWorkingDir: root,
  entryPoints: ["src/agent-host/resume-interrupted.ts"],
  outfile: output,
  bundle: true,
  format: "esm",
  platform: "node",
  packages: "external",
  logLevel: "silent",
});
const {
  CONTINUE_AFTER_RESTART_PROMPT,
  clearInterruptedSnapshot,
  snapshotPath,
  takeInterruptedSnapshot,
  writeInterruptedSnapshot,
} = await import(`${pathToFileURL(output).href}?v=${Date.now()}`);

function userData() {
  return mkdtempSync(path.join(tmpdir(), "pi-userdata-"));
}

test("the running set is recorded outside runtime/, which a hot update replaces", () => {
  const dir = userData();
  writeInterruptedSnapshot(dir, ["s1"]);
  assert.equal(snapshotPath(dir), path.join(dir, "interrupted-sessions.json"));
  assert.deepEqual(JSON.parse(readFileSync(snapshotPath(dir), "utf8")).sessionIds, ["s1"]);
});

test("an empty running set removes the snapshot", () => {
  const dir = userData();
  writeInterruptedSnapshot(dir, ["s1"]);
  writeInterruptedSnapshot(dir, []);
  assert.deepEqual(takeInterruptedSnapshot(dir), []);
});

test("a snapshot is taken once, not on every read", () => {
  const dir = userData();
  writeInterruptedSnapshot(dir, ["s1", "s2"]);
  assert.deepEqual(takeInterruptedSnapshot(dir), ["s1", "s2"]);
  assert.deepEqual(takeInterruptedSnapshot(dir), []);
});

test("clearing discards the snapshot without reading it", () => {
  const dir = userData();
  writeInterruptedSnapshot(dir, ["s1"]);
  clearInterruptedSnapshot(dir);
  assert.deepEqual(takeInterruptedSnapshot(dir), []);
});

test("a missing, corrupt or malformed snapshot resumes nothing", () => {
  const dir = userData();
  assert.deepEqual(takeInterruptedSnapshot(dir), []);
  writeFileSync(snapshotPath(dir), "{ not json");
  assert.deepEqual(takeInterruptedSnapshot(dir), []);
  writeFileSync(snapshotPath(dir), JSON.stringify({ sessionIds: [42, "", "ok"] }));
  assert.deepEqual(takeInterruptedSnapshot(dir), ["ok"]);
});

test("without a user-data directory nothing is written or read", () => {
  writeInterruptedSnapshot(undefined, ["s1"]);
  assert.deepEqual(takeInterruptedSnapshot(undefined), []);
  assert.equal(snapshotPath(undefined), null);
});

test("the continuation prompt says what happened", () => {
  assert.match(CONTINUE_AFTER_RESTART_PROMPT, /继续/u);
});
