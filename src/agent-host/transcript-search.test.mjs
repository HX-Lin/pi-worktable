import assert from "node:assert/strict";
import test from "node:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { buildSnippet, lineText, searchTranscripts } from "./transcript-search.ts";

function session(id, filePath, overrides = {}) {
  return {
    id,
    path: filePath,
    cwd: "/workspace/pi-desktop",
    name: "",
    firstMessage: "",
    created: "2026-07-15T12:00:00.000Z",
    modified: "2026-07-15T12:00:00.000Z",
    ...overrides,
  };
}

function messageLine(role, text, id = "e1") {
  return JSON.stringify({ type: "message", id, message: { role, content: [{ type: "text", text }] } });
}

test("lineText reads message lines only", () => {
  assert.deepEqual(lineText(messageLine("user", "hello")), { text: "hello", role: "user", entryId: "e1" });
  assert.equal(lineText(JSON.stringify({ type: "session_info", name: "x" })), null);
  assert.equal(lineText("not json"), null);
  assert.equal(lineText(""), null);
  // Thinking blocks carry no text and must not match.
  const thinking = JSON.stringify({
    type: "message",
    id: "e2",
    message: { role: "assistant", content: [{ type: "thinking", thinking: "secret" }] },
  });
  assert.deepEqual(lineText(thinking), { text: "", role: "assistant", entryId: "e2" });
});

test("buildSnippet centres on the match and flags truncation", () => {
  const text = "a".repeat(200) + "NEEDLE" + "b".repeat(200);
  const snippet = buildSnippet(text, "needle");
  assert.ok(snippet.startsWith("…"));
  assert.ok(snippet.endsWith("…"));
  assert.ok(snippet.includes("NEEDLE"));
  assert.equal(buildSnippet("nothing here", "needle"), null);
});

test("searchTranscripts finds hits across sessions, newest first", () => {
  const dir = mkdtempSync(path.join(tmpdir(), "pi-transcript-"));
  try {
    const older = path.join(dir, "older.jsonl");
    const newer = path.join(dir, "newer.jsonl");
    writeFileSync(
      older,
      [messageLine("user", "how do I parse the config"), messageLine("assistant", "read the config loader")].join("\n"),
    );
    writeFileSync(newer, messageLine("user", "unrelated words here", "z9"));

    const hits = searchTranscripts({
      query: "config",
      sessions: [
        session("older", older, { modified: "2026-07-10T00:00:00.000Z", name: "older session" }),
        session("newer", newer, { modified: "2026-07-14T00:00:00.000Z" }),
      ],
    });
    assert.equal(hits.length, 2);
    assert.equal(hits[0].sessionId, "older");
    assert.equal(hits[0].sessionName, "older session");
    assert.equal(hits[0].role, "user");
    assert.ok(hits[1].snippet.includes("config loader"));

    // A one character query is not a search.
    assert.deepEqual(searchTranscripts({ query: "c", sessions: [session("older", older)] }), []);
    // Respect the limit.
    assert.equal(searchTranscripts({ query: "config", sessions: [session("older", older)], limit: 1 }).length, 1);
    // Missing files are skipped rather than thrown.
    assert.deepEqual(
      searchTranscripts({ query: "config", sessions: [session("gone", path.join(dir, "nope.jsonl"))] }),
      [],
    );
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
