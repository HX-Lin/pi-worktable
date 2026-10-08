/**
 * `ask_user_question`: let the model ask the user instead of guessing.
 *
 * pi has no questionnaire tool, and a plain `confirm` cannot express "pick one of
 * these" — so this tool drives the desktop's existing dialog bridge: one
 * `select` per question (repeated for multi-select) plus `input` for free text,
 * and the answers come back as the tool result.
 */
import { Type } from "typebox";
import type { ExtensionAPI, ExtensionToolContext, InlineExtension } from "@earendil-works/pi-coding-agent";

const Option = Type.Object({
  label: Type.String({ description: "Short option label" }),
  description: Type.Optional(Type.String({ description: "One line explaining the option" })),
});

const Question = Type.Object({
  header: Type.String({ description: "Short title for this question, e.g. 'Scope'" }),
  question: Type.String({ description: "The question to ask" }),
  options: Type.Array(Option, { description: "Choices to offer" }),
  multiSelect: Type.Optional(Type.Boolean({ description: "Allow picking more than one option" })),
  allowFreeText: Type.Optional(Type.Boolean({ description: 'Append a "type my own answer" choice' })),
});

const Params = Type.Object({
  questions: Type.Array(Question, { description: "Questions to ask, in order" }),
});

interface Answer {
  header: string;
  /** Chosen labels, in the order picked. */
  selected: string[];
  /** Free text the user typed, when offered and used. */
  custom?: string;
}

const CUSTOM_LABEL = "Type my own answer…";
const DONE_LABEL = "Done selecting";

function optionLabel(option: { label: string; description?: string }): string {
  return option.description ? `${option.label} — ${option.description}` : option.label;
}

function labelToOption(option: { label: string; description?: string }): string {
  return optionLabel(option);
}

async function askOne(
  ctx: ExtensionToolContext,
  question: {
    header: string;
    question: string;
    options: Array<{ label: string; description?: string }>;
    multiSelect?: boolean;
    allowFreeText?: boolean;
  },
): Promise<Answer | null> {
  const selected: string[] = [];
  const base = question.options.map(labelToOption);

  if (question.multiSelect) {
    // Repeat until the user says they are done; Escape cancels the question.
    for (;;) {
      const remaining = base.filter((label) => !selected.includes(label));
      const choices = [...remaining, ...(question.allowFreeText ? [CUSTOM_LABEL] : []), DONE_LABEL];
      const picked = await ctx.ui.select(`${question.header}: ${question.question}`, choices);
      if (picked === undefined) return null;
      if (picked === DONE_LABEL) break;
      if (picked === CUSTOM_LABEL) {
        const typed = await ctx.ui.input(question.header, "Your answer");
        if (typed && typed.trim()) selected.push(typed.trim());
        continue;
      }
      selected.push(picked);
      if (remaining.length === 1) break;
    }
    return { header: question.header, selected };
  }

  const choices = [...base, ...(question.allowFreeText ? [CUSTOM_LABEL] : [])];
  const picked = await ctx.ui.select(`${question.header}: ${question.question}`, choices);
  if (picked === undefined) return null;
  if (picked === CUSTOM_LABEL) {
    const typed = await ctx.ui.input(question.header, "Your answer");
    if (typed === undefined) return null;
    return { header: question.header, selected: [], custom: typed.trim() };
  }
  return { header: question.header, selected: [picked] };
}

/** Answers as text for the model, keeping the user's own wording. */
export function formatAnswers(answers: Answer[]): string {
  return answers
    .map((answer) => {
      const picked = answer.selected.join("; ");
      const custom = answer.custom ? `"${answer.custom}"` : "";
      const value = [picked, custom].filter(Boolean).join(" · ") || "(no answer)";
      return `${answer.header}: ${value}`;
    })
    .join("\n");
}

export const ASK_USER_QUESTION_EXTENSION: InlineExtension = {
  name: "ask-user-question",
  factory: (pi: ExtensionAPI) => {
    pi.registerTool({
      name: "ask_user_question",
      label: "Ask user",
      description: [
        "Ask the user structured questions when the answer changes what you do next.",
        "Prefer this over guessing: each question has a header, the question itself, and options.",
        'Set multiSelect for "pick any", allowFreeText to let the user answer in their own words.',
        "Answers come back as the tool result. Use it sparingly — one round of questions beats several.",
      ].join(" "),
      parameters: Params,

      async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
        const questions = (params as { questions: Array<Parameters<typeof askOne>[1]> }).questions ?? [];
        if (questions.length === 0) {
          return {
            content: [{ type: "text", text: "No questions were provided." }],
            details: { answers: [] },
            isError: true,
          };
        }

        const answers: Answer[] = [];
        for (const question of questions) {
          const answer = await askOne(ctx, question);
          if (!answer) {
            // Cancelling one question cancels the set: the model should not act
            // on a partial answer.
            return {
              content: [
                {
                  type: "text",
                  text: "The user dismissed the questions; ask again or proceed with a stated assumption.",
                },
              ],
              details: { answers, cancelled: true },
              isError: true,
            };
          }
          answers.push(answer);
        }

        return {
          content: [{ type: "text", text: formatAnswers(answers) }],
          details: { answers },
        };
      },
    });
  },
};
