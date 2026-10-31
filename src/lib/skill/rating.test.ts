import { describe, expect, it } from "vitest";
import {
  branchCoverage,
  confidenceOf,
  coverageOf,
  freshnessOf,
  groundednessOf,
  reliabilityOf,
} from "./rating";
import type { SkillStep } from "@/db/schema";

const step = (over: Partial<SkillStep>): SkillStep =>
  ({
    id: `step-${Math.random()}`,
    skillId: "skill-1",
    seq: 0,
    app: "",
    action: "switch",
    targetRole: "",
    targetLabel: "",
    decisionKey: null,
    branchLabel: null,
    evidenceCount: 1,
    episodeIds: [],
    createdAt: new Date(),
    ...over,
  }) as SkillStep;

describe("branchCoverage", () => {
  it("is full without decisions", () => {
    expect(branchCoverage([step({}), step({})])).toBe(1);
    expect(branchCoverage([])).toBe(1);
  });

  it("counts branches seen twice or more", () => {
    const steps = [
      step({ decisionKey: "d1", branchLabel: "Mail select", evidenceCount: 3 }),
      step({ decisionKey: "d1", branchLabel: "Calendar switch", evidenceCount: 1 }),
    ];
    expect(branchCoverage(steps)).toBe(0.5);
  });

  it("ignores a lone surviving branch (no alternative, no decision)", () => {
    const steps = [
      step({ decisionKey: "d1", branchLabel: "Mail select", evidenceCount: 1 }),
      step({}),
    ];
    expect(branchCoverage(steps)).toBe(1);
  });

  it("needs every step of a branch confirmed", () => {
    const steps = [
      step({ decisionKey: "d1", branchLabel: "A", evidenceCount: 3 }),
      step({ decisionKey: "d1", branchLabel: "A", evidenceCount: 1 }),
      step({ decisionKey: "d1", branchLabel: "B", evidenceCount: 3 }),
    ];
    expect(branchCoverage(steps)).toBe(0.5);
  });
});

describe("coverageOf", () => {
  it("is the weaker of fitness and branch coverage", () => {
    expect(coverageOf(0.9, [step({}), step({})])).toBe(90);
    expect(
      coverageOf(1, [
        step({ decisionKey: "d1", branchLabel: "A", evidenceCount: 3 }),
        step({ decisionKey: "d1", branchLabel: "B", evidenceCount: 1 }),
      ]),
    ).toBe(50);
  });

  it("is null without episodes", () => {
    expect(coverageOf(null, [step({})])).toBeNull();
  });
});

describe("confidenceOf and groundednessOf", () => {
  it("counts rules by independent sources", () => {
    const counts = { R1: 3, R2: 2, R3: 1, R4: 0 };
    expect(confidenceOf(["R1", "R2", "R3", "R4"], counts)).toBe(50);
    expect(groundednessOf(["R1", "R2", "R3", "R4"], counts)).toBe(75);
  });

  it("is null without rules", () => {
    expect(confidenceOf([], {})).toBeNull();
    expect(groundednessOf([], {})).toBeNull();
  });
});

describe("freshnessOf", () => {
  it("averages recent fitness", () => {
    expect(freshnessOf([0.9, 1, 0.8])).toBe(90);
    expect(freshnessOf([0.9, null])).toBe(90);
  });

  it("is null without learned episodes", () => {
    expect(freshnessOf([])).toBeNull();
    expect(freshnessOf([null])).toBeNull();
  });
});

describe("reliabilityOf", () => {
  it("shares jobs delivered without correction", () => {
    expect(reliabilityOf(10, 2)).toBe(80);
    expect(reliabilityOf(4, 0)).toBe(100);
  });

  it("is null without delivered jobs", () => {
    expect(reliabilityOf(0, 0)).toBeNull();
  });
});
