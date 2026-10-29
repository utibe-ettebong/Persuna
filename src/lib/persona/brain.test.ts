import { describe, expect, it } from "vitest";
import type { ModelClient } from "@/lib/models/gateway";
import { sceneSchema } from "./scene";
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
  pendingSwitch: null,
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
    trainExamples: 0,
    testExamples: 0,
    score: null,
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
    const watch = await personaTurn(client, state(), [], "Watch my screen while I work");
    expect(watch.actions).toEqual([{ type: "watch_screen", on: true }]);
    const stop = await personaTurn(client, state(), [], "Stop watching");
    expect(stop.actions).toEqual([{ type: "watch_screen", on: false }]);
  });
});

describe("open_page with the offline mock", () => {
  const client = createMockClient();
  it("takes the user to a page or one of their skills", async () => {
    expect((await personaTurn(client, state(), [], "show me my jobs")).actions).toEqual([
      { type: "open_page", page: "jobs", skill: null },
    ]);
    expect((await personaTurn(client, state(), [], "open the meeting minutes")).actions).toEqual([
      { type: "open_page", page: "skill", skill: "meeting-minutes" },
    ]);
  });
  it("never opens someone else's skill", () => {
    expect(
      tidyReply(
        { reply: "ok", actions: [{ type: "open_page", page: "skill", skill: "theirs" }] },
        state(),
      ).actions,
    ).toEqual([{ type: "open_page", page: "skills", skill: null }]);
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

describe("building skills by conversation (offline mock)", () => {
  const client = createMockClient();
  const twoSkills = state({
    focus: "the board minutes",
    focusSkill: { ...training.focusSkill!, unanswered: [] },
    skills: [
      { slug: "meeting-minutes", name: "Meeting minutes", published: true },
      { slug: "seo-briefs", name: "SEO briefs", published: false },
    ],
  });

  it("creates a skill when asked to learn something new", async () => {
    const reply = await personaTurn(client, state(), [], "I want you to learn writing SEO briefs");
    expect(reply.actions[0]).toMatchObject({ type: "create_skill", name: "Writing SEO briefs" });
  });

  it("asks for an example, trains, tests and publishes on request", async () => {
    const said = async (t: string) =>
      (await personaTurn(client, twoSkills, [], t)).actions[0]?.type;
    expect(await said("Here's an example")).toBe("add_example");
    expect(await said("Train yourself")).toBe("train_skill");
    expect(await said("Test yourself")).toBe("test_skill");
    expect(await said("Publish it")).toBe("publish_skill");
  });

  it("offers to switch when the work belongs to another skill, and switches on yes", async () => {
    const drift = await personaTurn(
      client,
      twoSkills,
      [],
      "Can you draft the SEO briefs for the client?",
    );
    expect(drift.actions).toEqual([{ type: "suggest_switch", skill: "seo-briefs", task: null }]);
    const pending = { ...twoSkills, pendingSwitch: { slug: "seo-briefs", name: "SEO briefs" } };
    expect((await personaTurn(client, pending, [], "yes")).actions).toEqual([
      { type: "set_focus", focus: "SEO briefs", skill: "seo-briefs" },
    ]);
    expect((await personaTurn(client, pending, [], "no, stay")).actions).toEqual([]);
  });

  it("never points skill actions at someone else's skill", () => {
    const tidy = tidyReply(
      {
        reply: "ok",
        actions: [
          { type: "publish_skill", skill: "not-mine" },
          { type: "suggest_switch", skill: "not-mine", task: null },
        ],
      },
      twoSkills,
    );
    expect(tidy.actions).toEqual([
      { type: "publish_skill", skill: null },
      { type: "suggest_switch", skill: null, task: null },
    ]);
  });
});

describe("hearing a recording directly", () => {
  it("sends the audio to the listening model and keeps what it heard", async () => {
    const calls: { role: string; content: unknown }[] = [];
    const client: ModelClient = {
      async complete(role, messages) {
        calls.push({ role, content: messages.at(-1)?.content });
        const reply = { heard: "Remind me at four", reply: "Okay, four it is.", actions: [] };
        return { text: JSON.stringify(reply), model: "fake", promptTokens: 0, completionTokens: 0 };
      },
    };
    const reply = await personaTurn(client, state(), [], { audio: "UklGRg==" });
    expect(calls[0].role).toBe("listen");
    expect(calls[0].content).toEqual([
      expect.objectContaining({ type: "text" }),
      { type: "input_audio", input_audio: { data: "UklGRg==", format: "wav" } },
    ]);
    expect(reply.heard).toBe("Remind me at four");
  });
});

describe("tasks in connected apps", () => {
  it("hands email, calendar and Notion requests to the app task", async () => {
    for (const text of [
      "What did Ada email me about?",
      "Put lunch on my calendar Friday at 1",
      "Add this to Notion",
    ]) {
      const reply = await personaTurn(createMockClient(), state(), [], text);
      expect(reply.actions).toEqual([{ type: "app_task", goal: text }]);
    }
  });
});

describe("seeing the screen", () => {
  it("sends a typed turn with a screenshot to the seeing model, with the image attached", async () => {
    const calls: { role: string; content: unknown }[] = [];
    const client: ModelClient = {
      async complete(role, messages) {
        calls.push({ role, content: messages.at(-1)?.content });
        const reply = { reply: "That's your inbox.", actions: [] };
        return { text: JSON.stringify(reply), model: "fake", promptTokens: 0, completionTokens: 0 };
      },
    };
    await personaTurn(client, state(), [], "What's on my screen?", {
      scene: null,
      image: "data:image/jpeg;base64,AAAA",
    });
    await personaTurn(client, state(), [], "Hello");
    expect(calls[0].role).toBe("listen");
    expect(calls[0].content).toEqual(
      expect.arrayContaining([
        { type: "image_url", image_url: { url: "data:image/jpeg;base64,AAAA" } },
      ]),
    );
    expect(calls[1].role).toBe("draft");
  });
});

describe("pointing at the screen", () => {
  const scene = sceneSchema.parse({
    screen: { w: 1440, h: 900 },
    app: "Mail",
    items: [
      { role: "button", label: "Reply", x: 100, y: 80, w: 60, h: 24 },
      { role: "button", label: "Archive", x: 170, y: 80, w: 70, h: 24 },
    ],
  });

  it("sends the list of what's on screen, and points at an entry", async () => {
    const reply = await personaTurn(createMockClient(), state(), [], "Where's the reply button?", {
      scene,
      image: null,
    });
    expect(reply.actions).toEqual([{ type: "point", item: "e1", thing: null }]);
  });

  it("drops points at entries that don't exist, and visual things without a picture", () => {
    const reply = {
      reply: "There.",
      actions: [
        { type: "point" as const, item: "e9", thing: null },
        { type: "point" as const, item: null, thing: "red icon" },
        { type: "look_closer" as const },
      ],
    };
    expect(tidyReply(reply, state(), { scene, image: null }).actions).toEqual([
      { type: "look_closer" },
    ]);
    expect(tidyReply(reply, state(), { scene, image: "data:," }).actions).toEqual([
      { type: "point", item: null, thing: "red icon" },
    ]);
  });
});
