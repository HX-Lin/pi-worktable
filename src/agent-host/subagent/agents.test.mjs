import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { pathToFileURL } from "node:url";
import { build } from "esbuild";
import { discoverAgents } from "./agents.ts";

const root = path.resolve(import.meta.dirname, "..", "..", "..");
const agentDir = mkdtempSync(path.join(tmpdir(), "pi-subagent-agent-dir-"));
process.env.PI_CODING_AGENT_DIR = agentDir;

// extension.ts pulls in the runner, so bundle it rather than importing the
// module directly.
const output = path.join(root, ".artifacts", "test-modules", `subagent-${process.pid}.mjs`);
await build({
  absWorkingDir: root,
  entryPoints: ["src/agent-host/subagent/extension.ts"],
  outfile: output,
  bundle: true,
  format: "esm",
  platform: "node",
  packages: "external",
  logLevel: "silent",
});
const { SUBAGENT_EXTENSION } = await import(`${pathToFileURL(output).href}?v=${Date.now()}`);
process.once("exit", () => {
  rmSync(output, { force: true });
  rmSync(agentDir, { recursive: true, force: true });
});

const agentFile = (name, description, extra = "") =>
  `---\nname: ${name}\ndescription: ${description}\n${extra}---\n\nYou are ${name}.\n`;

function withProjectDir(run) {
  const dir = mkdtempSync(path.join(tmpdir(), "pi-subagent-"));
  try {
    return run(dir);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

test("agents are discovered from the project config directory with their frontmatter", () => {
  withProjectDir((dir) => {
    const agentsDir = path.join(dir, ".pi", "agents");
    mkdirSync(agentsDir, { recursive: true });
    writeFileSync(
      path.join(agentsDir, "scout.md"),
      agentFile("scout", "Fast recon", "model: anthropic/claude-haiku-4-5\ntools: read, grep\n"),
    );
    writeFileSync(path.join(agentsDir, "notes.txt"), "ignored");

    const { agents } = discoverAgents(dir, "project");
    assert.equal(agents.length, 1);
    assert.equal(agents[0].name, "scout");
    assert.equal(agents[0].source, "project");
    assert.equal(agents[0].model, "anthropic/claude-haiku-4-5");
    assert.deepEqual(agents[0].tools, ["read", "grep"]);
    assert.match(agents[0].systemPrompt, /You are scout\./);
  });
});

test("an agent without a name or description is skipped, not fatal", () => {
  withProjectDir((dir) => {
    const agentsDir = path.join(dir, ".pi", "agents");
    mkdirSync(agentsDir, { recursive: true });
    writeFileSync(path.join(agentsDir, "broken.md"), "---\nname: broken\n---\n\nno description\n");
    writeFileSync(path.join(agentsDir, "ok.md"), agentFile("ok", "Fine"));

    const { agents } = discoverAgents(dir, "project");
    assert.deepEqual(
      agents.map((agent) => agent.name),
      ["ok"],
    );
  });
});

test("tools accept both the list and comma-separated spellings", () => {
  withProjectDir((dir) => {
    const agentsDir = path.join(dir, ".pi", "agents");
    mkdirSync(agentsDir, { recursive: true });
    writeFileSync(path.join(agentsDir, "a.md"), agentFile("a", "A", "tools: [read, bash]\n"));
    writeFileSync(path.join(agentsDir, "b.md"), agentFile("b", "B", "tools: read,bash\n"));

    const { agents } = discoverAgents(dir, "project");
    assert.deepEqual(agents.find((agent) => agent.name === "a").tools, ["read", "bash"]);
    assert.deepEqual(agents.find((agent) => agent.name === "b").tools, ["read", "bash"]);
  });
});

test("the user scope ignores project agents", () => {
  withProjectDir((dir) => {
    const agentsDir = path.join(dir, ".pi", "agents");
    mkdirSync(agentsDir, { recursive: true });
    writeFileSync(path.join(agentsDir, "scout.md"), agentFile("scout", "Project scout"));

    const { agents } = discoverAgents(dir, "user");
    assert.equal(
      agents.some((agent) => agent.name === "scout"),
      false,
    );
  });
});

test("the subagent extension registers a subagent tool with both modes", () => {
  const registered = [];
  SUBAGENT_EXTENSION.factory({ registerTool: (tool) => registered.push(tool) });
  assert.equal(registered.length, 1);
  assert.equal(registered[0].name, "subagent");
  assert.equal(typeof registered[0].execute, "function");
  const properties = registered[0].parameters.properties ?? {};
  assert.ok("agent" in properties && "task" in properties && "tasks" in properties);
});
