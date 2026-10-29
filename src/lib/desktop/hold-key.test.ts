import { describe, expect, it } from "vitest";
// The desktop app's own module (CommonJS, shipped with Persuna Desktop).
import { createHoldKey, DOUBLE_TAP_MS, HOLD_MS } from "../../../desktop/hold-key.js";

const KEY = 3640;
const OTHER = 18;

/** A hold key with a manual clock: timers run when `advance` passes them. */
function setup() {
  const events: string[] = [];
  let now = 0;
  let timers: { at: number; fn: () => void; id: number }[] = [];
  let next = 1;
  const hk = createHoldKey({
    emit: (e: string) => events.push(e),
    schedule: (fn: () => void, ms: number) => {
      const id = next++;
      timers.push({ at: now + ms, fn, id });
      return id;
    },
    cancelTimer: (id: number) => {
      timers = timers.filter((t) => t.id !== id);
    },
  });
  hk.setKey(KEY);
  const advance = (ms: number) => {
    now += ms;
    const due = timers.filter((t) => t.at <= now);
    timers = timers.filter((t) => t.at > now);
    due.forEach((t) => t.fn());
  };
  return {
    events,
    down: (code = KEY) => hk.keydown(code, now),
    up: (code = KEY) => hk.keyup(code, now),
    advance,
    hk,
  };
}

describe("hold-to-talk key", () => {
  it("starts after a short hold and ends on release", () => {
    const k = setup();
    k.down();
    k.advance(HOLD_MS - 1);
    expect(k.events).toEqual([]);
    k.advance(1);
    k.down(); // key repeat changes nothing
    k.advance(2000);
    k.up();
    expect(k.events).toEqual(["start", "end"]);
  });

  it("ignores shortcuts that use the key", () => {
    const k = setup();
    k.down();
    k.down(OTHER);
    k.advance(500);
    k.up(OTHER);
    k.up();
    expect(k.events).toEqual([]);
  });

  it("cancels listening if another key is pressed mid-hold", () => {
    const k = setup();
    k.down();
    k.advance(400);
    k.down(OTHER);
    k.up();
    expect(k.events).toEqual(["start", "cancel"]);
  });

  it("opens typing on a quick double tap, not on two slow taps", () => {
    const k = setup();
    k.down();
    k.advance(60);
    k.up();
    k.advance(DOUBLE_TAP_MS - 100);
    k.down();
    k.advance(60);
    k.up();
    expect(k.events).toEqual(["type"]);

    const slow = setup();
    slow.down();
    slow.advance(60);
    slow.up();
    slow.advance(DOUBLE_TAP_MS + 50);
    slow.down();
    slow.advance(60);
    slow.up();
    expect(slow.events).toEqual([]);
  });

  it("does nothing when turned off", () => {
    const k = setup();
    k.hk.setKey(null);
    k.down();
    k.advance(1000);
    k.up();
    expect(k.events).toEqual([]);
  });
});
