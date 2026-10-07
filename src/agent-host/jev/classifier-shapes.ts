/**
 * Translation between pi's classifier vocabulary and the System One wire vocabulary.
 *
 * pi asks `bool` questions; the wire protocol calls that same question `noul`. Everything else
 * (`score`, `choice`) is identical, so the mapping is small — but it must be exact in both
 * directions: the provider translates questions on the way out, and the host-side client translates
 * answers on the way back, so the gate, the compaction and the router keep their own vocabulary.
 */
import type { ClassifierAnswer, ClassifierQuestion } from "@earendil-works/pi-ai";
import type { JevAnswerValue, JevQuestionShape } from "./transport";

/** classifier → wire (outgoing request). */
export function toWireQuestions(questions: Record<string, ClassifierQuestion>): Record<string, JevQuestionShape> {
  return Object.fromEntries(
    Object.entries(questions).map(([id, question]) => [
      id,
      {
        type: question.type === "bool" ? "noul" : question.type,
        instructions: question.instructions,
        criteria: question.criteria,
      },
    ]),
  );
}

/** wire → classifier (host-side client request). */
export function toClassifierQuestions(questions: Record<string, JevQuestionShape>): Record<string, ClassifierQuestion> {
  return Object.fromEntries(
    Object.entries(questions).map(([id, question]) => [
      id,
      {
        type: question.type === "noul" ? "bool" : question.type,
        instructions: typeof question.instructions === "string" ? question.instructions : "",
        criteria: question.criteria,
      } as ClassifierQuestion,
    ]),
  );
}

/** wire answers → classifier answers (provider result). */
export function toClassifierAnswers(
  questions: Record<string, ClassifierQuestion>,
  answers: Record<string, JevAnswerValue>,
): Record<string, ClassifierAnswer> {
  const mapped: Record<string, ClassifierAnswer> = {};
  for (const [id, question] of Object.entries(questions)) {
    const answer = answers[id];
    if (!answer) continue;
    if (question.type === "bool" && typeof answer.noul === "number") {
      mapped[id] = { type: "bool", probability: answer.noul };
    } else if (question.type === "score" && typeof answer.score === "number") {
      mapped[id] = { type: "score", score: answer.score, confidence: answer.confidence ?? 0 };
    } else if (question.type === "choice" && typeof answer.choice === "string") {
      mapped[id] = {
        type: "choice",
        choice: answer.choice,
        probabilities: answer.probabilities ?? {},
        confidence: answer.confidence ?? 0,
      };
    }
  }
  return mapped;
}

/** classifier answers → wire answers (host-side client result). */
export function toWireAnswers(
  questions: Record<string, ClassifierQuestion>,
  answers: Record<string, ClassifierAnswer>,
): Record<string, JevAnswerValue> {
  const mapped: Record<string, JevAnswerValue> = {};
  for (const [id, question] of Object.entries(questions)) {
    const answer = answers[id];
    if (!answer) continue;
    if (question.type === "bool" && answer.type === "bool") {
      mapped[id] = { noul: answer.probability };
    } else if (question.type === "score" && answer.type === "score") {
      mapped[id] = { score: answer.score, confidence: answer.confidence };
    } else if (question.type === "choice" && answer.type === "choice") {
      mapped[id] = { choice: answer.choice, probabilities: answer.probabilities, confidence: answer.confidence };
    }
  }
  return mapped;
}
