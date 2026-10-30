import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { hearingSession, pcmBase64 } from "./live-hearing";

const OPEN = 1;
const CONNECTING = 0;

const socket = (readyState = OPEN) => {
  const fake = {
    readyState,
    sent: [] as { audio_base_64: string; commit: boolean }[],
    closed: false,
    onopen: null as (() => void) | null,
    onmessage: null as ((e: MessageEvent) => void) | null,
    onclose: null as (() => void) | null,
    send: (data: string) => void fake.sent.push(JSON.parse(data)),
    close() {
      fake.closed = true;
    },
    say: (message: unknown) => fake.onmessage?.({ data: JSON.stringify(message) } as MessageEvent),
  };
  return fake;
};

beforeEach(() => {
  vi.useFakeTimers();
  vi.stubGlobal("window", globalThis);
  vi.stubGlobal("WebSocket", { OPEN });
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("pcmBase64", () => {
  it("packs samples as 16-bit little-endian, clipping anything too loud", () => {
    const bytes = atob(pcmBase64(new Float32Array([0, 1, -1, 2])));
    const view = new DataView(Uint8Array.from(bytes, (c) => c.charCodeAt(0)).buffer);
    expect([0, 2, 4, 6].map((at) => view.getInt16(at, true))).toEqual([0, 32767, -32768, 32767]);
  });
});

describe("hearingSession", () => {
  it("streams audio, reports words as they come, and ends on the final text", async () => {
    const fake = socket();
    const heard: string[] = [];
    const session = hearingSession(fake as never, (w) => heard.push(w));
    session.audio("a1");
    fake.say({ message_type: "partial_transcript", text: "what is" });
    const words = session.finish();

    expect(fake.sent.map((s) => [s.audio_base_64, s.commit])).toEqual([
      ["a1", false],
      ["", true],
    ]);
    fake.say({ message_type: "committed_transcript", text: " what is next? " });
    expect(await words).toBe("what is next?");
    expect(heard).toEqual(["what is"]);
    expect(fake.closed).toBe(true);
  });

  it("keeps what you said while the connection opens, even if you finish first", async () => {
    const fake = socket(CONNECTING);
    const session = hearingSession(fake as never, () => {});
    session.audio("a1");
    session.audio("a2");
    const words = session.finish();
    expect(fake.sent).toEqual([]);

    fake.readyState = OPEN;
    fake.onopen?.();
    expect(fake.sent.map((s) => [s.audio_base_64, s.commit])).toEqual([
      ["a1", false],
      ["a2", false],
      ["", true],
    ]);
    fake.say({ message_type: "committed_transcript_with_timestamps", text: "Hello." });
    expect(await words).toBe("Hello.");
  });

  it("leaves it to the recording when no words come in time", async () => {
    const fake = socket();
    const words = hearingSession(fake as never, () => {}, 100).finish();
    await vi.advanceTimersByTimeAsync(100);
    expect(await words).toBeNull();
    expect(fake.closed).toBe(true);
  });

  it("leaves it to the recording on an error, a dropped connection or empty text", async () => {
    for (const fail of [
      (f: ReturnType<typeof socket>) => f.say({ message_type: "auth_error" }),
      (f: ReturnType<typeof socket>) => f.onclose?.(),
      (f: ReturnType<typeof socket>) => f.say({ message_type: "committed_transcript", text: " " }),
    ]) {
      const fake = socket();
      const words = hearingSession(fake as never, () => {}).finish();
      fail(fake);
      expect(await words).toBeNull();
    }
  });

  it("is finished once the connection has gone", async () => {
    const fake = socket();
    const session = hearingSession(fake as never, () => {});
    fake.onclose?.();
    expect(await session.finish()).toBeNull();
    session.audio("late");
    expect(fake.sent).toEqual([]);
  });
});
