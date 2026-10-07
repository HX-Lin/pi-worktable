import assert from "node:assert/strict";
import test from "node:test";
import { countBranchConversationMessages, countConversationMessages } from "./auto-compact.ts";

test("conversation counting ignores non user/assistant entries", () => {
  assert.equal(
    countConversationMessages([
      { role: "user" },
      { role: "assistant" },
      { role: "toolResult" },
      { role: "custom" },
      {},
      { role: "user" },
    ]),
    3,
  );
});

test("a turn counts the user message, not the assistant steps it produced", () => {
  const entries = [
    { type: "message", message: { role: "user" } },
    { type: "message", message: { role: "assistant" } },
    { type: "message", message: { role: "assistant" } },
    { type: "message", message: { role: "assistant" } },
    { type: "message", message: { role: "toolResult" } },
    { type: "message", message: { role: "user" } },
    { type: "message", message: { role: "assistant" } },
  ];

  assert.equal(countBranchConversationMessages(entries), 6);
});

test("context message counting starts after the latest compaction of any kind", () => {
  const entries = [
    { type: "message", message: { role: "user" } },
    { type: "message", message: { role: "assistant" } },
    { type: "compaction", summary: "older turns" },
    { type: "message", message: { role: "user" } },
    { type: "message", message: { role: "toolResult" } },
    { type: "message", message: { role: "assistant" } },
  ];
  assert.equal(countBranchConversationMessages(entries), 2);
});

test("turn counting only resets on a memory compaction", () => {
  const contextCompaction = [
    { type: "message", message: { role: "user" } },
    { type: "compaction", summary: "pi freed room for the model" },
    { type: "message", message: { role: "user" } },
    { type: "message", message: { role: "assistant" } },
  ];
  // A plain context compaction must not postpone the memory threshold.
  assert.equal(countBranchConversationMessages(contextCompaction), 2);

  const memoryCompaction = [
    ...contextCompaction,
    { type: "compaction", summary: "digested", details: { piDesktopMemoryCompaction: true } },
    { type: "message", message: { role: "user" } },
  ];
  assert.equal(countBranchConversationMessages(memoryCompaction), 1);
});

test("branch counting without compaction counts every conversation message", () => {
  const entries = [
    { type: "message", message: { role: "user" } },
    { type: "message", message: { role: "assistant" } },
    { type: "message", message: { role: "assistant" } },
  ];
  assert.equal(countBranchConversationMessages(entries), 3);
});
