/**
 * Goal mode: give a conversation an objective, and let a fresh reviewer decide
 * whether the last answer actually met it.
 *
 * The reviewer runs as its own agent with no tools: it sees the goal, the final
 * answer and the diff summary, and answers with a verdict. Keeping it out of the
 * working session is deliberate — the model that wrote the answer is the worst
 * judge of whether it is done.
 */
import { DEFAULT_MAX_ROUNDS, MAX_ROUNDS_LIMIT } from "../shared/goal-limits.ts";

export { DEFAULT_MAX_ROUNDS, MAX_ROUNDS_LIMIT };

import type { GoalState } from "../shared/api-types";

export type { GoalState };

export const GOAL_ENTRY_TYPE = "pi-worktable-goal";

export function clampMaxRounds(value: unknown): number {
  const numeric = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(numeric)) return DEFAULT_MAX_ROUNDS;
  return Math.max(1, Math.min(MAX_ROUNDS_LIMIT, Math.round(numeric)));
}

export function goalIsRunning(state: GoalState | null): boolean {
  return state !== null && state.status === "active";
}

export const REVIEWER_SYSTEM_PROMPT = [
  "You review whether an assistant's final answer met a stated goal.",
  "You have no tools and need none: judge only what is in front of you.",
  'Answer with JSON on one line: {"met": true|false, "reason": "one or two sentences"}.',
  "Say met:false when the goal asks for something the answer does not show, and name the missing part.",
  "Do not praise, do not restate the goal, and never invent work you cannot see.",
].join(" ");

export function buildReviewTask(input: { goal: string; finalText: string; diffStat?: string }): string {
  const sections = [`## Goal\n${input.goal}`, `## Final answer\n${input.finalText.trim() || "(empty)"}`];
  if (input.diffStat?.trim()) sections.push(`## Working tree changes\n${input.diffStat.trim()}`);
  sections.push("## Verdict");
  return sections.join("\n\n");
}

/**
 * Read the reviewer's verdict. A reply that is not parseable counts as "not
 * met": stopping early on a garbled verdict is the failure mode that loses work.
 */
export function parseGoalVerdict(text: string): { met: boolean; reason: string } {
  const trimmed = text.trim();
  const candidates: string[] = [];
  const fenced = /```(?:json)?\s*([\s\S]*?)```/i.exec(trimmed);
  if (fenced) candidates.push(fenced[1]);
  candidates.push(trimmed);
  const braces = /\{[\s\S]*\}/.exec(trimmed);
  if (braces) candidates.push(braces[0]);

  for (const candidate of candidates) {
    try {
      const parsed = JSON.parse(candidate) as { met?: unknown; reason?: unknown };
      if (typeof parsed.met === "boolean") {
        return { met: parsed.met, reason: typeof parsed.reason === "string" ? parsed.reason.trim() : "" };
      }
    } catch {
      // try the next shape
    }
  }

  // No JSON: fall back to an explicit "met" / "not met" line before giving up.
  if (/\bnot\s+met\b/i.test(trimmed)) return { met: false, reason: trimmed.slice(0, 400) };
  if (/\bmet\b/i.test(trimmed)) return { met: true, reason: trimmed.slice(0, 400) };
  return { met: false, reason: "The reviewer did not return a usable verdict." };
}

export function buildContinuationPrompt(state: GoalState, reason: string): string {
  const lines = [
    `（目标模式：第 ${String(state.rounds + 1)}/${String(state.maxRounds)} 轮审查认为目标尚未达成。）`,
    `目标：${state.text}`,
  ];
  if (reason) lines.push(`审查意见：${reason}`);
  lines.push("请继续把这个目标做完，不要重复已完成的步骤；完成后简要说明改了什么。");
  return lines.join("\n");
}

export function nextGoalState(
  state: GoalState,
  verdict: { met: boolean; reason: string },
  now: string = new Date().toISOString(),
): GoalState {
  if (verdict.met) {
    return { ...state, status: "met", lastReason: verdict.reason, updatedAt: now };
  }
  const rounds = state.rounds + 1;
  return {
    ...state,
    rounds,
    status: rounds >= state.maxRounds ? "exhausted" : "active",
    lastReason: verdict.reason,
    updatedAt: now,
  };
}
