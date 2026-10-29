import { describe, expect, it } from "vitest";
import { loopOf } from "./screen-drawing";

describe("circling something", () => {
  it("turns a drawn loop into a closed path and the box around it", () => {
    const pick = loopOf([
      { x: 100, y: 100 },
      { x: 180, y: 90 },
      { x: 200, y: 160 },
      { x: 110, y: 170 },
    ]);
    expect(pick?.area).toEqual({ x: 100, y: 90, w: 100, h: 80 });
    expect(pick?.path.startsWith("M100,100 L180,90")).toBe(true);
    expect(pick?.path.endsWith("Z")).toBe(true);
  });

  it("ignores a tap or a scribble too small to mean anything", () => {
    expect(loopOf([{ x: 1, y: 1 }])).toBeNull();
    expect(
      loopOf([
        { x: 1, y: 1 },
        { x: 5, y: 4 },
        { x: 3, y: 8 },
      ]),
    ).toBeNull();
  });
});
