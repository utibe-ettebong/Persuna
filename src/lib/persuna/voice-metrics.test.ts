import { afterEach, describe, expect, it, vi } from "vitest";
import { logVoiceTurn, startTurn } from "./voice-metrics";

const clock = () => {
  let t = 1000;
  return { now: () => t, advance: (ms: number) => (t += ms) };
};

afterEach(() => vi.restoreAllMocks());

describe("startTurn", () => {
  it("reports each stage in milliseconds from the start", () => {
    const time = clock();
    const timer = startTurn(time.now);
    time.advance(120);
    timer.mark("heard");
    time.advance(300);
    timer.mark("first-token");
    time.advance(200);
    timer.mark("first-sentence");
    time.advance(400);
    timer.mark("first-audio");
    time.advance(1500);
    timer.mark("end");

    expect(timer.summary()).toEqual({
      turnMs: 2520,
      heardMs: 120,
      firstTokenMs: 420,
      firstSentenceMs: 620,
      firstAudioMs: 1020,
      malformedTail: false,
    });
  });

  it("keeps the first mark and leaves unmarked stages null", () => {
    const time = clock();
    const timer = startTurn(time.now);
    time.advance(50);
    timer.mark("heard");
    time.advance(50);
    timer.mark("heard");

    expect(timer.summary()).toEqual({
      turnMs: null,
      heardMs: 50,
      firstTokenMs: null,
      firstSentenceMs: null,
      firstAudioMs: null,
      malformedTail: false,
    });
  });

  it("flags malformed tails", () => {
    const timer = startTurn(clock().now);
    timer.flagMalformedTail();
    expect(timer.summary().malformedTail).toBe(true);
  });
});

describe("logVoiceTurn", () => {
  it("logs one JSON line with the route and summary", () => {
    const spy = vi.spyOn(console, "log").mockImplementation(() => {});
    const time = clock();
    const timer = startTurn(time.now);
    time.advance(800);
    timer.mark("end");

    logVoiceTurn("/api/persuna/llm", timer, { spoken: true, picture: false });

    expect(spy).toHaveBeenCalledTimes(1);
    expect(JSON.parse(spy.mock.calls[0][0])).toEqual({
      scope: "voice-turn",
      route: "/api/persuna/llm",
      turnMs: 800,
      heardMs: null,
      firstTokenMs: null,
      firstSentenceMs: null,
      firstAudioMs: null,
      malformedTail: false,
      spoken: true,
      picture: false,
    });
  });
});
