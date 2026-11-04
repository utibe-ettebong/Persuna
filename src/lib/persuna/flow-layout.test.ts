import { describe, expect, it } from "vitest";
import { FLOW_FILLS, flowSvg, layoutFlow, ranks, wrapLabel } from "./flow-layout";
import { flowSchema, type Flow } from "./types";

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

  it("draws shaped, colored boxes with hover text", () => {
    const svg = flowSvg(
      {
        direction: "down",
        nodes: [
          {
            id: "a",
            label: "Leaf",
            shape: "M50,0 L100,100 L0,100 Z",
            color: "leaf",
            detail: "Grown, not built.",
          },
        ],
        edges: [],
      },
      null,
    );
    expect(svg).toContain('d="M50,0 L100,100 L0,100 Z"');
    expect(svg).toContain("scale(1.72,0.52)");
    expect(svg).toContain(`fill="${FLOW_FILLS.leaf.fill}"`);
    expect(svg).toContain("<title>Grown, not built.</title>");
  });

  it("keeps plain boxes as they were", () => {
    const svg = flowSvg({ direction: "down", nodes: [{ id: "a", label: "Box" }], edges: [] });
    expect(svg).toContain("<rect");
    expect(svg).toContain('stroke-opacity="0.7"');
    expect(svg).not.toContain("<title>");
  });
});

describe("layoutFlow boxes", () => {
  it("carries shapes, colors and details to the renderer", () => {
    const l = layoutFlow({
      direction: "down",
      nodes: [
        {
          id: "a",
          label: "A",
          shape: "M0,0 L100,0 L100,100 L0,100 Z",
          color: "gold",
          detail: "More.",
        },
      ],
      edges: [],
    });
    expect(l.nodes[0]).toMatchObject({
      shape: "M0,0 L100,0 L100,100 L0,100 Z",
      color: "gold",
      detail: "More.",
    });
  });
});

describe("flowSchema boxes", () => {
  const node = (over: object) => ({ id: "a", label: "A", ...over });
  const parse = (over: object) =>
    flowSchema.safeParse({ direction: "down", nodes: [node(over)], edges: [] });

  it("accepts plain and dressed boxes", () => {
    expect(parse({}).success).toBe(true);
    expect(parse({ shape: "M0,0 L10,10", color: "sky", detail: "More." }).success).toBe(true);
  });

  it("refuses markup in shapes, long details and unknown colors", () => {
    expect(parse({ shape: "M0,0 <script>" }).success).toBe(false);
    expect(parse({ shape: "x".repeat(301) }).success).toBe(false);
    expect(parse({ detail: "x".repeat(141) }).success).toBe(false);
    expect(parse({ color: "purple" }).success).toBe(false);
  });
});
