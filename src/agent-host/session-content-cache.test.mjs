import assert from "node:assert/strict";
import { appendFileSync, mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { Worker } from "node:worker_threads";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { pathToFileURL } from "node:url";
import { build } from "esbuild";

const root = path.resolve(import.meta.dirname, "..", "..");
const output = path.join(root, ".artifacts", "test-modules", `session-content-cache-${process.pid}.mjs`);
mkdirSync(path.dirname(output), { recursive: true });

await build({
  absWorkingDir: root,
  entryPoints: ["src/agent-host/session-content-cache.ts"],
  outfile: output,
  bundle: true,
  format: "esm",
  platform: "node",
  packages: "external",
  logLevel: "silent",
});
const { getSessionContentSnapshot, invalidateSessionContent } = await import(
  `${pathToFileURL(output).href}?v=${Date.now()}`
);

function sessionFile(lines = 1) {
  const dir = mkdtempSync(path.join(tmpdir(), "pi-session-"));
  const file = path.join(dir, "session.jsonl");
  const header = {
    type: "session",
    id: "s1",
    timestamp: new Date().toISOString(),
    cwd: "/tmp",
    version: 3,
  };
  const body = [JSON.stringify(header)];
  for (let i = 0; i < lines; i += 1) {
    body.push(
      JSON.stringify({
        type: "message",
        id: `m${i}`,
        timestamp: new Date().toISOString(),
        message: { role: "user", content: [{ type: "text", text: `line ${i}` }] },
      }),
    );
  }
  writeFileSync(file, `${body.join("\n")}\n`);
  return file;
}

test("a settled session reads once and is cached", () => {
  const file = sessionFile(3);
  const first = getSessionContentSnapshot(file);
  const second = getSessionContentSnapshot(file);
  assert.equal(first.entries.length, second.entries.length);
  assert.equal(first.entries.length, 3);
});

test("a torn final line is skipped instead of failing the read", () => {
  const file = sessionFile(2);
  appendFileSync(file, '{"type":"message","id":"m2","timest');
  const snapshot = getSessionContentSnapshot(file);
  assert.equal(snapshot.entries.length, 2);
});

test("a file that keeps changing while being read never throws", async () => {
  const file = sessionFile(2000);
  // A real writer on another thread: the fingerprint changes *during* a synchronous read, which is
  // what a running turn does to its own session file.
  const worker = new Worker(
    `
    const { parentPort, workerData } = require("node:worker_threads");
    const { appendFileSync } = require("node:fs");
    const entry = JSON.stringify({
      type: "message",
      id: "grow",
      timestamp: new Date().toISOString(),
      message: { role: "assistant", content: [{ type: "text", text: "x".repeat(500) }] },
    });
    const timer = setInterval(() => {
      try { appendFileSync(workerData.file, entry + "\\n"); } catch { /* ignore */ }
    }, 1);
    parentPort.on("message", () => { clearInterval(timer); process.exit(0); });
    parentPort.postMessage("ready");
    `,
    { eval: true, workerData: { file } },
  );
  await new Promise((resolve) => worker.once("message", resolve));
  try {
    const deadline = Date.now() + 400;
    let reads = 0;
    while (Date.now() < deadline) {
      invalidateSessionContent(file);
      const snapshot = getSessionContentSnapshot(file);
      assert.ok(snapshot.entries.length >= 2000, "a snapshot must carry the entries it read");
      reads += 1;
    }
    assert.ok(reads > 3, `expected several reads, got ${reads}`);
  } finally {
    worker.postMessage("stop");
    await new Promise((resolve) => worker.once("exit", resolve));
  }
});
