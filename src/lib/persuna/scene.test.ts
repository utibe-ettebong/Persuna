import { describe, expect, it } from "vitest";
import {
  entryAt,
  parseSamBox,
  samSpot,
  sceneEntries,
  sceneForModel,
  sceneIsThin,
  sceneSchema,
  spotOf,
  wantsPicture,
} from "./scene";

const scene = sceneSchema.parse({
  screen: { w: 1440, h: 900 },
  app: "Mail",
  window: "Inbox",
  items: [
    { role: "button", label: "Reply", x: 100, y: 80, w: 60, h: 24 },
    { role: "button", label: "Archive", x: 170, y: 80, w: 70, h: 24 },
    { role: "button", label: "Off screen", x: 2000, y: 80, w: 70, h: 24 },
    { role: "field", label: "Search", x: 1200, y: 20, w: 200, h: 24 },
  ],
  text: [
    { text: "Reply", x: 104, y: 84, w: 40, h: 16 },
    { text: "Invoice #4821 is overdue", x: 300, y: 200, w: 300, h: 30 },
  ],
});

describe("the screen as a list", () => {
  it("numbers what's visible, and leaves out text the elements already say", () => {
    const entries = sceneEntries(scene);
    expect(entries.map((e) => `${e.id} ${e.label}`)).toEqual([
      "e1 Reply",
      "e2 Archive",
      "e3 Search",
      "t1 Invoice #4821 is overdue",
    ]);
  });

  it("describes places in words for the model", () => {
    const text = sceneForModel(scene);
    expect(text).toContain("App: Mail");
    expect(text).toContain('e1 button "Reply" (top left)');
    expect(text).toContain('e3 field "Search" (top right)');
  });

  it("finds the place of what the model points at", () => {
    expect(spotOf(scene, "e1")).toEqual({ x: 100, y: 80, w: 60, h: 24, label: "Reply" });
    expect(spotOf(scene, "t1")?.label).toBe("Invoice #4821 is overdue");
    expect(spotOf(scene, "e99")).toBeNull();
  });

  it("knows when the list is too thin and the picture is needed", () => {
    expect(sceneIsThin(scene)).toBe(true);
    const busy = sceneSchema.parse({
      screen: { w: 1440, h: 900 },
      text: Array.from({ length: 12 }, (_, i) => ({
        text: `Line ${i} of an email with several words in it`,
        x: 10,
        y: 10 + i * 30,
        w: 400,
        h: 20,
      })),
    });
    expect(sceneIsThin(busy)).toBe(false);
    expect(wantsPicture("What colour is this logo?")).toBe(true);
    expect(wantsPicture("Reply to this email")).toBe(false);
  });
});

describe("sceneForModel's cap", () => {
  const box = (i: number) => ({
    x: 10 + (i % 10) * 100,
    y: 10 + Math.floor(i / 10) * 30,
    w: 60,
    h: 20,
  });

  it("leaves an under-cap screen unchanged", () => {
    const text = sceneForModel(scene);
    const lines = text.split("\n");
    expect(lines).toHaveLength(6);
    expect(lines[0]).toBe("App: Mail");
    expect(lines[1]).toBe("Window: Inbox");
    expect(lines.slice(2).map((l) => l.split(" ")[0])).toEqual(["e1", "e2", "e3", "t1"]);
    expect(text).not.toContain("more things on screen");
  });

  it("keeps interactive things first when trimming, in their original order", () => {
    const busy = sceneSchema.parse({
      screen: { w: 1440, h: 900 },
      app: "Settings",
      window: "Export",
      items: [
        ...Array.from({ length: 30 }, (_, i) => ({
          role: "row",
          label: `Row ${i + 1}`,
          ...box(i),
        })),
        { role: "button", label: "Alpha", ...box(30) },
        { role: "link", label: "Beta", ...box(31) },
        { role: "checkbox", label: "Gamma", ...box(32) },
      ],
      text: Array.from({ length: 10 }, (_, i) => ({ text: `Text ${i + 1}`, ...box(40 + i) })),
    });
    const lines = sceneForModel(busy).split("\n");
    expect(lines).toHaveLength(40);
    expect(lines[0]).toBe("App: Settings");
    expect(lines[1]).toBe("Window: Export");
    // Interactive entries were last on screen, but come first for the model.
    expect(lines[2]).toContain('e31 button "Alpha"');
    expect(lines[3]).toContain('e32 link "Beta"');
    expect(lines[4]).toContain('e33 checkbox "Gamma"');
    expect(lines[5]).toContain('e1 row "Row 1"');
    expect(lines.at(-2)).toContain("text");
    expect(lines.at(-1)).toBe("…and 6 more things on screen (ask to look closer for the rest)");
  });

  it("counts the trimmed entries in the 'more things' line and keeps the head", () => {
    const busy = sceneSchema.parse({
      screen: { w: 1440, h: 900 },
      app: "Mail",
      selection: "hello world",
      items: Array.from({ length: 50 }, (_, i) => ({
        role: "row",
        label: `Item ${i + 1}`,
        ...box(i),
      })),
    });
    const lines = sceneForModel(busy).split("\n");
    expect(lines).toHaveLength(40);
    expect(lines[0]).toBe("App: Mail");
    expect(lines[1]).toBe('Selected text: "hello world"');
    // 40 lines total − 2 head − 1 "more" line = 37 entries kept, 13 trimmed.
    expect(lines.at(-1)).toBe("…and 13 more things on screen (ask to look closer for the rest)");
  });
});

describe("SAM 3.1 boxes", () => {
  it("reads the box and scales it to the screen", () => {
    const box = parseSamBox("<0f>0<|box;x1=80;y1=400;x2=240;y2=450;w=1280;h=800|><|mask;x=0|>");
    expect(box).toEqual({ x1: 80, y1: 400, x2: 240, y2: 450, w: 1280, h: 800 });
    expect(samSpot(box!, scene, "Reply")).toEqual({ x: 90, y: 450, w: 180, h: 56, label: "Reply" });
    expect(parseSamBox("")).toBeNull();
    expect(parseSamBox("<|box;x1=5;y1=5;x2=1;y2=9;w=10;h=10|>")).toBeNull();
  });
});

describe("entryAt", () => {
  const scene = sceneSchema.parse({
    screen: { w: 1440, h: 900 },
    items: [
      { role: "row", label: "Inbox row", x: 0, y: 100, w: 800, h: 40 },
      { role: "button", label: "Reply", x: 700, y: 105, w: 60, h: 30 },
    ],
  });

  it("finds the smallest thing under the pointer, or the nearest close by", () => {
    expect(entryAt(scene, { x: 720, y: 120 })?.label).toBe("Reply");
    expect(entryAt(scene, { x: 100, y: 120 })?.label).toBe("Inbox row");
    expect(entryAt(scene, { x: 100, y: 160 })?.label).toBe("Inbox row");
    expect(entryAt(scene, { x: 100, y: 600 })).toBeNull();
  });
});
