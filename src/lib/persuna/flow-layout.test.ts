import { describe, expect, it } from "vitest";
import { flowSvg, layoutFlow, ranks, wrapLabel } from "./flow-layout";
import type { Flow } from "./types";

const flow = (edges: [string, string][], direction: "down" | "right" = "down"): Flow => ({
  direction,
  nodes: [...new Set(edges.flat())].map((id) => ({ id, label: id.toUpperCase() })),
  edges: edges.map(([from, to]) => ({ from, to })),
});

describe("ranks", () => {
  it("puts each box one step past the furthest box pointing at it", () => {
    const r = ranks(
      flow([
        ["a", "b"],
        ["b", "c"],
        ["a", "c"],
      ]),
    );
    expect([r.get("a"), r.get("b"), r.get("c")]).toEqual([0, 1, 2]);
  });

  it("stops on a loop", () => {
    const r = ranks(
      flow([
        ["a", "b"],
        ["b", "a"],
      ]),
    );
    expect(Math.max(...r.values())).toBeLessThan(2);
  });
});

describe("layoutFlow", () => {
  it("stacks a process top to bottom, branches side by side", () => {
    const l = layoutFlow(
      flow([
        ["a", "b"],
        ["a", "c"],
      ]),
    );
    const [a, b, c] = ["a", "b", "c"].map((id) => l.nodes.find((n) => n.id === id)!);
    expect(b.y).toBeGreaterThan(a.y);
    expect(b.y).toBe(c.y);
    expect(b.x).not.toBe(c.x);
    expect(l.edges).toHaveLength(2);
    expect(l.width).toBeGreaterThan(2 * b.w);
  });

  it("runs left to right when asked", () => {
    const l = layoutFlow(flow([["a", "b"]], "right"));
    const [a, b] = l.nodes;
    expect(b.x).toBeGreaterThan(a.x);
    expect(b.y).toBe(a.y);
  });

  it("skips arrows to boxes that don't exist", () => {
    const f = flow([["a", "b"]]);
    f.edges.push({ from: "a", to: "zz" });
    expect(layoutFlow(f).edges).toHaveLength(1);
  });
});

describe("wrapLabel", () => {
  it("breaks between words into at most two lines", () => {
    expect(wrapLabel("Short")).toEqual(["Short"]);
    const lines = wrapLabel("Persuna learns your method from every single example you give it");
    expect(lines).toHaveLength(2);
    expect(lines[1].endsWith("…")).toBe(true);
  });
});

describe("flowSvg", () => {
  it("escapes labels", () => {
    const svg = flowSvg({ direction: "down", nodes: [{ id: "a", label: "<b>&" }], edges: [] }, "T");
    expect(svg).toContain("&lt;b&gt;&amp;");
    expect(svg).not.toContain("<b>");
  });
});
