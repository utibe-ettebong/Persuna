import { z } from "zod";
import { INTERVIEW_QUESTIONS, type InterviewKey } from "@/lib/skill/interview";
import type { OnboardingNote } from "@/lib/teams/types";
import type { Tone } from "./tone";

const interviewKey = z.enum(
  INTERVIEW_QUESTIONS.map((q) => q.key) as [InterviewKey, ...InterviewKey[]],
);

/** A small diagram: boxes and the arrows between them. */
export const flowSchema = z.object({
  direction: z.enum(["down", "right"]).default("down"),
  nodes: z
    .array(
      z.object({ id: z.string().trim().min(1).max(20), label: z.string().trim().min(1).max(60) }),
    )
    .min(1)
    .max(14),
  edges: z
    .array(
      z.object({
        from: z.string().trim().max(20),
        to: z.string().trim().max(20),
        label: z.string().trim().max(40).nullish(),
      }),
    )
    .max(24)
    .default([]),
});
export type Flow = z.infer<typeof flowSchema>;

/** Something Persuna does besides talking. The service applies each one. */
export const persunaAction = z.discriminatedUnion("type", [
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
  /** The user wants Persuna to do a task with one of their skills: the app asks for the input. */
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
  /**
   * Use a tool on one of the user's connected MCP servers (state.mcpServers).
   * Nothing runs on this action alone: the app shows the user exactly what
   * would run and only calls it when they approve.
   */
  z.object({
    type: z.literal("mcp"),
    server: z.string().trim().min(1).max(80),
    tool: z.string().trim().min(1).max(120),
    arguments: z.record(z.string(), z.unknown()).default({}),
  }),
  /** The user wants Persuna to start or stop watching their screen (the app asks permission). */
  z.object({ type: z.literal("watch_screen"), on: z.boolean() }),
  /**
   * Show the user where something is on their screen: an entry from the list
   * of what's on screen (e12, t3), or a short name for something visual that
   * isn't in it ("red warning icon"), which SAM 3.1 then finds in the picture.
   */
  z.object({
    type: z.literal("point"),
    item: z.string().trim().max(10).nullish(),
    thing: z.string().trim().max(80).nullish(),
  }),
  /** The list wasn't enough: answer again with the picture itself. */
  z.object({ type: z.literal("look_closer") }),
  /**
   * Copy text for the user, or paste it where their cursor is (in Persuna
   * Desktop; elsewhere it's copied and they paste it).
   */
  z.object({
    type: z.literal("clipboard"),
    op: z.enum(["copy", "paste"]),
    text: z.string().min(1).max(8000),
  }),
  /**
   * Draw over the screen: numbered notes on things in the list of what's on
   * screen (a walkthrough), and/or a small diagram of a flow or process.
   */
  z.object({
    type: z.literal("draw"),
    title: z.string().trim().max(80).nullish(),
    marks: z
      .array(z.object({ item: z.string().trim().max(10), note: z.string().trim().min(1).max(120) }))
      .max(8)
      .nullish(),
    flow: flowSchema.nullish(),
  }),
  /** Make a file the user can preview, copy and save: a document, a table or a diagram. */
  z.object({
    type: z.literal("make_file"),
    kind: z.enum(["document", "table", "flow"]),
    title: z.string().trim().min(1).max(100),
    /** Markdown for a document, CSV for a table; a short caption for a flow. */
    body: z.string().max(20_000).default(""),
    flow: flowSchema.nullish(),
  }),
  /** The user wants to see a page: Persuna takes them there. */
  z.object({
    type: z.literal("open_page"),
    page: z.enum(["persuna", "todos", "skills", "skill", "jobs", "market", "earnings", "audit"]),
    skill: z.string().trim().max(80).nullish(),
  }),
  /** The user wants Persuna to learn a new kind of task: a new skill, which becomes the focus. */
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
   * new one): Persuna asks before switching. `skill` is the other skill's slug.
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
export type PersunaAction = z.infer<typeof persunaAction>;

export const persunaReply = z.object({
  /** When the message was a recording: what the user said, word for word. */
  heard: z.string().trim().max(4000).nullish(),
  reply: z.string().trim().min(1).max(1500),
  actions: z.array(persunaAction).max(6).default([]),
  /** The interview question this reply asks, so the next answer can be saved against it. */
  asked: interviewKey.nullish(),
});
export type PersunaReply = z.infer<typeof persunaReply>;

export const persunaObservation = z.object({
  /** A short remark to the user, or null to stay quiet (the usual case). */
  say: z.string().trim().max(400).nullish(),
  /** One method step seen on screen, or null when nothing new happened. */
  step: z.string().trim().max(400).nullish(),
  /** What the user seems to be doing, when it isn't today's focus at all; else null. */
  offFocus: z.string().trim().max(200).nullish(),
});
export type PersunaObservation = z.infer<typeof persunaObservation>;

/**
 * Work mode: one look at what the user is doing, and whether to step in.
 * "follow" learns a step quietly; "guide" helps when they seem stuck or are
 * searching; "lead" offers to do the next bit for them; "ask" asks one
 * question about how or why they do it (to refine the skill); "explain"
 * explains something on screen they seem unsure about; "correct" points out
 * a slip from their own way of doing it; "quiet" does nothing.
 */
export const persunaWork = z.object({
  mode: z.enum(["quiet", "follow", "guide", "lead", "ask", "explain", "correct"]),
  /**
   * How what they're doing compares with how they usually do it (their skill
   * and the steps learned so far): the colour of Persuna's dot in Work mode.
   */
  fit: z.enum(["on_track", "unsure", "off"]).nullish(),
  /** The slug of their skill this work belongs to (state.skills), or null. */
  skill: z.string().trim().max(80).nullish(),
  /** What to say when guiding, leading, asking or explaining (short, in their tone); else null. */
  say: z.string().trim().max(300).nullish(),
  /** When guiding: the entry to point at (e12, t3), or null. */
  point: z.string().trim().max(10).nullish(),
  /** When leading: what Persuna would do, as the user would ask for it ("Draft a reply to Sam"). */
  offer: z.string().trim().max(200).nullish(),
  /** One method step seen (follow, or alongside the others), or null. */
  step: z.string().trim().max(300).nullish(),
});
export type PersunaWork = z.infer<typeof persunaWork>;

/** What Persuna knows going into a turn. Built by the service, read by the prompt. */
export interface PersunaState {
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
  /** Remote MCP servers the user connected, with the tools each offers. */
  mcpServers: { name: string; tools: { name: string; description: string }[] }[];
  /** Open to-dos and reminders. */
  todos: string[];
  /** How to talk to this user: their explicit choices, else what Persuna noticed. */
  tone: Tone;
  /** The question Persuna asked in its last message, if any. */
  lastAsked: InterviewKey | null;
  /** The skill Persuna just offered to switch to (it asked "switch?"), if any. */
  pendingSwitch: { slug: string; name: string } | null;
  /** A company onboarding they're working through, if any: role, company, next module. */
  onboarding?: OnboardingNote | null;
}

export interface PersunaTurn {
  role: "user" | "assistant";
  content: string;
}
