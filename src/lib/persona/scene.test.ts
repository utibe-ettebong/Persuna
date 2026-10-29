import { describe, expect, it } from "vitest";
import {
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

describe("SAM 3.1 boxes", () => {
  it("reads the box and scales it to the screen", () => {
    const box = parseSamBox("<0f>0<|box;x1=80;y1=400;x2=240;y2=450;w=1280;h=800|><|mask;x=0|>");
    expect(box).toEqual({ x1: 80, y1: 400, x2: 240, y2: 450, w: 1280, h: 800 });
    expect(samSpot(box!, scene, "Reply")).toEqual({ x: 90, y: 450, w: 180, h: 56, label: "Reply" });
    expect(parseSamBox("")).toBeNull();
    expect(parseSamBox("<|box;x1=5;y1=5;x2=1;y2=9;w=10;h=10|>")).toBeNull();
  });
});
