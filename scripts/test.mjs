#!/usr/bin/env node
import { readdirSync } from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
// The Feishu H5 lives under web/ and is part of the app, so its tests run with the rest.
const sourceRoots = [path.join(root, "src"), path.join(root, "web", "src")];

function collectTests(directory) {
  const files = [];
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const absolute = path.join(directory, entry.name);
    if (entry.isDirectory()) files.push(...collectTests(absolute));
    else if (entry.isFile() && entry.name.endsWith(".test.mjs")) files.push(absolute);
  }
  return files;
}

const tests = sourceRoots.flatMap((sourceRoot) => collectTests(sourceRoot)).sort();
if (tests.length === 0) {
  console.error("No test files found under src/ or web/src/");
  process.exit(1);
}

const testEnvironment = { ...process.env };
for (const name of [
  "PI_DESKTOP_VERSION",
  "PI_DESKTOP_USER_DATA",
  "PI_DESKTOP_TOOLCHAIN_REVISION",
  "PI_DESKTOP_TOOLCHAIN_RESOLUTION",
]) {
  delete testEnvironment[name];
}

const result = spawnSync(process.execPath, ["--disable-warning=MODULE_TYPELESS_PACKAGE_JSON", "--test", ...tests], {
  cwd: root,
  env: testEnvironment,
  stdio: "inherit",
});

process.exit(result.status ?? 1);
