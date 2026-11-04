import { describe, expect, it } from "vitest";
import { loopOf, notePlacement, onScreenSpot } from "./screen-drawing";

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

describe("note placement", () => {
  const screen = { w: 1440, h: 900 };

  it("sits left of the mark and above it, as before, mid-screen", () => {
    expect(notePlacement({ x: 100, y: 400, w: 100, h: 40 }, screen)).toEqual({
      side: "left",
      above: true,
    });
  });

  it("drops below a mark near the top", () => {
    expect(notePlacement({ x: 100, y: 20, w: 100, h: 20 }, screen)).toEqual({
      side: "left",
      above: false,
    });
  });

  it("hangs off the mark's right edge near the screen's right edge", () => {
    expect(notePlacement({ x: 1300, y: 400, w: 100, h: 40 }, screen)).toEqual({
      side: "right",
      above: true,
    });
  });

  it("drops below a mark just under the top when above would run off screen", () => {
    expect(notePlacement({ x: 100, y: 80, w: 100, h: 20 }, screen)).toEqual({
      side: "left",
      above: false,
    });
  });
});

describe("marks outside this view", () => {
  const screen = { w: 1440, h: 900 };

  it("keeps marks centred on screen, drops ones centred off it", () => {
    expect(onScreenSpot({ x: 100, y: 100, w: 60, h: 24 }, screen)).toBe(true);
    expect(onScreenSpot({ x: -500, y: 100, w: 60, h: 24 }, screen)).toBe(false);
    expect(onScreenSpot({ x: 2000, y: 100, w: 60, h: 24 }, screen)).toBe(false);
  });
});
