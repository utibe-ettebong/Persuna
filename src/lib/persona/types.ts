import { z } from "zod";
import { INTERVIEW_QUESTIONS, type InterviewKey } from "@/lib/skill/interview";
import type { Tone } from "./tone";

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
  /** A reminder ("at" in the user's local time, YYYY-MM-DDTHH:mm) or, with no time, a to-do. */
  z.object({
    type: z.literal("remind"),
    text: z.string().trim().min(1).max(300),
    at: z.string().nullish(),
  }),
  /** The user wants Persona to do a task with one of their skills: the app asks for the input. */
  z.object({ type: z.literal("run_task"), skill: z.string().trim().max(80).nullish() }),
  /** The user asked how a skill is doing, or how to get it listed. */
  z.object({ type: z.literal("coach"), skill: z.string().trim().max(80).nullish() }),
  /** The user asked for a summary of their day. */
  z.object({ type: z.literal("wrap_up") }),
  /**
   * The user wants something done or found in their connected apps (email,
   * calendar, Notion): the goal in their words, with any details they gave.
   */
  z.object({ type: z.literal("app_task"), goal: z.string().trim().min(3).max(1000) }),
  /** The user wants Persona to start or stop watching their screen (the app asks permission). */
  z.object({ type: z.literal("watch_screen"), on: z.boolean() }),
  /** The user wants to see a page: Persona takes them there. */
  z.object({
    type: z.literal("open_page"),
    page: z.enum(["persona", "todos", "skills", "skill", "jobs", "market", "earnings", "audit"]),
    skill: z.string().trim().max(80).nullish(),
  }),
  /** The user wants Persona to learn a new kind of task: a new skill, which becomes the focus. */
  z.object({
    type: z.literal("create_skill"),
    name: z.string().trim().min(3).max(120),
    task: z.string().trim().min(10).max(1000),
    input: z.string().trim().max(120).nullish(),
    output: z.string().trim().max(120).nullish(),
  }),
  /** The user wants to give an example (before and after): the app opens a card for it. */
  z.object({ type: z.literal("add_example"), skill: z.string().trim().max(80).nullish() }),
  /** Learn the skill's rules from its examples. */
  z.object({ type: z.literal("train_skill"), skill: z.string().trim().max(80).nullish() }),
  /** Score the skill against its held-back examples. */
  z.object({ type: z.literal("test_skill"), skill: z.string().trim().max(80).nullish() }),
  /** Publish the skill's current version (the app asks the user to confirm first). */
  z.object({ type: z.literal("publish_skill"), skill: z.string().trim().max(80).nullish() }),
  /**
   * The user has moved on to something that belongs to a different skill (or a
   * new one): Persona asks before switching. `skill` is the other skill's slug.
   */
  z.object({
    type: z.literal("suggest_switch"),
    skill: z.string().trim().max(80).nullish(),
    task: z.string().trim().max(200).nullish(),
  }),
  /** The user said how they want to be spoken to. */
  z.object({
    type: z.literal("set_tone"),
    length: z.enum(["short", "normal", "detailed"]).nullish(),
    formality: z.enum(["casual", "neutral", "formal"]).nullish(),
    playful: z.boolean().nullish(),
    note: z.string().trim().max(160).nullish(),
  }),
]);
export type PersonaAction = z.infer<typeof personaAction>;

export const personaReply = z.object({
  /** When the message was a recording: what the user said, word for word. */
  heard: z.string().trim().max(4000).nullish(),
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
  /** What the user seems to be doing, when it isn't today's focus at all; else null. */
  offFocus: z.string().trim().max(200).nullish(),
});
export type PersonaObservation = z.infer<typeof personaObservation>;

/** What Persona knows going into a turn. Built by the service, read by the prompt. */
export interface PersonaState {
  today: string;
  /** The user's local time, YYYY-MM-DDTHH:mm. */
  now: string;
  name: string;
  memory: string[];
  focus: string | null;
  focusSkill: {
    slug: string;
    name: string;
    task: string;
    hasRules: boolean;
    published: boolean;
    trainExamples: number;
    testExamples: number;
    score: number | null;
    unanswered: { key: InterviewKey; question: string }[];
  } | null;
  skills: { slug: string; name: string; published: boolean }[];
  /** Open to-dos and reminders. */
  todos: string[];
  /** How to talk to this user: their explicit choices, else what Persona noticed. */
  tone: Tone;
  /** The question Persona asked in its last message, if any. */
  lastAsked: InterviewKey | null;
  /** The skill Persona just offered to switch to (it asked "switch?"), if any. */
  pendingSwitch: { slug: string; name: string } | null;
}

export interface PersonaTurn {
  role: "user" | "assistant";
  content: string;
}
