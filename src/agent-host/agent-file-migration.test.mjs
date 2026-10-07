import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { pathToFileURL } from "node:url";
import { build } from "esbuild";

const root = path.resolve(import.meta.dirname, "..", "..");
const agentDir = mkdtempSync(path.join(tmpdir(), "pi-worktable-agent-files-"));
process.env.PI_CODING_AGENT_DIR = agentDir;
const output = path.join(root, ".artifacts", "test-modules", `agent-file-migration-${process.pid}.mjs`);
await build({
  absWorkingDir: root,
  entryPoints: ["src/agent-host/agent-file-migration.ts"],
  outfile: output,
  bundle: true,
  format: "esm",
  platform: "node",
  packages: "external",
  logLevel: "silent",
});
const { migrateLegacyAgentFiles } = await import(`${pathToFileURL(output).href}?v=${Date.now()}`);
process.once("exit", () => {
  rmSync(output, { force: true });
  rmSync(agentDir, { recursive: true, force: true });
});

test("pre-rebrand config files are renamed in place", () => {
  const legacy = path.join(agentDir, "pi-desktop-jev.json");
  writeFileSync(legacy, '{"enabled":true}', "utf8");

  migrateLegacyAgentFiles();

  assert.equal(existsSync(legacy), false);
  assert.equal(existsSync(path.join(agentDir, "pi-worktable-jev.json")), true);
});

test("an existing new file is never overwritten, and a missing one is not created", () => {
  const target = path.join(agentDir, "pi-worktable-relay.json");
  writeFileSync(target, '{"url":"ws://keep"}', "utf8");
  writeFileSync(path.join(agentDir, "pi-desktop-relay.json"), '{"url":"ws://stale"}', "utf8");

  migrateLegacyAgentFiles();

  assert.equal(existsSync(path.join(agentDir, "pi-desktop-relay.json")), true);
  assert.equal(readFileSync(target, "utf8"), '{"url":"ws://keep"}');
  assert.equal(existsSync(path.join(agentDir, "pi-worktable-plugin-filters.json")), false);
});
