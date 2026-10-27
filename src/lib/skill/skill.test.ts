import { describe, expect, it } from "vitest";
import { closestPairs } from "./retrieve";
import { mean, replicationScore } from "./score";
import { applyRuleOps, renderSheet } from "./sheet";
import type { Pair, ScoreBreakdown, SkillSheet } from "./types";

const sheet: SkillSheet = {
  summary: "Formal minutes.",
  rules: [
    { id: "R1", category: "structure", text: "Start with a header block." },
    { id: "R2", category: "cut", text: "Drop small talk." },
    { id: "R3", category: "naming", text: "Refer to the chair as 'the Chair'." },
  ],
  template: "# Minutes: <title>",
};

describe("applyRuleOps", () => {
  it("adds, updates and removes rules, numbering new ones after the highest id", () => {
    const { sheet: next, unknownIds } = applyRuleOps(sheet, [
      { op: "add", category: "formatting", text: "Action items go in a table." },
      { op: "update", id: "R2", text: "Drop small talk and jokes." },
      { op: "remove", id: "R1" },
    ]);
    expect(unknownIds).toEqual([]);
    expect(next.rules).toEqual([
      { id: "R2", category: "cut", text: "Drop small talk and jokes." },
      { id: "R3", category: "naming", text: "Refer to the chair as 'the Chair'." },
      { id: "R4", category: "formatting", text: "Action items go in a table." },
    ]);
  });

  it("reports unknown ids instead of dropping them silently", () => {
    const { unknownIds, sheet: next } = applyRuleOps(sheet, [{ op: "remove", id: "R99" }]);
    expect(unknownIds).toEqual(["R99"]);
    expect(next.rules).toHaveLength(3);
  });

  it("never mutates the original sheet", () => {
    applyRuleOps(sheet, [{ op: "update", id: "R1", text: "changed" }]);
    expect(sheet.rules[0].text).toBe("Start with a header block.");
  });

  it("replaces the template only when a non-empty change is given", () => {
    expect(applyRuleOps(sheet, [], "  ").sheet.template).toBe(sheet.template);
    expect(applyRuleOps(sheet, [], "# New").sheet.template).toBe("# New");
  });
});

describe("renderSheet", () => {
  it("groups rules by category with their ids", () => {
    const md = renderSheet(sheet);
    expect(md).toContain("### Structure\n- [R1] Start with a header block.");
    expect(md).toContain("### What gets cut\n- [R2] Drop small talk.");
    expect(md.indexOf("Structure")).toBeLessThan(md.indexOf("What gets cut"));
  });
});

describe("replicationScore", () => {
  const breakdown = (n: number): ScoreBreakdown => ({
    criteria: { structure: n, content: n, cuts: n, tone: n, naming: n },
    missing: [],
    extra: [],
    ruleViolations: [],
    rationale: "",
  });

  it("maps uniform criterion scores onto 0–100", () => {
    expect(replicationScore(breakdown(10))).toBe(100);
    expect(replicationScore(breakdown(0))).toBe(0);
    expect(replicationScore(breakdown(7))).toBe(70);
  });

  it("weights content above tone", () => {
    const b = breakdown(5);
    const moreContent = replicationScore({ ...b, criteria: { ...b.criteria, content: 10 } });
    const moreTone = replicationScore({ ...b, criteria: { ...b.criteria, tone: 10 } });
    expect(moreContent).toBeGreaterThan(moreTone);
  });

  it("averages, and returns null for no runs", () => {
    expect(mean([80, 90])).toBe(85);
    expect(mean([])).toBeNull();
  });
});

describe("closestPairs", () => {
  const pair = (slug: string, input: string): Pair => ({ id: slug, slug, input, output: "" });
  const pairs = [
    pair("budget", "budget review transport fuel spending quotes"),
    pair("hiring", "hiring freeze field team new roles"),
    pair("outreach", "outreach community event venue chairs livestream"),
  ];

  it("ranks the most similar inputs first", () => {
    const [first] = closestPairs("livestream volunteer for the community event", pairs, 1);
    expect(first.slug).toBe("outreach");
  });

  it("returns everything when there are no more pairs than requested", () => {
    expect(closestPairs("anything", pairs, 5)).toHaveLength(3);
  });

  it("is deterministic when nothing matches", () => {
    const a = closestPairs("zzz", pairs, 2).map((p) => p.slug);
    const b = closestPairs("zzz", pairs, 2).map((p) => p.slug);
    expect(a).toEqual(b);
  });
});
