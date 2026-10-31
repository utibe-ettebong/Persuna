import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  CLOUD_CHUNK_CHARS,
  EARLY_SILENCE_MS,
  createSpeechQueue,
  parseStreamEvent,
  readTurnStream,
  speakable,
  speakOverSocket,
  speechChunks,
  stopSpeaking,
  utteranceComplete,
} from "./voice";

afterEach(() => stopSpeaking());

describe("speakable", () => {
  it("keeps every sentence, without markdown, links or emoji", () => {
    expect(
      speakable(
        "Here's **your** wrap-up 🎉.\n\n• chase the venue quote\nSee https://x.org now! Done?",
      ),
    ).toEqual(["Here's your wrap-up .", "chase the venue quote See now!", "Done?"]);
  });
});

describe("speechChunks", () => {
  it("says a normal reply in one piece, so there are no gaps", () => {
    expect(speechChunks(["One.", "Two.", "Three."])).toEqual(["One. Two. Three."]);
  });

  it("splits only very long replies, at sentence ends, losing nothing", () => {
    const sentences = Array.from(
      { length: 60 },
      (_, i) => `This is sentence number ${i + 1} of a very long reply.`,
    );
    const chunks = speechChunks(sentences);
    expect(chunks.length).toBeGreaterThan(1);
    expect(chunks.every((c) => c.length <= CLOUD_CHUNK_CHARS)).toBe(true);
    expect(chunks.join(" ")).toBe(sentences.join(" "));
  });
});

describe("createSpeechQueue", () => {
  const script = () => {
    const fetched: string[] = [];
    const played: string[] = [];
    const browser: string[][] = [];
    const spoken: string[] = [];
    let failFetch = false;
    let failPlay = false;
    let hold: { promise: Promise<void>; release: () => void } | null = null;
    const fakeRes = (text: string) =>
      ({ url: text, body: { cancel: async () => {} } }) as unknown as Response;
    const deps = {
      fetchSpeech: async (text: string) => {
        fetched.push(text);
        return failFetch ? null : fakeRes(text);
      },
      playSpeech: async (res: Response) => {
        played.push((res as unknown as { url: string }).url);
        if (hold) await hold.promise;
        return !failPlay;
      },
      speakBrowser: async (sentences: string[]) => {
        browser.push(sentences);
      },
    };
    const handlers = { onLevel: () => {}, onSpoken: (text: string) => spoken.push(text) };
    return {
      fetched,
      played,
      browser,
      spoken,
      deps,
      handlers,
      fail: (which: "fetch" | "play") =>
        which === "fetch" ? (failFetch = true) : (failPlay = true),
      holdPlay: () => {
        let release!: () => void;
        const promise = new Promise<void>((r) => (release = r));
        hold = { promise, release };
      },
      release: () => hold?.release(),
    };
  };

  it("speaks pushed sentences in order, then resolves", async () => {
    const t = script();
    const queue = createSpeechQueue(t.handlers, t.deps);
    queue.push("One.");
    queue.push("Two.");
    await queue.finish();

    expect(t.fetched).toEqual(["One.", "Two."]);
    expect(t.played).toEqual(["One.", "Two."]);
    expect(t.spoken).toEqual(["One.", "Two."]);
    expect(t.browser).toEqual([]);
  });

  it("speaks sentences that arrive while it waits", async () => {
    const t = script();
    const queue = createSpeechQueue(t.handlers, t.deps);
    queue.push("Late.");
    await new Promise((r) => setTimeout(r, 0));
    queue.push("Again.");
    await queue.finish();

    expect(t.played).toEqual(["Late.", "Again."]);
  });

  it("fetches the next sentence while the current one plays", async () => {
    const t = script();
    t.holdPlay();
    const queue = createSpeechQueue(t.handlers, t.deps);
    queue.push("One.");
    queue.push("Two.");
    const finished = queue.finish();
    for (let i = 0; i < 100 && t.fetched.length < 2; i++) {
      await new Promise((r) => setTimeout(r, 0));
    }
    // Still playing "One.", but "Two." is already fetched.
    expect(t.fetched).toEqual(["One.", "Two."]);
    expect(t.played).toEqual(["One."]);
    t.release();
    await finished;
    expect(t.played).toEqual(["One.", "Two."]);
  });

  it("says the rest in the browser's voice when the cloud fails", async () => {
    const t = script();
    t.fail("fetch");
    const queue = createSpeechQueue(t.handlers, t.deps);
    queue.push("One.");
    queue.push("Two.");
    await queue.finish();

    expect(t.played).toEqual([]);
    expect(t.browser).toEqual([["One."], ["Two."]]);
  });

  it("says the current sentence onwards in the browser's voice when playback fails", async () => {
    const t = script();
    t.fail("play");
    const queue = createSpeechQueue(t.handlers, t.deps);
    queue.push("One.");
    queue.push("Two.");
    await queue.finish();

    expect(t.played).toEqual(["One."]);
    expect(t.browser).toEqual([["One.", "Two."]]);
  });

  it("resolves instead of hanging when stopped mid-wait", async () => {
    const t = script();
    const queue = createSpeechQueue(t.handlers, t.deps);
    const finished = queue.finish();
    queue.push("One.");
    stopSpeaking();
    await finished;

    expect(t.played.length).toBeLessThanOrEqual(1);
  });
});

describe("parseStreamEvent", () => {
  // Framed exactly as the chat-stream route sends them.
  const frame = (event: string, data: unknown) => `event: ${event}\ndata: ${JSON.stringify(data)}`;

  it("reads heard, sentence, done and error events", () => {
    expect(parseStreamEvent(frame("heard", { text: "hi" }))).toEqual({
      name: "heard",
      text: "hi",
    });
    expect(parseStreamEvent(frame("sentence", { text: "Hello." }))).toEqual({
      name: "sentence",
      text: "Hello.",
    });
    expect(parseStreamEvent<{ ok: boolean }>(frame("done", { ok: true }))).toEqual({
      name: "done",
      result: { ok: true },
    });
    expect(parseStreamEvent(frame("error", { message: "nope" }))).toEqual({
      name: "error",
      message: "nope",
    });
  });

  it("reads a request to look closer", () => {
    expect(
      parseStreamEvent(frame("look-closer", { heard: "What's this?", said: "Let me look." })),
    ).toEqual({ name: "look-closer", heard: "What's this?", said: "Let me look." });
  });

  it("ignores anything else", () => {
    expect(parseStreamEvent(": keep-alive")).toBeNull();
    expect(parseStreamEvent(frame("sentence", { text: 42 }))).toBeNull();
    expect(parseStreamEvent("event: sentence\ndata: {oops")).toBeNull();
    expect(parseStreamEvent(frame("error", {}))).toEqual({
      name: "error",
      message: "Something went wrong.",
    });
  });
});

describe("readTurnStream", () => {
  const frames = (...parts: [string, unknown][]) =>
    new Blob(parts.map(([e, d]) => `event: ${e}\ndata: ${JSON.stringify(d)}\n\n`)).stream();

  it("reports words as they come and ends with the saved result", async () => {
    const said: string[] = [];
    const outcome = await readTurnStream<{ ok: boolean }>(
      frames(["heard", { text: "hi" }], ["sentence", { text: "Hello." }], ["done", { ok: true }]),
      { heard: (t) => said.push(`heard:${t}`), sentence: (t) => said.push(t) },
    );
    expect(said).toEqual(["heard:hi", "Hello."]);
    expect(outcome).toEqual({ result: { ok: true }, failed: null, closer: null });
  });

  it("hands back a request for the picture", async () => {
    const outcome = await readTurnStream(
      frames(
        ["sentence", { text: "Let me look." }],
        ["look-closer", { heard: "Hm?", said: "Let me look." }],
      ),
      { heard: () => {}, sentence: () => {} },
    );
    expect(outcome.closer).toEqual({ heard: "Hm?", said: "Let me look." });
    expect(outcome.result).toBeNull();
  });
});

describe("speakOverSocket", () => {
  const socket = () => {
    const sent: string[] = [];
    const fake = {
      sent,
      closed: false,
      onmessage: null as ((e: MessageEvent) => void) | null,
      onclose: null as (() => void) | null,
      send: (data: string) => void sent.push(data),
      close() {
        fake.closed = true;
      },
      say: (message: unknown) =>
        fake.onmessage?.({ data: JSON.stringify(message) } as MessageEvent),
    };
    return fake;
  };

  beforeEach(() => {
    vi.useFakeTimers();
    vi.stubGlobal("window", globalThis);
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("streams the audio as a Response like the server route's", async () => {
    const fake = socket();
    const pending = speakOverSocket(fake as never, "Hello.");
    expect(fake.sent.map((s) => JSON.parse(s).text)).toEqual(["Hello. ", ""]);
    fake.say({ audio: btoa("one") });
    const res = await pending;
    fake.say({ audio: btoa("two") });
    fake.say({ isFinal: true });

    expect(res?.headers.get("content-type")).toBe("audio/mpeg");
    expect(await res?.text()).toBe("onetwo");
    expect(fake.closed).toBe(true);
  });

  it("gives way to the server route when no audio comes", async () => {
    const fake = socket();
    const pending = speakOverSocket(fake as never, "Hello.", 100);
    await vi.advanceTimersByTimeAsync(100);
    expect(await pending).toBeNull();
    expect(fake.closed).toBe(true);
  });

  it("gives way if the connection drops before any audio", async () => {
    const fake = socket();
    const pending = speakOverSocket(fake as never, "Hello.");
    fake.onclose?.();
    expect(await pending).toBeNull();
  });

  it("stops cleanly when playback is cancelled", async () => {
    const fake = socket();
    const pending = speakOverSocket(fake as never, "Hello.");
    fake.say({ audio: btoa("one") });
    const res = await pending;
    await res?.body?.cancel();
    expect(fake.closed).toBe(true);
    expect(() => fake.onclose?.()).not.toThrow();
  });

  it("ends the speech where it got to if the connection drops midway", async () => {
    const fake = socket();
    const pending = speakOverSocket(fake as never, "Hello.");
    fake.say({ audio: btoa("one") });
    const res = await pending;
    fake.onclose?.();
    expect(await res?.text()).toBe("one");
  });
});

describe("utteranceComplete", () => {
  it("hears a finished sentence, past closing quotes", () => {
    expect(utteranceComplete("Remind me at five.")).toBe(true);
    expect(utteranceComplete("What time is it?")).toBe(true);
    expect(utteranceComplete("Stop!")).toBe(true);
    expect(utteranceComplete('She said "go."')).toBe(true);
    expect(utteranceComplete("Well…")).toBe(true);
  });

  it("assumes nothing without terminal punctuation", () => {
    expect(utteranceComplete("")).toBe(false);
    expect(utteranceComplete("Remind me at")).toBe(false);
    expect(utteranceComplete("Remind me, uh")).toBe(false);
    expect(utteranceComplete("call me at 3.5")).toBe(false);
    expect(utteranceComplete(".")).toBe(false);
  });

  it("ends finished sentences well before the full hush", () => {
    expect(EARLY_SILENCE_MS).toBeLessThan(1000);
  });
});
