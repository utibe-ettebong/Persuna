import { describe, expect, it } from "vitest";
import {
  fitScale,
  flowRoom,
  loopOf,
  notePlacement,
  onScreenSpot,
  shotAreas,
  shotIn,
} from "./screen-drawing";

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

describe("explanation thumbnails", () => {
  const spot = (x: number) => ({ x, y: 100, w: 60, h: 24 });

  it("takes one thumbnail per mark, then the pointed thing, at most four", () => {
    const drawing = {
      marks: [
        { n: 1, note: "First", spot: spot(100) },
        { n: 2, note: "Second", spot: spot(300) },
      ],
    };
    expect(shotAreas(drawing, null)).toEqual([
      { n: 1, note: "First", area: spot(100) },
      { n: 2, note: "Second", area: spot(300) },
    ]);
    expect(shotAreas(null, { ...spot(500), label: "Save" })).toEqual([
      { n: 1, note: "Save", area: spot(500) },
    ]);
    const many = {
      marks: [100, 200, 300, 400, 500].map((x, i) => ({ n: i + 1, note: `N${i}`, spot: spot(x) })),
    };
    expect(shotAreas(many, { ...spot(900), label: "Save" })).toHaveLength(4);
    expect(shotAreas({ marks: [] }, null)).toEqual([]);
  });
});

describe("shotIn", () => {
  const mark = { x: 500, y: 300, w: 80, h: 40 };

  it("takes the area as it is from a whole-screen picture", () => {
    expect(shotIn(mark, 1440, null)).toEqual({ area: mark, width: 1440 });
  });

  it("measures from the circle when the picture is cropped to it", () => {
    const crop = { x: 400, y: 200, w: 300, h: 200 };
    expect(shotIn(mark, 1440, crop)).toEqual({
      area: { x: 100, y: 100, w: 80, h: 40 },
      width: 300,
    });
  });

  it("has no picture of an area outside the circle", () => {
    expect(shotIn(mark, 1440, { x: 0, y: 0, w: 200, h: 200 })).toBeNull();
  });
});

describe("on-screen diagram size", () => {
  const screen = { w: 1440, h: 900 };

  it("grows a small diagram to fill most of the screen, but not without limit", () => {
    // Five boxes down: about 204 by 468 at natural size.
    const room = flowRoom(screen, false);
    const k = fitScale({ width: 204, height: 468 }, room);
    expect(k).toBeGreaterThan(1.2);
    expect(468 * k).toBeLessThanOrEqual(room.h);
    expect(fitScale({ width: 50, height: 50 }, room)).toBe(2.4);
  });

  it("shrinks a big diagram to fit, and keeps beside marks to a smaller space", () => {
    expect(fitScale({ width: 3000, height: 400 }, flowRoom(screen, false))).toBeLessThan(1);
    expect(flowRoom(screen, true).w).toBeLessThan(flowRoom(screen, false).w);
  });
});
