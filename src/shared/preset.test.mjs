import assert from "node:assert/strict";
import test from "node:test";

import { parsePreset, presetToJson, PRESET_KIND, PRESET_VERSION, sanitizeMcpServer } from "./preset.ts";

const wrap = (body) =>
  JSON.stringify({ kind: PRESET_KIND, version: PRESET_VERSION, exportedAt: "2026-01-01T00:00:00.000Z", ...body });

test("a good preset round-trips through JSON", () => {
  const result = parsePreset(
    wrap({
      appearance: { theme: "nord", language: "zh-CN" },
      toolPreset: "full",
      agents: [{ name: "scout", description: "looks", systemPrompt: "You scout.", model: "m/x" }],
    }),
  );
  assert.equal(result.ok, true);
  assert.equal(result.warnings.length, 0);
  assert.equal(result.preset.appearance?.theme, "nord");
  assert.equal(result.preset.agents?.[0].name, "scout");
  assert.deepEqual(parsePreset(presetToJson(result.preset)).preset, result.preset);
});

test("malformed input fails with a reason, never a throw", () => {
  assert.deepEqual(parsePreset("not json"), { ok: false, error: "That is not valid JSON" });
  assert.deepEqual(parsePreset("[]"), { ok: false, error: "A preset must be a JSON object" });
  const wrongKind = parsePreset(JSON.stringify({ kind: "something-else", version: 1 }));
  assert.equal(wrongKind.ok, false);
  const noVersion = parsePreset(JSON.stringify({ kind: PRESET_KIND }));
  assert.equal(noVersion.ok, false);
});

test("a newer preset is refused rather than half-applied", () => {
  const result = parsePreset(JSON.stringify({ kind: PRESET_KIND, version: PRESET_VERSION + 1 }));
  assert.equal(result.ok, false);
  assert.match(result.error, /version/);
});

test("MCP secrets are dropped and reported", () => {
  const server = sanitizeMcpServer({
    name: "github",
    transport: "direct",
    url: "https://api.githubcopilot.com/mcp/readonly",
    headers: { Authorization: "Bearer ghp_secret" },
    env: { GITHUB_TOKEN: "ghp_secret" },
  });
  assert.equal(server?.hadSecrets, true);
  const json = JSON.stringify(server);
  assert.ok(!json.includes("ghp_secret"));
  assert.ok(!json.includes("Authorization"));
  assert.ok(!json.includes("GITHUB_TOKEN"));

  // A bare token field is caught too.
  assert.equal(sanitizeMcpServer({ name: "x", command: "uvx", token: "abc" })?.hadSecrets, true);

  const result = parsePreset(
    wrap({ mcpServers: [{ name: "github", url: "https://example.com/mcp", env: { TOKEN: "x" } }] }),
  );
  assert.equal(result.ok, true);
  assert.equal(result.preset.mcpServers?.length, 1);
  assert.match(result.warnings.join("\n"), /secrets are not carried/);
});

test("servers without an endpoint, and agents without a prompt, are skipped with a warning", () => {
  const result = parsePreset(
    wrap({
      mcpServers: [{ name: "no-endpoint" }, { name: "ok", command: "uvx" }],
      agents: [{ name: "empty" }, { name: "good", systemPrompt: "hi" }],
    }),
  );
  assert.equal(result.ok, true);
  assert.deepEqual(
    result.preset.mcpServers?.map((server) => server.name),
    ["ok"],
  );
  assert.deepEqual(
    result.preset.agents?.map((agent) => agent.name),
    ["good"],
  );
  assert.equal(result.warnings.length, 2);
});

test("an agent may name its prompt either way, and tools are copied as strings", () => {
  const result = parsePreset(wrap({ agents: [{ name: "a", prompt: "p", tools: ["read", 42, "bash"] }] }));
  assert.equal(result.ok, true);
  assert.equal(result.preset.agents?.[0].systemPrompt, "p");
  assert.deepEqual(result.preset.agents?.[0].tools, ["read", "bash"]);
});

test("empty sections are omitted so the file stays small", () => {
  const result = parsePreset(wrap({ agents: [], mcpServers: [], appearance: {} }));
  assert.equal(result.ok, true);
  assert.equal(result.preset.agents, undefined);
  assert.equal(result.preset.mcpServers, undefined);
  assert.equal(result.preset.appearance, undefined);
  assert.ok(!presetToJson(result.preset).includes("mcpServers"));
});
