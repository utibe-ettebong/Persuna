import { afterEach, describe, expect, it } from "vitest";
import {
  CLOUD_CHUNK_CHARS,
  createSpeechQueue,
  parseStreamEvent,
  speakable,
  speechChunks,
  stopSpeaking,
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
