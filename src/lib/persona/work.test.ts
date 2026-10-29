import { describe, expect, it } from "vitest";
import { sceneSchema } from "./scene";
import { TRAIL_LENGTH, extendTrail, mayInterrupt, sceneDigest, trailLine } from "./work";

const scene = (over: Partial<Parameters<typeof sceneSchema.parse>[0]> = {}) =>
  sceneSchema.parse({
    screen: { w: 1440, h: 900 },
    app: "Safari",
    window: "Docs",
    items: [{ role: "search", label: "export pdf", x: 10, y: 10, w: 200, h: 30 }],
    ...over,
  });

describe("Work mode pacing", () => {
  it("sees a change when the window or selection changes, not otherwise", () => {
    expect(sceneDigest(scene())).toBe(sceneDigest(scene()));
    expect(sceneDigest(scene({ window: "Other" }))).not.toBe(sceneDigest(scene()));
    expect(sceneDigest(scene({ selection: "hi" }))).not.toBe(sceneDigest(scene()));
  });

  it("notes what's being searched for in the trail", () => {
    expect(trailLine(scene())).toBe('Safari — Docs — searching "export pdf"');
    expect(trailLine(scene({ items: [] }))).toBe("Safari — Docs");
  });

  it("keeps the trail short and skips repeats", () => {
    let trail: string[] = [];
    for (let i = 0; i < 10; i++) trail = extendTrail(trail, `step ${i}`);
    expect(trail).toHaveLength(TRAIL_LENGTH);
    expect(extendTrail(trail, trail.at(-1)!)).toBe(trail);
  });
});

describe("when Work mode may speak up", () => {
  it("waits a minute after speaking, and a little after you talked to it", () => {
    const now = 1_000_000;
    expect(mayInterrupt(now, 0, 0)).toBe(true);
    expect(mayInterrupt(now, now - 30_000, 0)).toBe(false);
    expect(mayInterrupt(now, 0, now - 10_000)).toBe(false);
    expect(mayInterrupt(now, now - 61_000, now - 21_000)).toBe(true);
  });
});
