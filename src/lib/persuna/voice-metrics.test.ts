import { afterEach, describe, expect, it, vi } from "vitest";
import { db } from "@/db/client";
import { logVoiceTurn, REPORT_RETRY_MS, reportFirstAudio, startTurn } from "./voice-metrics";

vi.mock("@/db/client", () => ({
  db: vi.fn(),
  schema: { voiceTurns: { userId: "user_id", clientTurn: "client_turn", firstAudioMs: "first" } },
}));

/** A database whose update finds nothing `misses` times, then one row. */
function rowsAfter(misses: number) {
  const returning = vi.fn(async () => (returning.mock.calls.length > misses ? [{ id: "v1" }] : []));
  const update = () => ({ set: () => ({ where: () => ({ returning }) }) });
  vi.mocked(db).mockReturnValue({ update } as never);
  return returning;
}

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

describe("reportFirstAudio", () => {
  it("refuses a nonsense report without touching the database", async () => {
    await expect(reportFirstAudio("user-1", "", 1200)).resolves.toBe(false);
    await expect(reportFirstAudio("user-1", "t1", Number.NaN)).resolves.toBe(false);
    await expect(reportFirstAudio("user-1", "t1", -5)).resolves.toBe(false);
    await expect(reportFirstAudio("user-1", "t1", 11 * 60_000)).resolves.toBe(false);
  });

  it("joins at once when the turn's row is already there", async () => {
    const lookups = rowsAfter(0);
    await expect(reportFirstAudio("user-1", "t1", 1200)).resolves.toBe(true);
    expect(lookups).toHaveBeenCalledTimes(1);
  });

  it("waits for a row that is saved after the report arrives", async () => {
    vi.useFakeTimers();
    const lookups = rowsAfter(3);
    const report = reportFirstAudio("user-1", "t1", 1200);
    await vi.runAllTimersAsync();
    await expect(report).resolves.toBe(true);
    expect(lookups).toHaveBeenCalledTimes(4);
    vi.useRealTimers();
  });

  it("gives up on a stray report once the wait is over", async () => {
    vi.useFakeTimers();
    const lookups = rowsAfter(Infinity);
    const report = reportFirstAudio("user-1", "stray", 1200);
    await vi.runAllTimersAsync();
    await expect(report).resolves.toBe(false);
    expect(lookups).toHaveBeenCalledTimes(REPORT_RETRY_MS.length + 1);
    vi.useRealTimers();
  });
});
