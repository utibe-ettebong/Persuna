import { describe, expect, it } from "vitest";
import { illustrationOf, stepsAsFlow } from "./illustrate";
import type { Drawing } from "./service";
import type { Flow } from "./types";

const flow: Flow = {
  direction: "down",
  nodes: [{ id: "a", label: "Your notes" }],
  edges: [],
};

describe("illustrationOf", () => {
  it("shows a diagram they asked for in the chat", () => {
    const drawing: Drawing = { title: "How it works", marks: [], flow: { ...flow } };
    expect(illustrationOf(drawing, "Draw me a diagram of refunds")).toEqual({
      kind: "flow",
      title: "How it works",
      body: "",
      flow: drawing.flow,
    });
  });

  it("names an untitled diagram", () => {
    expect(
      illustrationOf({ title: null, marks: [], flow: { ...flow } }, "Illustrate this")?.title,
    ).toBe("Diagram");
  });

  it("draws a diagram that explains the screen over the screen", () => {
    const drawing: Drawing = { title: null, marks: [], flow: { ...flow } };
    expect(illustrationOf(drawing, "Show me what's on my screen")).toBeNull();
    expect(illustrationOf(drawing, "What does this page do?")).toBeNull();
  });

  it("leaves walkthroughs and empty drawings over the screen", () => {
    const mark = {
      n: 1,
      note: "1. Export",
      spot: { x: 1, y: 2, w: 60, h: 24, label: "Export" },
      shape: null,
    };
    expect(illustrationOf({ title: null, marks: [mark], flow: { ...flow } }, "Draw it")).toBeNull();
    expect(illustrationOf({ title: null, marks: [], flow: null }, "Draw it")).toBeNull();
  });
});

describe("stepsAsFlow", () => {
  it("chains notes into numbered steps, keeping long ones whole in the detail", () => {
    const long = `1. ${"word ".repeat(20).trim()}`;
    const flow = stepsAsFlow([long, " 2. Save ", ""]);
    expect(flow?.nodes.map((n) => n.id)).toEqual(["s1", "s2"]);
    expect(flow?.nodes[0].label).toHaveLength(60);
    expect(flow?.nodes[0].detail).toBe(long);
    expect(flow?.nodes[1]).toEqual({ id: "s2", label: "2. Save", detail: null });
    expect(flow?.edges).toEqual([{ from: "s1", to: "s2" }]);
  });

  it("has nothing to draw without notes", () => {
    expect(stepsAsFlow([])).toBeNull();
    expect(stepsAsFlow(["  "])).toBeNull();
  });
});
