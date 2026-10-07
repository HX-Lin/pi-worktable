import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { pathToFileURL } from "node:url";
import { build } from "esbuild";
import { AUTO_COMPACT_TURN_THRESHOLD, countBranchConversationMessages } from "../shared/auto-compact.ts";

const root = path.resolve(import.meta.dirname, "..", "..");
// Isolate the Host settings file so a developer's local threshold cannot
// change the expected default behaviour.
const agentDir = mkdtempSync(path.join(tmpdir(), "pi-rpc-manager-"));
process.env.PI_CODING_AGENT_DIR = agentDir;
process.once("exit", () => rmSync(agentDir, { recursive: true, force: true }));
let modulePromise;

async function loadRpcManager() {
  if (modulePromise) return modulePromise;
  modulePromise = (async () => {
    const outDir = path.join(root, ".artifacts", "test-modules");
    mkdirSync(outDir, { recursive: true });
    const outfile = path.join(outDir, `rpc-manager-${process.pid}.mjs`);
    await build({
      absWorkingDir: root,
      entryPoints: ["src/agent-host/rpc-manager.ts"],
      outfile,
      bundle: true,
      format: "esm",
      platform: "node",
      packages: "external",
      logLevel: "silent",
    });
    return import(`${pathToFileURL(outfile).href}?v=${Date.now()}`);
  })();
  return modulePromise;
}

function message(role) {
  return { type: "message", message: { role } };
}

/**
 * Build `count` conversation turns. Each turn is one user message followed by
 * two assistant steps, mirroring how a single turn balloons into many messages.
 */
function conversationTurns(count) {
  return Array.from({ length: count }, () => [message("user"), message("assistant"), message("assistant")]).flat();
}

function createFakeSession({
  branch,
  autoCompactionEnabled = true,
  contextUsage = null,
  sessionFile,
  contextMessages,
  cwd = "/tmp/pi-auto-compact",
  onPrompt,
}) {
  const state = {
    branch: [...branch],
    compactCalls: 0,
    compactInstructions: [],
    contextUsage,
    refreshCalls: 0,
    customEntries: [],
    emit: () => undefined,
  };
  const sessionManager = {
    getBranch: () => state.branch,
    getHeader: () => ({ cwd }),
    appendCustomEntry: (type, data) => {
      state.customEntries.push({ type, data });
      return "entry";
    },
    getSessionId: () => "session-auto-compact",
    getSessionFile: () => sessionFile ?? "/tmp/pi-auto-compact.jsonl",
    setSessionFile: () => undefined,
    buildSessionContext: () => ({ messages: contextMessages ?? [] }),
  };
  const base = {
    sessionId: "session-auto-compact",
    sessionFile: "/tmp/pi-auto-compact.jsonl",
    agent: { state: { messages: [] } },
    refreshContext: () => {
      state.refreshCalls += 1;
      base.agent.state.messages = sessionManager.buildSessionContext().messages;
    },
    sessionManager,
    isStreaming: false,
    isCompacting: false,
    autoCompactionEnabled,
    prompt: async () => onPrompt?.(state),
    sendCustomMessage: async () => {},
    getLastAssistantText: () => "done",
    getContextUsage: () => state.contextUsage,
    subscribe: (listener) => {
      state.emit = listener;
      return () => {
        state.emit = () => undefined;
      };
    },
    compact: async (instructions) => {
      state.compactCalls += 1;
      state.compactInstructions.push(instructions ?? null);
      state.branch = state.branch.slice(-6);
      return { summary: "compacted" };
    },
  };
  const inner = new Proxy(base, {
    get(target, property) {
      if (property in target) return target[property];
      return () => undefined;
    },
  });
  return { inner, state };
}

async function waitFor(predicate, timeoutMs = 3_000) {
  const startedAt = Date.now();
  while (!predicate()) {
    if (Date.now() - startedAt > timeoutMs) throw new Error("timed out waiting for auto-compaction");
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}

async function settle() {
  await new Promise((resolve) => setTimeout(resolve, 50));
}

test("countBranchConversationMessages counts only user/assistant branch entries", async () => {
  const { countBranchConversationMessages } = await loadRpcManager();
  assert.equal(
    countBranchConversationMessages([
      message("user"),
      { type: "compaction", summary: "old" },
      message("user"),
      message("assistant"),
      { type: "message", message: { role: "toolResult" } },
      { type: "model_change", provider: "p", modelId: "m" },
      "not-an-entry",
      null,
    ]),
    2,
  );
});

test("a finished turn archives its file diff as a UI-only session entry", async () => {
  const cwd = mkdtempSync(path.join(tmpdir(), "pi-turn-entry-"));
  try {
    execFileSync("git", ["-C", cwd, "init", "-q"]);
    writeFileSync(path.join(cwd, "code.txt"), "before\n");
    execFileSync("git", ["-C", cwd, "add", "."]);
    execFileSync("git", [
      "-C",
      cwd,
      "-c",
      "user.name=Test",
      "-c",
      "user.email=test@example.com",
      "commit",
      "-qm",
      "start",
    ]);
    const { AgentSessionWrapper } = await loadRpcManager();
    const { inner, state } = createFakeSession({
      branch: [],
      cwd,
      onPrompt: async (state) => {
        state.emit({ type: "agent_start" });
        writeFileSync(path.join(cwd, "code.txt"), "after\n");
        state.emit({ type: "agent_end" });
      },
    });
    const wrapper = new AgentSessionWrapper(inner);
    const events = [];
    wrapper.start();
    const unsubscribe = wrapper.onEvent((event) => events.push(event.type));
    try {
      await wrapper.send({ type: "prompt", message: "edit" });
      await waitFor(() => state.customEntries.length === 1);
      assert.equal(state.customEntries[0].type, "pi-desktop-turn-changes");
      assert.deepEqual(
        state.customEntries[0].data.files.map((file) => file.path),
        ["code.txt"],
      );
      assert.match(state.customEntries[0].data.files[0].patch, /\+after/);
      assert.ok(events.includes("turn_changes"));
    } finally {
      unsubscribe();
      wrapper.destroy();
    }
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
});

test("many assistant steps in a few turns never auto-compact", async () => {
  const { AgentSessionWrapper } = await loadRpcManager();
  // One turn that produced 140 assistant steps used to look like 140 messages.
  const branch = [message("user"), ...Array.from({ length: 140 }, () => message("assistant"))];
  const { inner, state } = createFakeSession({ branch });
  const wrapper = new AgentSessionWrapper(inner);
  try {
    await wrapper.runExternalTurn({ runId: "run-steps", message: "hello", channel: "feishu" });
    await settle();
    assert.ok(countBranchConversationMessages(state.branch) > AUTO_COMPACT_TURN_THRESHOLD * 2);
    assert.equal(state.compactCalls, 0);
  } finally {
    wrapper.destroy();
  }
});

test("a short session never auto-compacts", async () => {
  const { AgentSessionWrapper } = await loadRpcManager();
  const { inner, state } = createFakeSession({ branch: conversationTurns(AUTO_COMPACT_TURN_THRESHOLD - 2) });
  const wrapper = new AgentSessionWrapper(inner);
  try {
    await wrapper.runExternalTurn({ runId: "run-short", message: "hello", channel: "feishu" });
    await settle();
    assert.equal(state.compactCalls, 0);
  } finally {
    wrapper.destroy();
  }
});

test("pi's auto-context switch still disables percent-based compaction", async () => {
  const { AgentSessionWrapper } = await loadRpcManager();
  const { inner, state } = createFakeSession({
    branch: conversationTurns(2),
    autoCompactionEnabled: false,
    contextUsage: { percent: 82, contextWindow: 200_000, tokens: 164_000 },
  });
  const wrapper = new AgentSessionWrapper(inner);
  try {
    await wrapper.runExternalTurn({ runId: "run-context-off", message: "hello", channel: "feishu" });
    await settle();
    assert.equal(state.compactCalls, 0);
  } finally {
    wrapper.destroy();
  }
});

test("a filling context window compacts the context without deleting history", async () => {
  const { AgentSessionWrapper } = await loadRpcManager();
  // A real session file, so "did anything get deleted?" is a byte-level question.
  const dir = mkdtempSync(path.join(tmpdir(), "pi-context-compact-"));
  const filePath = path.join(dir, "session.jsonl");
  const history = Array.from({ length: 40 }, (_, index) => ({
    type: "message",
    id: `m${index + 1}`,
    parentId: index === 0 ? null : `m${index}`,
    message: { role: "user", content: `turn ${index + 1} ${"x".repeat(2048)}` },
  }));
  writeFileSync(
    filePath,
    `${[
      { type: "session", version: 3, id: "session-window", timestamp: new Date().toISOString(), cwd: dir },
      ...history,
      {
        type: "compaction",
        id: "c1",
        parentId: "m40",
        summary: `## Goal\n${"memory line\n".repeat(40)}`,
        firstKeptEntryId: "m38",
        tokensBefore: 10,
      },
    ]
      .map((entry) => JSON.stringify(entry))
      .join("\n")}\n`,
    "utf8",
  );
  const before = readFileSync(filePath, "utf8");

  // Far below the turn threshold, but the window is nearly full.
  const { inner, state } = createFakeSession({
    branch: conversationTurns(2),
    sessionFile: filePath,
    contextUsage: { percent: 82, contextWindow: 200_000, tokens: 164_000 },
  });
  const wrapper = new AgentSessionWrapper(inner);
  try {
    await wrapper.runExternalTurn({ runId: "run-window", message: "hello", channel: "feishu" });
    await waitFor(() => state.compactCalls === 1);
    // pi's own summarization prompt: no distillation instructions attached...
    assert.equal(state.compactInstructions[0], null);
    // ...and the session file is untouched: a filling window never prunes history.
    assert.equal(readFileSync(filePath, "utf8"), before);
  } finally {
    wrapper.destroy();
    rmSync(dir, { recursive: true, force: true });
  }
});

test("a failing auto-compaction says so in the UI, not only in the log", async () => {
  const { AgentSessionWrapper } = await loadRpcManager();
  const { inner, state } = createFakeSession({
    branch: conversationTurns(2),
    contextUsage: { percent: 82, contextWindow: 200_000, tokens: 164_000 },
  });
  // What the session model's summarizer does when its quota is gone, which is
  // how a context grows past the window with no compaction to show for it.
  inner.compact = async () => {
    state.compactCalls += 1;
    throw new Error("Summarization failed: Codex error: The usage limit has been reached");
  };
  const wrapper = new AgentSessionWrapper(inner);
  const events = [];
  wrapper.onEvent((event) => events.push(event));
  try {
    await wrapper.runExternalTurn({ runId: "run-fail", message: "hello", channel: "feishu" });
    await waitFor(() => state.compactCalls === 1);
    await settle();

    const notice = events.find((event) => event.type === "notice");
    assert.ok(notice, "the failure must reach the renderer");
    assert.equal(notice.level, "error");
    assert.match(String(notice.message), /自动压缩失败/);
    assert.match(String(notice.message), /usage limit has been reached/);
  } finally {
    wrapper.destroy();
  }
});
