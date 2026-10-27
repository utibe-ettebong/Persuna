import { describe, expect, it } from "vitest";
import { createMockClient } from "@/lib/models/mock";
import { personaObserve, personaTurn, tidyReply } from "./brain";
import type { PersonaState } from "./types";

const state = (over: Partial<PersonaState> = {}): PersonaState => ({
  today: "2026-10-27",
  now: "2026-10-27T10:15",
  name: "Persona",
  memory: [],
  focus: null,
  focusSkill: null,
  skills: [{ slug: "meeting-minutes", name: "Meeting minutes", published: true }],
  todos: [],
  tone: {},
  lastAsked: null,
  ...over,
});

const training = state({
  focus: "the board minutes",
  focusSkill: {
    slug: "meeting-minutes",
    name: "Meeting minutes",
    task: "Notes to minutes",
    hasRules: false,
    published: true,
    unanswered: [
      { key: "steps", question: "Walk through how you do this task, step by step." },
      { key: "tone", question: "What tone and voice do you write in?" },
    ],
  },
});

describe("tidyReply", () => {
  it("drops a focus skill the user doesn't own", () => {
    const reply = tidyReply(
      { reply: "ok", actions: [{ type: "set_focus", focus: "x", skill: "someone-elses" }] },
      state(),
    );
    expect(reply.actions).toEqual([{ type: "set_focus", focus: "x", skill: null }]);
  });

  it("drops answers and lessons when nothing is being trained", () => {
    const reply = tidyReply(
      {
        reply: "ok",
        actions: [
          { type: "answer", key: "tone", answer: "formal" },
          { type: "learn", method: "I always bold decisions" },
          { type: "remember", fact: "likes 24h times" },
        ],
        asked: "tone",
      },
      state(),
    );
    expect(reply.actions.map((a) => a.type)).toEqual(["remember"]);
    expect(reply.asked).toBeNull();
  });

  it("keeps a question only if it is still unanswered", () => {
    expect(tidyReply({ reply: "?", actions: [], asked: "steps" }, training).asked).toBe("steps");
    expect(tidyReply({ reply: "?", actions: [], asked: "naming" }, training).asked).toBeNull();
  });
});

describe("personaTurn with the offline mock", () => {
  const client = createMockClient();

  it("sets today's focus and matches it to a skill", async () => {
    const reply = await personaTurn(client, state(), [], "I'm working on the meeting minutes");
    expect(reply.actions).toEqual([
      { type: "set_focus", focus: "the meeting minutes", skill: "meeting-minutes" },
    ]);
  });

  it("remembers and takes notes", async () => {
    const remember = await personaTurn(client, state(), [], "Remember that I send minutes by 5pm");
    expect(remember.actions).toEqual([{ type: "remember", fact: "I send minutes by 5pm" }]);
    const note = await personaTurn(client, state(), [], "Take a note: chase the venue quote");
    expect(note.actions[0]).toMatchObject({ type: "note", body: "chase the venue quote" });
  });

  it("interviews one question at a time and saves each answer", async () => {
    const first = await personaTurn(client, training, [], "teach me");
    expect(first.asked).toBe("steps");
    const second = await personaTurn(
      client,
      { ...training, lastAsked: "steps" },
      [],
      "I read the notes, then write the header block",
    );
    expect(second.actions).toEqual([
      { type: "answer", key: "steps", answer: "I read the notes, then write the header block" },
    ]);
    expect(second.asked).toBe("tone");
  });

  it("learns a rule the user states", async () => {
    const reply = await personaTurn(client, training, [], "I always put decisions in bold");
    expect(reply.actions).toEqual([{ type: "learn", method: "I always put decisions in bold" }]);
  });
});

describe("personaTurn assistant actions with the offline mock", () => {
  const client = createMockClient();

  it("sets a reminder at a local time, or a to-do without one", async () => {
    const timed = await personaTurn(client, state(), [], "Remind me at 4pm to send the minutes");
    expect(timed.actions).toEqual([
      { type: "remind", text: "send the minutes", at: "2026-10-27T16:00" },
    ]);
    const todo = await personaTurn(client, state(), [], "todo: book the room");
    expect(todo.actions).toEqual([{ type: "remind", text: "book the room", at: null }]);
  });

  it("asks to run a task with the matching skill", async () => {
    const reply = await personaTurn(client, state(), [], "Turn these notes into meeting minutes");
    expect(reply.actions).toEqual([{ type: "run_task", skill: "meeting-minutes" }]);
  });

  it("coaches and wraps up", async () => {
    const coach = await personaTurn(client, state(), [], "How is my meeting minutes skill doing?");
    expect(coach.actions).toEqual([{ type: "coach", skill: "meeting-minutes" }]);
    const wrap = await personaTurn(client, state(), [], "Wrap up my day");
    expect(wrap.actions).toEqual([{ type: "wrap_up" }]);
  });
});

describe("tone with the offline mock", () => {
  const client = createMockClient();

  it("records a tone request", async () => {
    const reply = await personaTurn(client, state(), [], "Please keep it short");
    expect(reply.actions).toEqual([{ type: "set_tone", length: "short" }]);
  });

  it("answers in the user's tone", async () => {
    const long = await personaTurn(client, state(), [], "I'm working on the meeting minutes");
    const short = await personaTurn(
      client,
      state({ tone: { length: "short" } }),
      [],
      "I'm working on the meeting minutes",
    );
    expect(long.reply.split(/[.!?]\s/).length).toBeGreaterThan(1);
    expect(short.reply).toBe("Got it: today is the meeting minutes.");
  });
});

describe("personaObserve with the offline mock", () => {
  it("records one step per look and speaks only at the start", async () => {
    const client = createMockClient();
    const input = { name: "Persona", focus: null, frame: "data:image/jpeg;base64,AAAA" };
    const first = await personaObserve(client, { ...input, recentSteps: [] });
    expect(first.say).toBeTruthy();
    expect(first.step).toBeTruthy();
    const later = await personaObserve(client, { ...input, recentSteps: [first.step!] });
    expect(later.say).toBeNull();
    expect(later.step).not.toBe(first.step);
  });
});
