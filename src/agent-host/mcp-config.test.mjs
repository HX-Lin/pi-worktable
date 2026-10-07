import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { pathToFileURL } from "node:url";
import { build } from "esbuild";

const root = path.resolve(import.meta.dirname, "..", "..");
const output = path.join(root, ".artifacts", "test-modules", `mcp-config-${process.pid}.mjs`);
mkdirSync(path.dirname(output), { recursive: true });

await build({
  absWorkingDir: root,
  entryPoints: ["src/agent-host/mcp-config.ts"],
  outfile: output,
  bundle: true,
  format: "esm",
  platform: "node",
  packages: "external",
  logLevel: "silent",
});
const {
  mergeMcpServers,
  readMcpConfig,
  setMcpServer,
  patchMcpServer,
  removeMcpServer,
  setAutoEnableCodemode,
  mcpGlobalPath,
  mcpProjectPath,
} = await import(`${pathToFileURL(output).href}?v=${Date.now()}`);

/** A throwaway agent dir plus project dir, so no test touches the real configuration. */
function workspace() {
  const base = mkdtempSync(path.join(tmpdir(), "pi-mcp-"));
  const agentDir = path.join(base, "agent");
  const cwd = path.join(base, "project");
  mkdirSync(agentDir, { recursive: true });
  mkdirSync(cwd, { recursive: true });
  return { base, agentDir, cwd };
}

test("a global server is listed with its defaults", () => {
  const servers = mergeMcpServers({ docs: { url: "https://example.com/mcp" } }, {});
  assert.equal(servers.length, 1);
  assert.deepEqual(
    {
      name: servers[0].name,
      scope: servers[0].scope,
      transport: servers[0].transport,
      enabled: servers[0].enabled,
      exposure: servers[0].exposure,
    },
    { name: "docs", scope: "global", transport: "http", enabled: true, exposure: "codemode" },
  );
});

test("a project entry replaces the global server of the same name", () => {
  const servers = mergeMcpServers(
    { files: { command: "npx", args: ["-y", "server-filesystem"] } },
    { files: { command: "node", args: ["./local-files.js"] } },
  );
  assert.equal(servers.length, 1);
  assert.equal(servers[0].scope, "project");
  assert.equal(servers[0].target, "node ./local-files.js");
  assert.equal(servers[0].overridesGlobal, true);
});

test("a connection-less project entry only overrides enabled and exposure", () => {
  const servers = mergeMcpServers(
    { sentry: { url: "https://mcp.sentry.dev/mcp", description: "issues" } },
    { sentry: { enabled: false, exposure: "hidden" } },
  );
  assert.equal(servers[0].target, "https://mcp.sentry.dev/mcp");
  assert.equal(servers[0].description, "issues");
  assert.equal(servers[0].enabled, false);
  assert.equal(servers[0].exposure, "hidden");
});

test("servers are sorted by name and stdio targets show the command line", () => {
  const servers = mergeMcpServers(
    { zed: { url: "https://z/mcp" }, alpha: { command: "node", args: ["a.js", "-x"] } },
    {},
  );
  assert.deepEqual(
    servers.map((s) => s.name),
    ["alpha", "zed"],
  );
  assert.equal(servers[0].target, "node a.js -x");
});

test("adding, patching and removing a server round-trips through the file", () => {
  const { agentDir, cwd } = workspace();
  setMcpServer(cwd, "docs", { url: "https://example.com/mcp" }, "global", agentDir);
  let view = readMcpConfig(cwd, agentDir);
  assert.equal(view.servers.length, 1);
  assert.equal(view.servers[0].exposure, "codemode");

  patchMcpServer(
    cwd,
    "docs",
    { enabled: false, exposure: "direct", description: "  product docs  " },
    "global",
    agentDir,
  );
  view = readMcpConfig(cwd, agentDir);
  assert.equal(view.servers[0].enabled, false);
  assert.equal(view.servers[0].exposure, "direct");
  assert.equal(view.servers[0].description, "product docs");

  assert.equal(removeMcpServer(cwd, "docs", "global", agentDir), true);
  assert.equal(removeMcpServer(cwd, "docs", "global", agentDir), false);
  assert.equal(readMcpConfig(cwd, agentDir).servers.length, 0);
});

test("a patch keeps fields the UI does not show", () => {
  const { agentDir, cwd } = workspace();
  setMcpServer(
    cwd,
    "sentry",
    { url: "https://mcp.sentry.dev/mcp", headers: { Authorization: "Bearer ${TOKEN}" }, timeout: 30 },
    "global",
    agentDir,
  );
  patchMcpServer(cwd, "sentry", { exposure: "deferred" }, "global", agentDir);
  const [server] = readMcpConfig(cwd, agentDir).servers;
  assert.deepEqual(server.config.headers, { Authorization: "Bearer ${TOKEN}" });
  assert.equal(server.config.timeout, 30);
  assert.equal(server.exposure, "deferred");
});

test("the project file is separate from the global one", () => {
  const { agentDir, cwd } = workspace();
  setMcpServer(cwd, "local", { command: "node", args: ["local.js"] }, "project", agentDir);
  const view = readMcpConfig(cwd, agentDir);
  assert.equal(view.servers[0].scope, "project");
  assert.equal(view.projectExists, true);
  assert.equal(readMcpConfig(cwd, agentDir).globalPath, mcpGlobalPath(agentDir));
  assert.equal(view.projectPath, mcpProjectPath(cwd));
});

test("autoEnableCodemode defaults to true and the project value wins", () => {
  const { agentDir, cwd } = workspace();
  assert.equal(readMcpConfig(cwd, agentDir).autoEnableCodemode, true);
  setAutoEnableCodemode(cwd, false, "global", agentDir);
  assert.equal(readMcpConfig(cwd, agentDir).autoEnableCodemode, false);
  mkdirSync(path.dirname(mcpProjectPath(cwd)), { recursive: true });
  writeFileSync(mcpProjectPath(cwd), JSON.stringify({ mcpServers: {}, autoEnableCodemode: true }));
  assert.equal(readMcpConfig(cwd, agentDir).autoEnableCodemode, true);
});

test("a malformed file is reported, not thrown", () => {
  const { agentDir, cwd } = workspace();
  writeFileSync(mcpGlobalPath(agentDir), "{ not json");
  const view = readMcpConfig(cwd, agentDir);
  assert.equal(view.servers.length, 0);
  assert.equal(view.errors.length, 1);
  assert.match(view.errors[0], /mcp\.json/u);
});

test("unknown exposures fall back to codemode", () => {
  const servers = mergeMcpServers({ odd: { url: "https://odd/mcp", exposure: "loud" } }, {});
  assert.equal(servers[0].exposure, "codemode");
});
