import { describe, expect, it } from "vitest";
import { sceneSchema } from "./scene";
import { TRAIL_LENGTH, extendTrail, sceneDigest, trailLine } from "./work";

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
