import assert from "node:assert/strict";
import test from "node:test";

import { formatAnswers } from "./extension.ts";

test("answers keep the user's own wording and the picked labels", () => {
  const text = formatAnswers([
    { header: "Scope", selected: ["Only the parser"] },
    { header: "Extras", selected: ["Tests", "Docs"], custom: "and a changelog entry" },
    { header: "Name", selected: [], custom: "pi-worktable" },
  ]);
  assert.equal(
    text,
    ["Scope: Only the parser", 'Extras: Tests; Docs · "and a changelog entry"', 'Name: "pi-worktable"'].join("\n"),
  );
});

test("an empty answer is called out rather than rendered blank", () => {
  assert.equal(formatAnswers([{ header: "Q", selected: [] }]), "Q: (no answer)");
});
