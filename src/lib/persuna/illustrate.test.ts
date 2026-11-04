import { describe, expect, it } from "vitest";
import { illustrationOf } from "./illustrate";
import type { Drawing } from "./service";
import type { Flow } from "./types";

const flow: Flow = {
  direction: "down",
  nodes: [{ id: "a", label: "Your notes" }],
  edges: [],
};

describe("illustrationOf", () => {
  it("shows a diagram with no marks in the chat", () => {
    const drawing: Drawing = { title: "How it works", marks: [], flow: { ...flow } };
    expect(illustrationOf(drawing)).toEqual({
      kind: "flow",
      title: "How it works",
      body: "",
      flow: drawing.flow,
    });
  });

  it("names an untitled diagram", () => {
    expect(illustrationOf({ title: null, marks: [], flow: { ...flow } })?.title).toBe("Diagram");
  });

  it("leaves walkthroughs and empty drawings over the screen", () => {
    const mark = { n: 1, note: "1. Export", spot: { x: 1, y: 2, w: 60, h: 24, label: "Export" } };
    expect(illustrationOf({ title: null, marks: [mark], flow: { ...flow } })).toBeNull();
    expect(illustrationOf({ title: null, marks: [], flow: null })).toBeNull();
  });
});
