import assert from "node:assert/strict";
import test from "node:test";

import { buildTrajectory, formatDuration, spanGeometry } from "./trajectory.ts";

const T0 = 1_700_000_000_000;
const at = (offsetMs) => T0 + offsetMs;

function user(text, offsetMs) {
  return { role: "user", content: text, timestamp: at(offsetMs) };
}

function assistant(content, offsetMs, extra = {}) {
  return { role: "assistant", content, model: "test-model", provider: "test", timestamp: at(offsetMs), ...extra };
}

function toolCall(toolCallId, toolName, input) {
  return { type: "toolCall", toolCallId, toolName, input };
}

function toolResult(toolCallId, text, offsetMs, isError = false) {
  return {
    role: "toolResult",
    toolCallId,
    toolName: "read",
    content: [{ type: "text", text }],
    isError,
    timestamp: at(offsetMs),
  };
}

test("tool spans use the real call→result window, not the next message", () => {
  const summary = buildTrajectory([
    user("do it", 0),
    assistant([toolCall("c1", "read", { path: "a.ts" })], 1_000),
    toolResult("c1", "file body", 4_500),
    assistant([{ type: "text", text: "done" }], 6_000),
  ]);

  const tool = summary.spans.find((span) => span.kind === "tool");
  assert.ok(tool);
  assert.equal(tool.toolName, "read");
  assert.equal(tool.end - tool.start, 3_500);
  assert.equal(summary.toolMs, 3_500);
  assert.equal(summary.toolCount, 1);
  assert.equal(summary.errorCount, 0);
  // The result message itself never becomes a row.
  assert.equal(summary.spans.filter((span) => span.kind === "tool").length, 1);
});

test("a failed tool result is counted and flagged", () => {
  const summary = buildTrajectory([
    user("do it", 0),
    assistant([toolCall("c1", "bash", { command: "false" })], 500),
    toolResult("c1", "exit 1", 900, true),
  ]);
  assert.equal(summary.errorCount, 1);
  assert.equal(summary.spans.find((span) => span.kind === "tool")?.isError, true);
});

test("an unmatched tool call ends at the next event instead of being dropped", () => {
  const summary = buildTrajectory([
    assistant([toolCall("c1", "read", { path: "a.ts" })], 0),
    assistant([{ type: "text", text: "next" }], 2_000),
  ]);
  const tool = summary.spans.find((span) => span.kind === "tool");
  assert.equal(tool?.end, at(2_000));
  assert.equal(tool?.isError, undefined);
});

test("thinking-only replies are labelled as thinking", () => {
  const summary = buildTrajectory([assistant([{ type: "thinking", thinking: "hmm" }], 0)]);
  assert.equal(summary.spans[0].kind, "answer");
  assert.equal(summary.spans[0].label, "thinking");
});

test("custom entries keep their type as the label", () => {
  const summary = buildTrajectory([
    { role: "custom", customType: "pi-desktop-subagent", content: "ran scout", display: true, timestamp: at(0) },
  ]);
  assert.equal(summary.spans[0].kind, "custom");
  assert.equal(summary.spans[0].label, "pi-desktop-subagent");
});

test("messages without a timestamp are ignored rather than placed at zero", () => {
  const summary = buildTrajectory([
    { role: "user", content: "no clock" },
    user("with clock", 1_000),
    assistant([{ type: "text", text: "ok" }], 3_000),
  ]);
  assert.equal(summary.spans.length, 2);
  assert.equal(summary.totalMs, 2_000);
});

test("an empty or untimed transcript yields an empty summary, not NaN", () => {
  const summary = buildTrajectory([]);
  assert.deepEqual(summary, { spans: [], totalMs: 0, toolMs: 0, toolCount: 0, errorCount: 0 });
  const untimed = buildTrajectory([{ role: "user", content: "x" }]);
  assert.equal(untimed.totalMs, 0);
  assert.equal(untimed.spans.length, 0);
});

test("previews are flattened and truncated", () => {
  const long = `${"a ".repeat(200)}end`;
  const summary = buildTrajectory([user(long, 0), assistant([{ type: "text", text: "ok" }], 1_000)]);
  const span = summary.spans.find((item) => item.kind === "user");
  assert.ok(span.preview.length <= 141);
  assert.ok(!span.preview.includes("\n"));
  assert.ok(span.preview.endsWith("…"));
});

test("geometry clamps into the window and never inverts", () => {
  const window = { start: 1_000, end: 2_000 };
  assert.deepEqual(spanGeometry({ start: 1_000, end: 1_500 }, window), { left: 0, width: 50 });
  assert.deepEqual(spanGeometry({ start: 1_500, end: 1_500 }, window), { left: 50, width: 0.4 });
  const beyond = spanGeometry({ start: 2_000, end: 3_000 }, window);
  assert.equal(beyond.left, 100);
  assert.ok(beyond.width >= 0);
});

test("durations read naturally at three scales", () => {
  assert.equal(formatDuration(250), "250ms");
  assert.equal(formatDuration(4_300), "4.3s");
  assert.equal(formatDuration(45_000), "45s");
  assert.equal(formatDuration(125_000), "2m 5s");
});
