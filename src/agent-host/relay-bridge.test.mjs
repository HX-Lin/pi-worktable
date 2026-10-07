import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { pathToFileURL } from "node:url";
import { build } from "esbuild";
import * as ws from "ws";

const { WebSocketServer } = ws;
const root = path.resolve(import.meta.dirname, "..", "..");
const agentDirectory = mkdtempSync(path.join(tmpdir(), "pi-relay-agent-"));
process.env.PI_CODING_AGENT_DIR = agentDirectory;
process.env.PI_OFFLINE = "1";
process.once("exit", () => rmSync(agentDirectory, { recursive: true, force: true }));

let modulePromise;
async function load() {
  if (modulePromise) return modulePromise;
  modulePromise = (async () => {
    const outputDirectory = path.join(root, ".artifacts", "test-modules");
    mkdirSync(outputDirectory, { recursive: true });
    const outputFile = path.join(outputDirectory, `relay-bridge-${process.pid}.mjs`);
    await build({
      absWorkingDir: root,
      entryPoints: ["src/agent-host/relay-bridge.ts"],
      outfile: outputFile,
      bundle: true,
      format: "esm",
      platform: "node",
      packages: "external",
      sourcemap: false,
      logLevel: "silent",
    });
    return import(`${pathToFileURL(outputFile).href}?v=${Date.now()}`);
  })();
  return modulePromise;
}

function clearEnv() {
  delete process.env.PI_RELAY_URL;
  delete process.env.PI_RELAY_PAIRING_SECRET;
  delete process.env.PI_RELAY_DEVICE_NAME;
  delete process.env.PI_RELAY_SESSION_ID;
  delete process.env.PI_RELAY_CWD;
  rmSync(path.join(agentDirectory, "pi-desktop-relay.json"), { force: true });
}

test("normalizeRelayUrl maps http(s) to ws(s) and passes others through", async () => {
  const { normalizeRelayUrl } = await load();
  assert.equal(normalizeRelayUrl("https://pi.hxlin.fun/ws"), "wss://pi.hxlin.fun/ws");
  assert.equal(normalizeRelayUrl("http://127.0.0.1:8787/ws"), "ws://127.0.0.1:8787/ws");
  assert.equal(normalizeRelayUrl("wss://pi.hxlin.fun/ws"), "wss://pi.hxlin.fun/ws");
});

test("readRelayConfig returns null when unconfigured", async () => {
  clearEnv();
  const { readRelayConfig } = await load();
  assert.equal(readRelayConfig(), null);
});

test("readRelayConfig reads the JSON file and lets the environment override it", async () => {
  clearEnv();
  writeFileSync(
    path.join(agentDirectory, "pi-desktop-relay.json"),
    JSON.stringify({ url: "https://pi.hxlin.fun/ws", pairingSecret: "file-secret", deviceName: "studio" }),
  );
  const { readRelayConfig } = await load();
  const fromFile = readRelayConfig();
  assert.equal(fromFile?.url, "wss://pi.hxlin.fun/ws");
  assert.equal(fromFile?.pairingSecret, "file-secret");
  assert.equal(fromFile?.deviceName, "studio");

  process.env.PI_RELAY_PAIRING_SECRET = "env-secret";
  process.env.PI_RELAY_DEVICE_NAME = "laptop";
  const fromEnv = readRelayConfig();
  assert.equal(fromEnv?.pairingSecret, "env-secret");
  assert.equal(fromEnv?.deviceName, "laptop");
  clearEnv();
});

test("boundedHistory keeps the newest messages within the byte budget", async () => {
  const { boundedHistory } = await load();
  const big = { role: "assistant", content: "x".repeat(600_000) };
  const small = { role: "user", content: "hi" };
  const result = boundedHistory([big, small, big]);
  // From newest backwards: the last big item fits alone, the small one still fits,
  // and the first big item would exceed the 1 MB budget, so it is dropped.
  assert.equal(result.length, 2);
  assert.equal(result[0], small);
  assert.equal(result[1], big);
  assert.equal(boundedHistory([]).length, 0);
});

test("startRelayBridge connects out and registers with the pairing secret", async () => {
  clearEnv();
  const server = new WebSocketServer({ port: 0 });
  await new Promise((resolve) => server.once("listening", resolve));
  const { port } = server.address();

  const registered = new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("no register within 5s")), 5000);
    server.on("connection", (socket, request) => {
      assert.equal(request.url, "/ws?role=desktop");
      socket.on("message", (data) => {
        clearTimeout(timer);
        resolve(JSON.parse(String(data)));
      });
    });
  });

  process.env.PI_RELAY_URL = `ws://127.0.0.1:${port}/ws`;
  process.env.PI_RELAY_PAIRING_SECRET = "pair-123";
  const { startRelayBridge, stopRelayBridge } = await load();
  startRelayBridge(() => undefined);
  try {
    const message = await registered;
    assert.equal(message.type, "register");
    assert.equal(message.pairingSecret, "pair-123");
    assert.equal(message.deviceName, "desktop");
  } finally {
    stopRelayBridge();
    await new Promise((resolve) => server.close(resolve));
    clearEnv();
  }
});
