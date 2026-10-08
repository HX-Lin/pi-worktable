#!/usr/bin/env node
/**
 * Guards the Pi 1.0 contract the desktop builds against: the exact versions we pin, the APIs 1.0
 * removed, and what the app adopts from 1.0 (`codemode`/`tool_search`/`mcp` built-in extensions,
 * exposure-aware tool activation, and the on-disk codemode runtime).
 *
 * The code checks parse the sources rather than grepping them, so a comment cannot satisfy a
 * marker and reformatting cannot break one.
 */
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { sourceFacts } from "./lib/source-facts.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const targetVersion = "1.0.1";
const directPackages = ["@earendil-works/pi-ai", "@earendil-works/pi-coding-agent"];

function fail(message) {
  console.error(`[pi-100-compat] ${message}`);
  process.exit(1);
}

function readJson(relativePath) {
  return JSON.parse(readFileSync(path.join(root, relativePath), "utf8"));
}

const packageJson = readJson("package.json");
const lockfile = readJson("package-lock.json");
for (const packageName of directPackages) {
  if (packageJson.dependencies?.[packageName] !== targetVersion) {
    fail(`${packageName} must be pinned exactly to ${targetVersion}`);
  }
  if (lockfile.packages?.[""]?.dependencies?.[packageName] !== targetVersion) {
    fail(`lockfile root dependency ${packageName} must be ${targetVersion}`);
  }
  const installed = readJson(`node_modules/${packageName}/package.json`).version;
  if (installed !== targetVersion) fail(`installed ${packageName} is ${installed}, expected ${targetVersion}`);
}
if (packageJson.overrides?.["@earendil-works/pi-telemetry"] !== targetVersion) {
  fail(`@earendil-works/pi-telemetry override must be ${targetVersion}`);
}
if (packageJson.dependencies?.["@earendil-works/pi-telemetry"] !== targetVersion) {
  fail(`@earendil-works/pi-telemetry must be an exact root dependency at ${targetVersion}`);
}
const telemetryLocks = Object.entries(lockfile.packages ?? {}).filter(([packagePath]) =>
  packagePath.endsWith("node_modules/@earendil-works/pi-telemetry"),
);
if (telemetryLocks.length === 0 || telemetryLocks.some(([, entry]) => entry.version !== targetVersion)) {
  fail(`every locked @earendil-works/pi-telemetry instance must be ${targetVersion}`);
}
if (lockfile.packages?.["node_modules/@earendil-works/pi-telemetry"]?.version !== targetVersion) {
  fail(`the root @earendil-works/pi-telemetry lock entry must be ${targetVersion}`);
}
// Pi 1.0 requires Node >= 22.19; the desktop ships the same floor.
const nodeEngine = packageJson.engines?.node;
if (nodeEngine !== ">=22.19.0") fail(`engines.node must be >=22.19.0 for Pi 1.0, found ${nodeEngine}`);
// codemode loads its QuickJS wasm from the package tree, so these must stay direct dependencies.
if (packageJson.devDependencies?.["typescript-native"] !== "npm:typescript@^7.0.2") {
  fail("typescript-native must alias typescript@7 for the fast type check");
}
if (!/^\^?5\./.test(packageJson.devDependencies?.typescript ?? "")) {
  fail("typescript must stay on the 5.x API package that typescript-eslint and the contract checks need");
}

function sourceFiles(directory) {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const absolute = path.join(directory, entry.name);
    if (entry.isDirectory()) return sourceFiles(absolute);
    return /\.(?:ts|tsx)$/.test(entry.name) && !entry.name.endsWith(".d.ts") ? [absolute] : [];
  });
}

const forbidden = [
  ["removed ModelRuntime.reloadConfig", /\.reloadConfig\s*\(/],
  ["removed ModelsStreamTransforms", /\bModelsStreamTransforms\b/],
  ["removed TypeBox helper", /\bType\.(?:Base|Awaited|Promise|AsyncIterator|Iterator|Options)\s*\(/],
  ["removed Value.Mutate", /\bValue\.Mutate\s*\(/],
  ["legacy extension context.store", /\bcontext\.store\b/],
  // `systemPrompt` has been a getter-only accessor since before 1.0; prompts go through hooks.
  ["direct assignment to agent.state.systemPrompt", /\.state\.systemPrompt\s*=[^=]/],
];
for (const file of [
  ...sourceFiles(path.join(root, "src")),
  path.join(root, "vite.config.ts"),
  path.join(root, "tsup.config.ts"),
]) {
  const source = readFileSync(file, "utf8");
  for (const [label, pattern] of forbidden) {
    if (pattern.test(source)) fail(`${label} found in ${path.relative(root, file)}`);
  }
  if (/0\.8[0-9]\.(?:0|10)/.test(source)) fail(`stale Pi version fallback found in ${path.relative(root, file)}`);
}

// What the desktop must actually adopt from 1.0, as parsed facts rather than substrings.
const providers = sourceFacts(root, "src/agent-host/builtin-providers.ts");
const toolActivation = sourceFacts(root, "src/agent-host/tool-activation.ts");
const buildRuntime = sourceFacts(root, "scripts/build-runtime.mjs");
const modelRuntime = sourceFacts(root, "src/agent-host/model-runtime.ts");
const contract = sourceFacts(root, "src/contract/api.ts");
const credentialSync = sourceFacts(root, "src/agent-host/credential-sync.ts");
const modelsConfigState = sourceFacts(root, "src/renderer/lib/models-config-state.ts");
const sessionRegistry = sourceFacts(root, "src/agent-host/session-registry.ts");

const markers = [
  [providers.calls("createCodemodeExtension"), "the codemode built-in extension must be supplied"],
  [providers.calls("createToolSearchExtension"), "the tool-search built-in extension must be supplied"],
  [providers.calls("createMcpExtension"), "the MCP built-in extension must be supplied"],
  [providers.hasProperty("builtin", "true"), "built-in extensions must be marked `builtin: true`"],
  [toolActivation.uses("NON_DIRECT_EXPOSURES"), "tool activation must stay exposure-aware"],
  [buildRuntime.hasStringContaining("quickjs-wasi"), "the codemode runtime must ship QuickJS wasm"],
  [modelRuntime.hasProperty("allowNetwork", "true"), "the model runtime must support a network refresh"],
  [modelRuntime.hasProperty("allowNetwork", "false"), "the model runtime must support an offline refresh"],
  [contract.hasString("models.refresh"), "the contract must expose models.refresh"],
  [contract.hasString("models.refreshCancel"), "the contract must expose models.refreshCancel"],
  [credentialSync.uses("recoverCommittedCredential"), "credential sync must keep committed-state recovery"],
  [modelsConfigState.uses("samplingParams"), "model config state must keep sampling parameters"],
  [sessionRegistry.uses("services.diagnostics"), "session startup must surface runtime diagnostics"],
];
for (const [ok, message] of markers) if (!ok) fail(message);

console.log(
  `[pi-100-compat] exact dependencies, removed APIs, codemode/MCP wiring, model refresh, credential/config, and extension diagnostics passed (${targetVersion})`,
);
