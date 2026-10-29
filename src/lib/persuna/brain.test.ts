import { describe, expect, it } from "vitest";
import type { ModelClient } from "@/lib/models/gateway";
import { sceneSchema } from "./scene";
import { createMockClient } from "@/lib/models/mock";
import { TURN_TIMEOUT_MS, persunaObserve, persunaTurn, persunaWorkLook, tidyReply } from "./brain";
import type { PersunaState } from "./types";

const state = (over: Partial<PersunaState> = {}): PersunaState => ({
  today: "2026-10-27",
  now: "2026-10-27T10:15",
  name: "Persuna",
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

describe("persunaTurn with the offline mock", () => {
  const client = createMockClient();

  it("knows about the user's company onboarding", async () => {
    const onboarding = {
      org: "Acme",
      role: "Designer",
      next: "Module 2: Design review",
      done: 1,
      total: 3,
    };
    const reply = await persunaTurn(
      client,
      state({ onboarding }),
      [],
      "What's next in my onboarding?",
    );
    expect(reply.reply).toBe(
      "You're onboarding as Designer at Acme; next: Module 2: Design review.",
    );
  });

  it("sets today's focus and matches it to a skill", async () => {
    const reply = await persunaTurn(client, state(), [], "I'm working on the meeting minutes");
    expect(reply.actions).toEqual([
      { type: "set_focus", focus: "the meeting minutes", skill: "meeting-minutes" },
    ]);
  });

  it("remembers and takes notes", async () => {
    const remember = await persunaTurn(client, state(), [], "Remember that I send minutes by 5pm");
    expect(remember.actions).toEqual([{ type: "remember", fact: "I send minutes by 5pm" }]);
    const note = await persunaTurn(client, state(), [], "Take a note: chase the venue quote");
    expect(note.actions[0]).toMatchObject({ type: "note", body: "chase the venue quote" });
  });

  it("interviews one question at a time and saves each answer", async () => {
    const first = await persunaTurn(client, training, [], "teach me");
    expect(first.asked).toBe("steps");
    const second = await persunaTurn(
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
    const reply = await persunaTurn(client, training, [], "I always put decisions in bold");
    expect(reply.actions).toEqual([{ type: "learn", method: "I always put decisions in bold" }]);
  });
});

describe("persunaTurn assistant actions with the offline mock", () => {
  const client = createMockClient();

  it("sets a reminder at a local time, or a to-do without one", async () => {
    const timed = await persunaTurn(client, state(), [], "Remind me at 4pm to send the minutes");
    expect(timed.actions).toEqual([
      { type: "remind", text: "send the minutes", at: "2026-10-27T16:00" },
    ]);
    const todo = await persunaTurn(client, state(), [], "todo: book the room");
    expect(todo.actions).toEqual([{ type: "remind", text: "book the room", at: null }]);
  });

  it("asks to run a task with the matching skill", async () => {
    const reply = await persunaTurn(client, state(), [], "Turn these notes into meeting minutes");
    expect(reply.actions).toEqual([{ type: "run_task", skill: "meeting-minutes" }]);
  });

  it("coaches and wraps up", async () => {
    const coach = await persunaTurn(client, state(), [], "How is my meeting minutes skill doing?");
    expect(coach.actions).toEqual([{ type: "coach", skill: "meeting-minutes" }]);
    const wrap = await persunaTurn(client, state(), [], "Wrap up my day");
    expect(wrap.actions).toEqual([{ type: "wrap_up" }]);
    const watch = await persunaTurn(client, state(), [], "Watch my screen while I work");
    expect(watch.actions).toEqual([{ type: "watch_screen", on: true }]);
    const stop = await persunaTurn(client, state(), [], "Stop watching");
    expect(stop.actions).toEqual([{ type: "watch_screen", on: false }]);
  });
});

describe("open_page with the offline mock", () => {
  const client = createMockClient();
  it("takes the user to a page or one of their skills", async () => {
    expect((await persunaTurn(client, state(), [], "show me my jobs")).actions).toEqual([
      { type: "open_page", page: "jobs", skill: null },
    ]);
    expect((await persunaTurn(client, state(), [], "open the meeting minutes")).actions).toEqual([
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
    const reply = await persunaTurn(client, state(), [], "Please keep it short");
    expect(reply.actions).toEqual([{ type: "set_tone", length: "short" }]);
  });

  it("answers in the user's tone", async () => {
    const long = await persunaTurn(client, state(), [], "I'm working on the meeting minutes");
    const short = await persunaTurn(
      client,
      state({ tone: { length: "short" } }),
      [],
      "I'm working on the meeting minutes",
    );
    expect(long.reply.split(/[.!?]\s/).length).toBeGreaterThan(1);
    expect(short.reply).toBe("Got it: today is the meeting minutes.");
  });
});

describe("persunaObserve with the offline mock", () => {
  it("records one step per look and speaks only at the start", async () => {
    const client = createMockClient();
    const input = { name: "Persuna", focus: null, frame: "data:image/jpeg;base64,AAAA" };
    const first = await persunaObserve(client, { ...input, recentSteps: [] });
    expect(first.say).toBeTruthy();
    expect(first.step).toBeTruthy();
    const later = await persunaObserve(client, { ...input, recentSteps: [first.step!] });
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
    const reply = await persunaTurn(client, state(), [], "I want you to learn writing SEO briefs");
    expect(reply.actions[0]).toMatchObject({ type: "create_skill", name: "Writing SEO briefs" });
  });

  it("asks for an example, trains, tests and publishes on request", async () => {
    const said = async (t: string) =>
      (await persunaTurn(client, twoSkills, [], t)).actions[0]?.type;
    expect(await said("Here's an example")).toBe("add_example");
    expect(await said("Train yourself")).toBe("train_skill");
    expect(await said("Test yourself")).toBe("test_skill");
    expect(await said("Publish it")).toBe("publish_skill");
  });

  it("offers to switch when the work belongs to another skill, and switches on yes", async () => {
    const drift = await persunaTurn(
      client,
      twoSkills,
      [],
      "Can you draft the SEO briefs for the client?",
    );
    expect(drift.actions).toEqual([{ type: "suggest_switch", skill: "seo-briefs", task: null }]);
    const pending = { ...twoSkills, pendingSwitch: { slug: "seo-briefs", name: "SEO briefs" } };
    expect((await persunaTurn(client, pending, [], "yes")).actions).toEqual([
      { type: "set_focus", focus: "SEO briefs", skill: "seo-briefs" },
    ]);
    expect((await persunaTurn(client, pending, [], "no, stay")).actions).toEqual([]);
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
    const reply = await persunaTurn(client, state(), [], { audio: "UklGRg==" });
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
      const reply = await persunaTurn(createMockClient(), state(), [], text);
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
    await persunaTurn(client, state(), [], "What's on my screen?", {
      scene: null,
      image: "data:image/jpeg;base64,AAAA",
    });
    await persunaTurn(client, state(), [], "Hello");
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
    const reply = await persunaTurn(createMockClient(), state(), [], "Where's the reply button?", {
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

  it("points at an entry the model named instead of giving its id", () => {
    const reply = {
      reply: "There.",
      actions: [{ type: "point" as const, item: "Archive", thing: null }],
    };
    expect(tidyReply(reply, state(), { scene, image: null }).actions).toEqual([
      { type: "point", item: "e2", thing: null },
    ]);
  });

  it("takes the first exact name, and drops a part-name matching two things", () => {
    const two = sceneSchema.parse({
      screen: { w: 1440, h: 900 },
      app: "Mail",
      items: [
        { role: "button", label: "Save", x: 10, y: 10, w: 60, h: 24 },
        { role: "button", label: "Save draft", x: 100, y: 10, w: 60, h: 24 },
      ],
    });
    const exact = {
      reply: "There.",
      actions: [{ type: "point" as const, item: "Save", thing: null }],
    };
    expect(tidyReply(exact, state(), { scene: two, image: null }).actions).toEqual([
      { type: "point", item: "e1", thing: null },
    ]);
    const partial = { ...exact, actions: [{ type: "point" as const, item: "Sav", thing: null }] };
    expect(tidyReply(partial, state(), { scene: two, image: null }).actions).toEqual([]);
  });
});

describe("showing, and not hanging", () => {
  it("adds the Show me instruction and a short timeout for chat turns", async () => {
    const seen: { messages: unknown; options: unknown }[] = [];
    const client: ModelClient = {
      async complete(_role, messages, options) {
        seen.push({ messages, options });
        return {
          text: JSON.stringify({ reply: "OK.", actions: [] }),
          model: "fake",
          promptTokens: 0,
          completionTokens: 0,
        };
      },
    };
    await persunaTurn(client, state(), [], "Explain this", null, null, true);
    await persunaTurn(client, state(), [], "Hello");
    expect(JSON.stringify(seen[0].messages)).toContain("Show me");
    expect(JSON.stringify(seen[1].messages)).not.toContain("Show me");
    expect(seen[0].options).toMatchObject({ timeoutMs: TURN_TIMEOUT_MS });
    expect(TURN_TIMEOUT_MS).toBeLessThan(60_000);
  });
});

describe("drawing, files and the clipboard", () => {
  const scene = sceneSchema.parse({
    screen: { w: 1440, h: 900 },
    app: "Mail",
    selection: "ada@example.com",
    items: [
      { role: "button", label: "Reply", x: 100, y: 80, w: 60, h: 24 },
      { role: "search", label: "invoices", x: 300, y: 20, w: 200, h: 24 },
    ],
  });

  it("keeps notes only on things on screen, and drops a drawing left with nothing", () => {
    const draw = (marks: { item: string; note: string }[], flow = null) => ({
      reply: "Here.",
      actions: [{ type: "draw" as const, title: null, marks, flow }],
    });
    const kept = tidyReply(
      draw([
        { item: "e1", note: "1. Reply" },
        { item: "e9", note: "2. Gone" },
      ]),
      state(),
      {
        scene,
        image: null,
      },
    );
    expect(kept.actions).toEqual([
      { type: "draw", title: null, marks: [{ item: "e1", note: "1. Reply" }], flow: null },
    ]);
    expect(tidyReply(draw([{ item: "e9", note: "Gone" }]), state(), null).actions).toEqual([]);
  });

  it("keeps notes named by what they're called, not just by id", () => {
    const draw = (marks: { item: string; note: string }[]) => ({
      reply: "Here.",
      actions: [{ type: "draw" as const, title: null, marks, flow: null }],
    });
    const kept = tidyReply(
      draw([
        { item: "Reply", note: "1. Exact name" },
        { item: "invoic", note: "2. Part of a name" },
        { item: "Nothing", note: "3. Gone" },
      ]),
      state(),
      { scene, image: null },
    );
    expect(kept.actions).toEqual([
      {
        type: "draw",
        title: null,
        marks: [
          { item: "e1", note: "1. Exact name" },
          { item: "e2", note: "2. Part of a name" },
        ],
        flow: null,
      },
    ]);
  });

  it("drops empty files and diagrams without boxes", () => {
    const reply = {
      reply: "Made.",
      actions: [
        {
          type: "make_file" as const,
          kind: "document" as const,
          title: "Plan",
          body: " ",
          flow: null,
        },
        { type: "make_file" as const, kind: "flow" as const, title: "Flow", body: "", flow: null },
        {
          type: "make_file" as const,
          kind: "table" as const,
          title: "T",
          body: "a,b\n1,2",
          flow: null,
        },
      ],
    };
    expect(tidyReply(reply, state()).actions.map((a) => a.type === "make_file" && a.kind)).toEqual([
      "table",
    ]);
  });

  it("copies what's selected, and makes files and drawings, with the offline mock", async () => {
    const client = createMockClient();
    const copied = await persunaTurn(client, state(), [], "copy this", { scene, image: null });
    expect(copied.actions).toEqual([{ type: "clipboard", op: "copy", text: "ada@example.com" }]);
    const drawn = await persunaTurn(client, state(), [], "Draw how it works", {
      scene,
      image: null,
    });
    expect(drawn.actions[0]).toMatchObject({
      type: "draw",
      marks: [{ item: "e1" }, { item: "e2" }],
    });
    const doc = await persunaTurn(client, state(), [], "Make me a document for the plan");
    expect(doc.actions[0]).toMatchObject({ type: "make_file", kind: "document", title: "Plan" });
  });

  it("reads a file handed over with the message", async () => {
    const calls: string[] = [];
    const mock = createMockClient();
    const client: ModelClient = {
      ...mock,
      complete: async (role, messages, options) => {
        calls.push(JSON.stringify(messages));
        return mock.complete(role, messages, options);
      },
    };
    await persunaTurn(client, state(), [], "Summarise it", null, {
      name: "notes.txt",
      text: "Agenda: budget",
      image: null,
    });
    expect(calls[0]).toContain("<persuna_file>");
    expect(calls[0]).toContain("Agenda: budget");
  });
});

describe("Work mode", () => {
  const scene = sceneSchema.parse({
    screen: { w: 1440, h: 900 },
    app: "Safari",
    window: "Search",
    items: [{ role: "search", label: "export pdf", x: 300, y: 20, w: 200, h: 24 }],
  });
  const look = (mayInterrupt: boolean, trail = ["Safari — Search", "Safari — Results"]) =>
    persunaWorkLook(createMockClient(), {
      state: state(),
      scene,
      image: null,
      trail,
      recentSteps: [],
      mayInterrupt,
    });

  it("guides someone who keeps searching, pointing at the search box", async () => {
    expect(await look(true)).toMatchObject({ mode: "guide", point: "e1" });
  });

  it("only follows quietly right after speaking up", async () => {
    const quiet = await look(false);
    expect(quiet.mode).toBe("follow");
    expect(quiet.say).toBeNull();
    expect(quiet.step).toBeTruthy();
  });
});

describe("Work mode asking, explaining and matching skills", () => {
  const scene = sceneSchema.parse({
    screen: { w: 1440, h: 900 },
    app: "Figma",
    items: [{ role: "button", label: "Export", x: 10, y: 10, w: 80, h: 24 }],
  });
  const answering = (value: Record<string, unknown>): ModelClient => ({
    async complete() {
      return { text: JSON.stringify(value), model: "test", promptTokens: 0, completionTokens: 0 };
    },
  });
  const look = (value: Record<string, unknown>, mayInterrupt = true) =>
    persunaWorkLook(answering(value), {
      state: state({
        skills: [{ slug: "design-briefs", name: "Design briefs", published: false }],
      }),
      scene,
      image: null,
      trail: [],
      recentSteps: [],
      mayInterrupt,
    });

  it("keeps a question and an explanation, pointing only when explaining", async () => {
    const asked = await look({ mode: "ask", say: "Why export at 2x?", point: "e1", step: null });
    expect(asked).toMatchObject({ mode: "ask", say: "Why export at 2x?", point: null });
    const explained = await look({ mode: "explain", say: "That's the export menu.", point: "e1" });
    expect(explained).toMatchObject({ mode: "explain", point: "e1" });
  });

  it("names only skills they have", async () => {
    expect((await look({ mode: "follow", skill: "design-briefs", step: "x" })).skill).toBe(
      "design-briefs",
    );
    expect((await look({ mode: "follow", skill: "made-up", step: "x" })).skill).toBeNull();
  });

  it("stays quiet right after speaking up, but still learns", async () => {
    const quiet = await look({ mode: "ask", say: "Why?", step: "Exports at 2x" }, false);
    expect(quiet).toMatchObject({ mode: "follow", say: null, step: "Exports at 2x" });
  });
});

describe("Work mode's dot: the pointer, corrections and fit", () => {
  const scene = sceneSchema.parse({
    screen: { w: 1440, h: 900 },
    app: "Mail",
    items: [{ role: "button", label: "Send", x: 100, y: 100, w: 80, h: 30 }],
  });

  it("asks about what the pointer has rested on", async () => {
    const seen = await persunaWorkLook(createMockClient(), {
      state: state(),
      scene,
      image: null,
      trail: [],
      recentSteps: [],
      mayInterrupt: true,
      pointer: { x: 120, y: 110, still: 6 },
    });
    // The question shows beside the dot, at the pointer: no separate highlight.
    expect(seen).toMatchObject({ mode: "ask", fit: "unsure", point: null });
    expect(seen.say).toMatch(/Not sure about this one/);
  });

  it("keeps a correction's point and its fit", async () => {
    const client: ModelClient = {
      async complete() {
        return {
          text: JSON.stringify({
            mode: "correct",
            fit: "off",
            say: "You usually attach the report first.",
            point: "e1",
          }),
          model: "test",
          promptTokens: 0,
          completionTokens: 0,
        };
      },
    };
    const seen = await persunaWorkLook(client, {
      state: state(),
      scene,
      image: null,
      trail: [],
      recentSteps: [],
      mayInterrupt: true,
    });
    expect(seen).toMatchObject({ mode: "correct", fit: "off", point: "e1" });
  });
});
