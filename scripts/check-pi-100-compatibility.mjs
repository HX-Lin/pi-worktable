#!/usr/bin/env node
/**
 * Guards the Pi 1.0 contract the desktop builds against: the exact versions we pin, the APIs 1.0
 * removed, and the markers of what the app adopts from 1.0 (`codemode`/`tool_search`/`mcp` built-in
 * extensions, exposure-aware tool activation, and the on-disk codemode runtime).
 */
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

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

const requiredMarkers = [
  // 1.0 features the desktop opts into.
  ["src/agent-host/builtin-providers.ts", "createCodemodeExtension"],
  ["src/agent-host/builtin-providers.ts", "createToolSearchExtension"],
  ["src/agent-host/builtin-providers.ts", "createMcpExtension"],
  ["src/agent-host/builtin-providers.ts", "builtin: true"],
  ["src/agent-host/rpc-manager.ts", "NON_DIRECT_EXPOSURES"],
  ["scripts/build-runtime.mjs", "quickjs-wasi"],
  // Pre-existing contract markers.
  ["src/agent-host/model-runtime.ts", "allowNetwork: true"],
  ["src/agent-host/model-runtime.ts", "allowNetwork: false"],
  ["src/contract/api.ts", '"models.refresh"'],
  ["src/contract/api.ts", '"models.refreshCancel"'],
  ["src/agent-host/credential-sync.ts", "recoverCommittedCredential"],
  ["src/renderer/lib/models-config-state.ts", "samplingParams"],
  ["src/agent-host/rpc-manager.ts", "services.diagnostics"],
];
for (const [relativePath, marker] of requiredMarkers) {
  if (!readFileSync(path.join(root, relativePath), "utf8").includes(marker)) {
    fail(`${relativePath} is missing required marker ${JSON.stringify(marker)}`);
  }
}

console.log(
  `[pi-100-compat] exact dependencies, removed APIs, codemode/MCP wiring, model refresh, credential/config, and extension diagnostics passed (${targetVersion})`,
);
