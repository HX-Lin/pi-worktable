#!/usr/bin/env node
/**
 * Install the hot-update runtime overlay into the app's userData directory.
 *
 *   npm run hot            # build + install
 *   npm run hot -- --fast  # install the current out/ without rebuilding
 *
 * The running app watches that directory: writing a host makes it restart the
 * agent host in place, writing a renderer makes it reload the UI. No repackage,
 * no app restart.
 */
import { cpSync, existsSync, mkdirSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const PRODUCT = "Pi Worktable";
const fast = process.argv.includes("--fast");

function userDataDir() {
  if (process.env.PI_DESKTOP_USER_DATA) return process.env.PI_DESKTOP_USER_DATA;
  if (process.platform === "darwin") return path.join(os.homedir(), "Library", "Application Support", PRODUCT);
  if (process.platform === "win32") return path.join(process.env.APPDATA ?? os.homedir(), PRODUCT);
  return path.join(process.env.XDG_CONFIG_HOME ?? path.join(os.homedir(), ".config"), PRODUCT);
}

function run(script) {
  const result = spawnSync(process.execPath, [path.join(root, "scripts", script)], { cwd: root, stdio: "inherit" });
  if (result.status !== 0) process.exit(result.status ?? 1);
}

if (!fast) {
  run("build.mjs");
  run("build-runtime.mjs");
}

const source = path.join(root, "out", "runtime");
if (!existsSync(path.join(source, "host", "agent-host.mjs"))) {
  console.error(`[hot-runtime] ${source} is missing — run without --fast first`);
  process.exit(1);
}

const destination = path.join(userDataDir(), "runtime");
rmSync(destination, { recursive: true, force: true });
mkdirSync(destination, { recursive: true });
cpSync(source, destination, { recursive: true });

console.log(`[hot-runtime] installed → ${destination}`);
console.log("[hot-runtime] a running app restarts the agent host and reloads the UI automatically");
