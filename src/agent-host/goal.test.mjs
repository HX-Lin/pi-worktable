import assert from "node:assert/strict";
import test from "node:test";

import {
  buildContinuationPrompt,
  buildReviewTask,
  clampMaxRounds,
  DEFAULT_MAX_ROUNDS,
  MAX_ROUNDS_LIMIT,
  nextGoalState,
  parseGoalVerdict,
} from "./goal.ts";

const base = {
  text: "make it work",
  maxRounds: 3,
  rounds: 0,
  autoReview: true,
  status: "active",
  updatedAt: "2026-01-01T00:00:00.000Z",
};

test("rounds are clamped into a sane range", () => {
  assert.equal(clampMaxRounds(undefined), DEFAULT_MAX_ROUNDS);
  assert.equal(clampMaxRounds("abc"), DEFAULT_MAX_ROUNDS);
  assert.equal(clampMaxRounds(0), 1);
  assert.equal(clampMaxRounds(99), MAX_ROUNDS_LIMIT);
  assert.equal(clampMaxRounds(2.6), 3);
});

test("a verdict is read from plain JSON, fenced JSON, or prose", () => {
  assert.deepEqual(parseGoalVerdict('{"met":true,"reason":"done"}'), { met: true, reason: "done" });
  assert.deepEqual(parseGoalVerdict('```json\n{"met":false,"reason":"tests missing"}\n```'), {
    met: false,
    reason: "tests missing",
  });
  assert.equal(parseGoalVerdict("The goal is not met yet: no tests.").met, false);
});

test("an unusable verdict counts as not met, so work is not dropped", () => {
  const verdict = parseGoalVerdict("I think it looks fine?");
  assert.equal(verdict.met, false);
  assert.match(verdict.reason, /usable verdict/);
});

test("the reviewer sees the goal, the answer and the diff", () => {
  const task = buildReviewTask({ goal: "fix the parser", finalText: " done ", diffStat: " src/a.ts | 2 +-" });
  assert.match(task, /## Goal\nfix the parser/);
  assert.match(task, /## Final answer\ndone/);
  assert.match(task, /## Working tree changes/);
  assert.match(task, /## Verdict$/);
  // An empty answer is called out rather than silently blank.
  assert.match(buildReviewTask({ goal: "g", finalText: "   " }), /\(empty\)/);
});

test("state advances one round at a time and stops at the cap", () => {
  const first = nextGoalState(base, { met: false, reason: "no tests" }, "2026-01-02T00:00:00.000Z");
  assert.equal(first.rounds, 1);
  assert.equal(first.status, "active");
  const second = nextGoalState(first, { met: false, reason: "still no tests" });
  assert.equal(second.rounds, 2);
  const third = nextGoalState(second, { met: false, reason: "nope" });
  assert.equal(third.rounds, 3);
  assert.equal(third.status, "exhausted");
});

test("a met verdict stops immediately and keeps the reason", () => {
  const done = nextGoalState({ ...base, rounds: 1 }, { met: true, reason: "all tests pass" });
  assert.equal(done.status, "met");
  assert.equal(done.rounds, 1);
  assert.equal(done.lastReason, "all tests pass");
});

test("the continuation prompt carries the goal, the round and the objection", () => {
  const prompt = buildContinuationPrompt({ ...base, rounds: 1 }, "tests are missing");
  assert.match(prompt, /第 2\/3 轮/);
  assert.match(prompt, /目标：make it work/);
  assert.match(prompt, /审查意见：tests are missing/);
});
