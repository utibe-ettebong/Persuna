import { describe, expect, it } from "vitest";
import { assessClaims, groundingFlags, normalizeForQuote, quoteInSource } from "./grounding";

const input = `[notes.pdf · page 1]
Ops sync, 14 October. Chair: Sam.
Agreed: the stock count moves to Thursdays.
Action: Tunde to send the revised rota by Friday.`;

describe("quoteInSource", () => {
  it("finds a quote despite case, spacing and curly quotes", () => {
    expect(quoteInSource("the  STOCK count moves to Thursdays", input)).toBe(true);
    expect(quoteInSource("“Tunde to send the revised rota”", input)).toBe(true);
    expect(normalizeForQuote("A—b ’c’")).toBe("a-b 'c'");
  });

  it("rejects quotes that aren't in the input, or too short to prove anything", () => {
    expect(quoteInSource("the stock count moves to Mondays", input)).toBe(false);
    expect(quoteInSource("Sam", input)).toBe(false);
    expect(quoteInSource("", input)).toBe(false);
  });
});

describe("assessClaims", () => {
  it("marks claims without a real quote as unsupported", () => {
    const report = assessClaims(
      [
        { claim: "The stock count moves to Thursdays.", quote: "stock count moves to Thursdays" },
        { claim: "Budget approved at 60,000.", quote: "" },
        { claim: "Ife chaired.", quote: "Chair: Ife" },
      ],
      input,
      1,
    );
    expect(report.checked).toBe(3);
    expect(report.unsupported.map((c) => c.claim)).toEqual([
      "Budget approved at 60,000.",
      "Ife chaired.",
    ]);
    expect(report.redrafts).toBe(1);
    expect(groundingFlags(report)).toEqual([
      {
        kind: "invented_detail",
        message: 'Not supported by the input: "Budget approved at 60,000."',
      },
      { kind: "invented_detail", message: 'Not supported by the input: "Ife chaired."' },
    ]);
  });
});
