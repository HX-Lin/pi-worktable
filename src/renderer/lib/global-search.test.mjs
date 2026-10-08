import assert from "node:assert/strict";
import test from "node:test";

import {
  buildSections,
  transcriptItems,
  clampSelection,
  flattenSections,
  moveSelection,
  rankProjects,
  rankSessions,
  splitTerms,
} from "./global-search.ts";

function session(id, overrides = {}) {
  return {
    id,
    path: `/sessions/${id}.jsonl`,
    cwd: "/workspace/pi-desktop",
    name: "",
    firstMessage: "",
    created: "2026-07-15T12:00:00.000Z",
    modified: "2026-07-15T12:00:00.000Z",
    ...overrides,
  };
}

test("splitTerms drops empties and lower-cases", () => {
  assert.deepEqual(splitTerms("  Fix   the BUG "), ["fix", "the", "bug"]);
  assert.deepEqual(splitTerms(""), []);
});

test("rankSessions matches name, first message and cwd, newest first", () => {
  const sessions = [
    session("a", { firstMessage: "fix the parser", modified: "2026-07-10T00:00:00.000Z" }),
    session("b", { name: "parser rewrite", modified: "2026-07-14T00:00:00.000Z" }),
    session("c", { firstMessage: "unrelated", modified: "2026-07-15T00:00:00.000Z" }),
  ];
  assert.deepEqual(
    rankSessions(sessions, "parser").map((s) => s.id),
    ["b", "a"],
  );
  // Empty query is not a filter: newest first.
  assert.deepEqual(
    rankSessions(sessions, "").map((s) => s.id),
    ["c", "b", "a"],
  );
});

test("rankSessions respects the limit and all-terms matching", () => {
  const sessions = [
    session("a", { firstMessage: "fix the parser bug" }),
    session("b", { firstMessage: "fix the renderer" }),
  ];
  assert.deepEqual(
    rankSessions(sessions, "fix parser").map((s) => s.id),
    ["a"],
  );
  assert.equal(rankSessions(sessions, "fix", 1).length, 1);
});

test("rankProjects matches label or root and keeps the limit", () => {
  const projects = [{ root: "/w/pi-desktop", label: "Pi Worktable" }, { root: "/w/loopmaster" }];
  assert.deepEqual(
    rankProjects(projects, "worktable").map((p) => p.root),
    ["/w/pi-desktop"],
  );
  assert.deepEqual(
    rankProjects(projects, "loop").map((p) => p.title),
    ["/w/loopmaster"],
  );
  assert.equal(rankProjects(projects, "/w/", 1).length, 1);
});

test("buildSections hides empty sections and the command list until something is typed", () => {
  const parts = {
    sessions: [session("a", { firstMessage: "hello" })],
    files: ["src/index.ts", "src/app.ts"],
    projects: [{ root: "/w/pi-desktop" }],
    actions: [{ id: "new-session", detail: "start a new conversation" }],
    actionLabels: { "new-session": "New session" },
    query: "",
    fileRoot: "/w/pi-desktop",
  };
  const empty = buildSections(parts);
  assert.deepEqual(
    empty.map((s) => s.kind),
    ["session", "file", "project"],
  );

  const typed = buildSections({ ...parts, query: "app" });
  assert.deepEqual(
    typed.map((s) => s.kind),
    ["file"],
  );
  assert.equal(typed[0].items[0].path, "src/app.ts");
});

test("buildSections omits files entirely when there is no root to search", () => {
  const sections = buildSections({
    sessions: [],
    files: ["src/index.ts"],
    projects: [],
    actions: [],
    actionLabels: {},
    query: "index",
    fileRoot: null,
  });
  assert.deepEqual(sections, []);
});

test("flattenSections keeps section order, clampSelection and moveSelection wrap", () => {
  const sections = buildSections({
    sessions: [session("a", { firstMessage: "one" }), session("b", { firstMessage: "two" })],
    files: ["src/index.ts"],
    projects: [],
    actions: [{ id: "new-session", detail: "start a new conversation" }],
    actionLabels: { "new-session": "New session" },
    query: "o",
    fileRoot: "/w/pi-desktop",
  });
  const flat = flattenSections(sections);
  assert.ok(flat.length >= 3);
  assert.equal(flat[0].kind, "session");

  assert.equal(clampSelection(5, 3), 2);
  assert.equal(clampSelection(1, 0), -1);
  assert.equal(moveSelection(0, 3, -1), 2);
  assert.equal(moveSelection(2, 3, 1), 0);
  assert.equal(moveSelection(-1, 3, 1), 0);
  assert.equal(moveSelection(-1, 3, -1), 2);
  assert.equal(moveSelection(0, 0, 1), -1);
});

test("transcript hits become one row per conversation, pointing at sessions", () => {
  const sessions = [session("a", { name: "parser work" }), session("b", { firstMessage: "other" })];
  const items = transcriptItems(
    [
      {
        sessionId: "a",
        sessionName: "parser work",
        cwd: "/w",
        entryId: "e1",
        role: "user",
        snippet: "fix the parser",
        modified: "2026-07-15T00:00:00.000Z",
      },
      {
        sessionId: "a",
        sessionName: "parser work",
        cwd: "/w",
        entryId: "e2",
        role: "assistant",
        snippet: "parser done",
        modified: "2026-07-15T00:00:00.000Z",
      },
      {
        sessionId: "missing",
        sessionName: "gone",
        cwd: "/w",
        role: "user",
        snippet: "parser elsewhere",
        modified: "2026-07-15T00:00:00.000Z",
      },
    ],
    sessions,
  );
  // One row per conversation, and a hit in an unknown session keeps its text but no session.
  assert.equal(items.length, 2);
  assert.equal(items[0].kind, "transcript");
  assert.equal(items[0].session?.id, "a");
  assert.equal(items[0].title, "fix the parser");
  assert.equal(items[1].session, undefined);

  const sections = buildSections({
    sessions,
    transcriptHits: [
      {
        sessionId: "a",
        sessionName: "parser work",
        cwd: "/w",
        entryId: "e1",
        role: "user",
        snippet: "fix the parser",
        modified: "2026-07-15T00:00:00.000Z",
      },
    ],
    files: [],
    projects: [],
    actions: [],
    actionLabels: {},
    query: "",
    fileRoot: null,
  });
  assert.deepEqual(
    sections.map((section) => section.kind),
    ["session", "transcript"],
  );
});
