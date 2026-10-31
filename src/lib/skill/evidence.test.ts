import { describe, expect, it } from "vitest";
import { touchedRuleIds } from "./evidence";
import type { SkillSheet } from "./types";

const sheet = (rules: { id: string; category: "content"; text: string }[]): SkillSheet => ({
  summary: "Test",
  rules,
  template: "T",
});

describe("touchedRuleIds", () => {
  it("finds added rules by id diff and updated rules from ops", () => {
    const from = sheet([
      { id: "R1", category: "content", text: "Keep decisions." },
      { id: "R2", category: "content", text: "Keep owners." },
    ]);
    const proposed = sheet([
      { id: "R1", category: "content", text: "Keep decisions and owners." },
      { id: "R2", category: "content", text: "Keep owners." },
      { id: "R3", category: "content", text: "Use 24-hour times." },
    ]);

    expect(
      touchedRuleIds(
        [
          { op: "update", id: "R1", text: "Keep decisions and owners." },
          { op: "add", category: "content", text: "Use 24-hour times." },
        ],
        from,
        proposed,
      ),
    ).toEqual({ added: ["R3"], updated: ["R1"] });
  });

  it("takes no evidence for removed rules", () => {
    const from = sheet([{ id: "R1", category: "content", text: "Old rule." }]);
    const proposed = sheet([]);

    expect(touchedRuleIds([{ op: "remove", id: "R1" }], from, proposed)).toEqual({
      added: [],
      updated: [],
    });
  });
});
