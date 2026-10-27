import type { RuleCategory } from "./types";

/**
 * The guided interview: how the owner describes their own method. Each
 * question maps to the rule category its answers usually become.
 */
export const INTERVIEW_QUESTIONS = [
  {
    key: "steps",
    category: "structure",
    question: "Walk through how you do this task, step by step.",
    hint: "What do you read first, what do you write first, what order do sections go in?",
  },
  {
    key: "standards",
    category: "content",
    question: "What must every finished piece contain?",
    hint: "Decisions, owners, dates, figures, a summary…",
  },
  {
    key: "alwaysCut",
    category: "cut",
    question: "What do you always leave out?",
    hint: "Small talk, side discussions, repeated points…",
  },
  {
    key: "neverChange",
    category: "content",
    question: "What do you never change from the input?",
    hint: "Exact figures, quoted wording, legal terms…",
  },
  {
    key: "naming",
    category: "naming",
    question: "How do you write names, titles, dates and organisations?",
    hint: "“the Chair”, full names on first mention, 24-hour times…",
  },
  {
    key: "tone",
    category: "tone",
    question: "What tone and voice do you write in?",
    hint: "Formal, third person, past tense…",
  },
  {
    key: "mistakes",
    category: "content",
    question: "What mistakes do people make when they do this, that you never make?",
    hint: "",
  },
] as const satisfies readonly {
  key: string;
  category: RuleCategory;
  question: string;
  hint: string;
}[];

export type InterviewKey = (typeof INTERVIEW_QUESTIONS)[number]["key"];
export type InterviewAnswers = Partial<Record<InterviewKey, string>>;

/** Non-empty answers, in question order. */
export function answeredQuestions(answers: InterviewAnswers | null | undefined) {
  return INTERVIEW_QUESTIONS.filter((q) => answers?.[q.key]?.trim()).map((q) => ({
    ...q,
    answer: answers![q.key]!.trim(),
  }));
}

/** The answers as a block of text for prompts. */
export function interviewText(answers: InterviewAnswers | null | undefined): string {
  return answeredQuestions(answers)
    .map((q) => `Q: ${q.question}\nA: ${q.answer}`)
    .join("\n\n");
}
