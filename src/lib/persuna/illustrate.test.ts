import { describe, expect, it } from "vitest";
import { stepsAsFlow } from "./illustrate";

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
