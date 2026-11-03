import { describe, expect, it } from "vitest";
import { policyAllows, targetInText, targetOf, truncateValue } from "./tools";

describe("policyAllows", () => {
  it("runs reads freely, whatever the policy", () => {
    expect(policyAllows(null, { writes: false, tool: "notion_search" }, false)).toBe("run");
    expect(
      policyAllows({ mode: "approve_each", tools: [] }, { writes: false, tool: "x" }, false),
    ).toBe("run");
  });

  it("asks for writes unless approved or preapproved for the tool", () => {
    expect(
      policyAllows({ mode: "approve_each", tools: [] }, { writes: true, tool: "x_post" }, false),
    ).toBe("ask");
    expect(
      policyAllows({ mode: "approve_each", tools: [] }, { writes: true, tool: "x_post" }, true),
    ).toBe("run");
    expect(
      policyAllows(
        { mode: "preapproved", tools: ["notion_create_page"] },
        { writes: true, tool: "notion_create_page" },
        false,
      ),
    ).toBe("run");
    expect(
      policyAllows(
        { mode: "preapproved", tools: ["notion_create_page"] },
        { writes: true, tool: "x_post" },
        false,
      ),
    ).toBe("ask");
  });

  it("asks when there is no policy at all", () => {
    expect(policyAllows(null, { writes: true, tool: "x_post" }, false)).toBe("ask");
  });
});

describe("targetOf", () => {
  it("reads known tool shapes", () => {
    expect(targetOf("notion_create_page", { url: "https://notion.so/x" })).toBe(
      "https://notion.so/x",
    );
    expect(targetOf("calendar_create", { link: "https://cal/y" })).toBe("https://cal/y");
    expect(targetOf("x_post", { posted: true, id: "123" })).toBe("123");
  });

  it("falls back to common id fields, else null", () => {
    expect(targetOf("mystery", { url: "https://a.b/c" })).toBe("https://a.b/c");
    expect(targetOf("mystery", { id: "LIN-1" })).toBe("LIN-1");
    expect(targetOf("mystery", { posted: true })).toBeNull();
    expect(targetOf("mystery", "just text")).toBeNull();
    expect(targetOf("mystery", null)).toBeNull();
  });
});

describe("targetInText", () => {
  it("pulls the first URL out of a receipt, else null", () => {
    expect(targetInText("Created LIN-123: https://linear.app/t/LIN-123 (done)")).toBe(
      "https://linear.app/t/LIN-123",
    );
    expect(targetInText("no links here")).toBeNull();
  });
});

describe("truncateValue", () => {
  it("keeps small values and caps big ones", () => {
    expect(truncateValue({ a: 1 })).toEqual({ a: 1 });
    const big = truncateValue({ text: "x".repeat(5000) }) as { truncated: string; chars: number };
    expect(big.truncated.length).toBeLessThanOrEqual(4001);
    expect(big.chars).toBeGreaterThan(5000);
  });
});
