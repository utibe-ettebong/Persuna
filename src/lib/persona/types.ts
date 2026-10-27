import { z } from "zod";
import { INTERVIEW_QUESTIONS, type InterviewKey } from "@/lib/skill/interview";

const interviewKey = z.enum(
  INTERVIEW_QUESTIONS.map((q) => q.key) as [InterviewKey, ...InterviewKey[]],
);

/** Something Persona does besides talking. The service applies each one. */
export const personaAction = z.discriminatedUnion("type", [
  z.object({ type: z.literal("remember"), fact: z.string().trim().min(1).max(240) }),
  z.object({
    type: z.literal("note"),
    title: z.string().trim().min(1).max(100),
    body: z.string().trim().min(1).max(4000),
  }),
  z.object({
    type: z.literal("set_focus"),
    focus: z.string().trim().min(1).max(200),
    skill: z.string().trim().max(80).nullish(),
  }),
  z.object({ type: z.literal("answer"), key: interviewKey, answer: z.string().trim().min(1) }),
  z.object({ type: z.literal("learn"), method: z.string().trim().min(1).max(4000) }),
]);
export type PersonaAction = z.infer<typeof personaAction>;

export const personaReply = z.object({
  reply: z.string().trim().min(1).max(1500),
  actions: z.array(personaAction).max(6).default([]),
  /** The interview question this reply asks, so the next answer can be saved against it. */
  asked: interviewKey.nullish(),
});
export type PersonaReply = z.infer<typeof personaReply>;

export const personaObservation = z.object({
  /** A short remark to the user, or null to stay quiet (the usual case). */
  say: z.string().trim().max(400).nullish(),
  /** One method step seen on screen, or null when nothing new happened. */
  step: z.string().trim().max(400).nullish(),
});
export type PersonaObservation = z.infer<typeof personaObservation>;

/** What Persona knows going into a turn. Built by the service, read by the prompt. */
export interface PersonaState {
  today: string;
  name: string;
  memory: string[];
  focus: string | null;
  focusSkill: {
    slug: string;
    name: string;
    task: string;
    hasRules: boolean;
    unanswered: { key: InterviewKey; question: string }[];
  } | null;
  skills: { slug: string; name: string }[];
  /** The question Persona asked in its last message, if any. */
  lastAsked: InterviewKey | null;
}

export interface PersonaTurn {
  role: "user" | "assistant";
  content: string;
}
