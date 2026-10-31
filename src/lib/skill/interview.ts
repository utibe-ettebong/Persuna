import type { RuleCategory } from "./types";

/** A skill is a procedure with six layers; each interview question feeds one. */
export const LAYER_NAMES = {
  1: "Trigger",
  2: "Inputs",
  3: "Procedure",
  4: "Tools and prompts",
  5: "Standards and checks",
  6: "Output and handoff",
} as const;

export type Layer = keyof typeof LAYER_NAMES;

/**
 * The guided interview: how the owner describes their own method. Each
 * question maps to the rule category its answers usually become, and to the
 * procedure layer it evidences. The original seven writing questions stay as
 * layer 5; the other layers are covered around them.
 */
export const INTERVIEW_QUESTIONS = [
  {
    key: "trigger",
    category: "content",
    layer: 1,
    question: "What kicks this task off?",
    hint: "What arrives, from where, and how often?",
  },
  {
    key: "inputs",
    category: "content",
    layer: 2,
    question: "What do you open and read before you start?",
    hint: "Apps, files, pages — what form they're in, never their contents.",
  },
  {
    key: "decisions",
    category: "structure",
    layer: 3,
    question: "Where do you choose between different paths?",
    hint: "The decision points, and what each branch looks like.",
  },
  {
    key: "tools",
    category: "content",
    layer: 4,
    question: "Which tools and AI chats do you use?",
    hint: "What you always tell the AI, what you correct it on, when you stop iterating.",
  },
  {
    key: "steps",
    category: "structure",
    layer: 5,
    question: "Walk through how you do this task, step by step.",
    hint: "What do you read first, what do you write first, what order do sections go in?",
  },
  {
    key: "standards",
    category: "content",
    layer: 5,
    question: "What must every finished piece contain?",
    hint: "Decisions, owners, dates, figures, a summary…",
  },
  {
    key: "alwaysCut",
    category: "cut",
    layer: 5,
    question: "What do you always leave out?",
    hint: "Small talk, side discussions, repeated points…",
  },
  {
    key: "neverChange",
    category: "content",
    layer: 5,
    question: "What do you never change from the input?",
    hint: "Exact figures, quoted wording, legal terms…",
  },
  {
    key: "naming",
    category: "naming",
    layer: 5,
    question: "How do you write names, titles, dates and organisations?",
    hint: "“the Chair”, full names on first mention, 24-hour times…",
  },
  {
    key: "tone",
    category: "tone",
    layer: 5,
    question: "What tone and voice do you write in?",
    hint: "Formal, third person, past tense…",
  },
  {
    key: "mistakes",
    category: "content",
    layer: 5,
    question: "What mistakes do people make when they do this, that you never make?",
    hint: "",
  },
  {
    key: "handoff",
    category: "content",
    layer: 6,
    question: "Where does the finished work go?",
    hint: "Format, where it's saved or sent, who receives it, what happens after.",
  },
] as const satisfies readonly {
  key: string;
  category: RuleCategory;
  layer: Layer;
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

/** The layers with at least one answered question. */
export function answeredLayers(answers: InterviewAnswers | null | undefined): Layer[] {
  const layers = new Set(answeredQuestions(answers).map((q) => q.layer));
  return ([1, 2, 3, 4, 5, 6] as const).filter((layer) => layers.has(layer));
}

/** The answers as a block of text for prompts. */
export function interviewText(answers: InterviewAnswers | null | undefined): string {
  return answeredQuestions(answers)
    .map((q) => `Q: ${q.question}\nA: ${q.answer}`)
    .join("\n\n");
}
