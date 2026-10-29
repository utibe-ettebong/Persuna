import { describe, expect, it } from "vitest";
import {
  bearerToken,
  hashAgentToken,
  importAllowed,
  importOutcome,
  IMPORTS_PER_HOUR,
  methodAsInterview,
  methodSteps,
  newAgentToken,
  parseSkillImport,
  planSplit,
  reviewExamples,
  SKILL_IMPORT_SCHEMA,
} from "./rules";

const example = (i: number, test?: boolean) => ({
  input: `Raw notes for meeting ${i}: budget, venue, actions.`,
  output: `## Minutes ${i}\n\nDecisions and actions, in a table.`,
  ...(test === undefined ? {} : { test }),
});

const valid = {
  schema: SKILL_IMPORT_SCHEMA,
  agent: "Grokbot",
  skill: { name: "Board minutes", task: "Turn raw board notes into minutes", output: "minutes" },
  method: ["Read the notes once", "Write the header block", "Put actions in a table"],
  examples: [1, 2, 3, 4].map((i) => example(i)),
};

describe("parseSkillImport", () => {
  it("accepts a well-formed v1 payload", () => {
    const r = parseSkillImport(valid);
    expect(r.ok).toBe(true);
  });

  it("explains each problem with its path", () => {
    const r = parseSkillImport({ ...valid, schema: "v0", examples: [example(1)] });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.errors.join("\n")).toMatch(/schema: Set "schema"/);
      expect(r.errors.join("\n")).toMatch(/examples: Send at least 3 examples/);
    }
  });

  it("limits examples, sizes and the split", () => {
    expect(
      parseSkillImport({ ...valid, examples: Array.from({ length: 51 }, (_, i) => example(i)) }).ok,
    ).toBe(false);
    const huge = { input: "x".repeat(20_000), output: "y".repeat(20_000) };
    expect(parseSkillImport({ ...valid, examples: Array(11).fill(huge) }).ok).toBe(false);
    const allTest = [1, 2, 3].map((i) => example(i, true));
    expect(parseSkillImport({ ...valid, examples: allTest }).ok).toBe(false);
    expect(parseSkillImport({ ...valid, method: [] }).ok).toBe(false);
  });
});

describe("planSplit", () => {
  const count = (splits: string[], s: string) => splits.filter((x) => x === s).length;

  it("holds back about a quarter, at least one, spread through the list", () => {
    for (const [n, held] of [
      [3, 1],
      [4, 1],
      [8, 2],
      [10, 3],
      [50, 13],
    ]) {
      const r = planSplit(Array.from({ length: n }, () => ({})));
      expect(r.ok).toBe(true);
      if (r.ok) {
        expect(count(r.splits, "test")).toBe(held);
        expect(count(r.splits, "train")).toBeGreaterThanOrEqual(2);
      }
    }
    const r = planSplit(Array.from({ length: 8 }, () => ({})));
    if (r.ok) expect(r.splits.indexOf("test")).toBeGreaterThan(0);
  });

  it("follows the agent's own test flags", () => {
    const r = planSplit([{ test: true }, {}, {}, { test: false }]);
    expect(r).toEqual({ ok: true, splits: ["test", "train", "train", "train"] });
  });

  it("keeps at least two examples for training", () => {
    expect(planSplit([{ test: true }, { test: true }, {}]).ok).toBe(false);
  });
});

describe("methodSteps", () => {
  it("splits a written method into steps and numbers them for the interview", () => {
    expect(methodSteps("1. Read it\n- Draft\n\n• Check")).toEqual(["Read it", "Draft", "Check"]);
    expect(methodAsInterview(["Read", "Write"])).toBe("1. Read\n2. Write");
  });
});

describe("reviewExamples", () => {
  it("points out repeats, unchanged and very short outputs", () => {
    const problems = reviewExamples([
      { input: "same", output: "same" },
      { input: "Same ", output: "short" },
      example(3),
    ]);
    expect(problems).toHaveLength(3);
    expect(reviewExamples([example(1), example(2)])).toEqual([]);
  });
});

describe("importAllowed", () => {
  it("rate-limits each key and caps imports in flight", () => {
    expect(importAllowed({ sentLastHour: 0, inFlight: 0 }).ok).toBe(true);
    expect(importAllowed({ sentLastHour: IMPORTS_PER_HOUR, inFlight: 0 }).ok).toBe(false);
    const busy = importAllowed({ sentLastHour: 1, inFlight: 2 });
    expect(busy.ok).toBe(false);
    if (!busy.ok) expect(busy.retryAfterSeconds).toBe(120);
  });
});

describe("importOutcome", () => {
  it("verifies at or above the listing minimum", () => {
    expect(importOutcome(80, 80)).toBe("verified");
    expect(importOutcome(79.9, 80)).toBe("below_minimum");
    expect(importOutcome(null, 80)).toBe("below_minimum");
  });
});

describe("agent tokens", () => {
  it("are long random psk_ tokens, read only from a Bearer header and stored as a hash", () => {
    const token = newAgentToken();
    expect(token).toMatch(/^psk_[A-Za-z0-9_-]{43}$/);
    expect(newAgentToken()).not.toBe(token);
    expect(bearerToken(`Bearer ${token}`)).toBe(token);
    expect(bearerToken(token)).toBeNull();
    expect(bearerToken("Bearer sk_live_abc")).toBeNull();
    expect(bearerToken(null)).toBeNull();
    expect(hashAgentToken(token)).toMatch(/^[0-9a-f]{64}$/);
    expect(hashAgentToken(token)).toBe(hashAgentToken(token));
  });
});
