import { describe, expect, it } from "vitest";
import { createMockClient } from "@/lib/models/mock";
import { checkDelivery, checkLine, planProject, proposalFit } from "./checks";
import {
  allocate,
  allSettled,
  cancelAllowed,
  changesAllowed,
  MAX_CHANGE_ROUNDS,
  milestoneProblem,
  nextMilestoneStatus,
  nextProjectStatus,
  priceVsBudget,
  ProjectRuleError,
  termFlags,
} from "./rules";

const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0);

describe("allocate", () => {
  it("splits a budget in proportion, in whole cents that add up exactly", () => {
    expect(allocate(10_000, [1, 1, 1])).toEqual([3334, 3333, 3333]);
    expect(allocate(10_000, [50, 30, 20])).toEqual([5000, 3000, 2000]);
    for (const [total, weights] of [
      [99_999, [3, 7, 11, 2]],
      [500, [1, 1, 1, 1, 1]],
      [12_345, [0, 0]],
    ] as const) {
      const out = allocate(total, [...weights]);
      expect(sum(out)).toBe(total);
      expect(Math.min(...out)).toBeGreaterThanOrEqual(100);
    }
  });

  it("gives every milestone at least a dollar, or refuses", () => {
    expect(allocate(1_000, [100, 1])).toEqual([900, 100]);
    expect(() => allocate(250, [1, 1, 1])).toThrow(ProjectRuleError);
  });
});

describe("milestoneProblem", () => {
  const m = (amountCents: number, criteria = ["Done"]) => ({
    title: "Draft",
    criteria,
    amountCents,
  });

  it("accepts milestones that add up to the budget", () => {
    expect(milestoneProblem([m(600), m(400)], 1000)).toBeNull();
  });

  it("explains what's wrong", () => {
    expect(milestoneProblem([m(600), m(300)], 1000)).toMatch(/add up to \$9.*budget is \$10/);
    expect(milestoneProblem([], 1000)).toMatch(/at least one/);
    expect(milestoneProblem(Array(6).fill(m(100)), 600)).toMatch(/At most 5/);
    expect(milestoneProblem([m(1000, [" "])], 1000)).toMatch(/acceptance criterion/);
    expect(milestoneProblem([m(50), m(950)], 1000)).toMatch(/at least \$1/);
    expect(milestoneProblem([{ ...m(1000), title: "" }], 1000)).toMatch(/needs a title/);
  });
});

describe("termFlags", () => {
  const now = new Date("2026-10-29T12:00:00Z");
  const days = (n: number) => new Date(now.getTime() + n * 86_400_000);

  it("flags a deadline in the past or too tight for the milestones", () => {
    expect(termFlags({ budgetCents: 50_000, deadline: days(-1), milestones: 1, now })[0].kind).toBe(
      "impossible_deadline",
    );
    expect(termFlags({ budgetCents: 50_000, deadline: days(3), milestones: 3, now })[0].kind).toBe(
      "impossible_deadline",
    );
    expect(termFlags({ budgetCents: 50_000, deadline: days(30), milestones: 3, now })).toEqual([]);
  });

  it("flags a budget under $25 a milestone", () => {
    const flags = termFlags({ budgetCents: 4_000, deadline: days(30), milestones: 2, now });
    expect(flags.map((f) => f.kind)).toEqual(["unfair_budget"]);
  });
});

describe("priceVsBudget", () => {
  it("says how far a price is from the budget", () => {
    expect(priceVsBudget(8000, 10_000)).toBe("20% under budget");
    expect(priceVsBudget(12_500, 10_000)).toBe("25% over budget");
    expect(priceVsBudget(10_000, 10_000)).toBe("matches the budget");
  });
});

describe("status transitions", () => {
  it("moves a project through its life and refuses skipped steps", () => {
    expect(nextProjectStatus("draft", "open")).toBe("open");
    expect(nextProjectStatus("open", "accept")).toBe("in_progress");
    expect(nextProjectStatus("in_progress", "dispute")).toBe("disputed");
    expect(nextProjectStatus("disputed", "resume")).toBe("in_progress");
    expect(nextProjectStatus("in_progress", "complete")).toBe("completed");
    expect(() => nextProjectStatus("draft", "accept")).toThrow(ProjectRuleError);
    expect(() => nextProjectStatus("completed", "cancel")).toThrow(
      /completed project can't cancel/,
    );
    expect(() => nextProjectStatus("open", "dispute")).toThrow();
  });

  it("moves a milestone from funding to payout, with rounds of changes", () => {
    let s = nextMilestoneStatus("pending", "fund");
    s = nextMilestoneStatus(s, "submit");
    s = nextMilestoneStatus(s, "request_changes");
    s = nextMilestoneStatus(s, "submit");
    s = nextMilestoneStatus(s, "approve");
    expect(nextMilestoneStatus(s, "release")).toBe("released");
    expect(() => nextMilestoneStatus("pending", "submit")).toThrow(ProjectRuleError);
    expect(() => nextMilestoneStatus("released", "refund")).toThrow();
    expect(() => nextMilestoneStatus("approved", "refund")).toThrow();
    expect(nextMilestoneStatus("submitted", "settle")).toBe("released");
    expect(nextMilestoneStatus("funded", "refund")).toBe("refunded");
  });

  it("limits rounds of changes", () => {
    expect(changesAllowed(MAX_CHANGE_ROUNDS - 1).ok).toBe(true);
    expect(changesAllowed(MAX_CHANGE_ROUNDS).ok).toBe(false);
  });

  it("knows when a project is settled and when it can still be cancelled", () => {
    expect(allSettled(["released", "refunded"])).toBe(true);
    expect(allSettled(["released", "funded"])).toBe(false);
    expect(allSettled([])).toBe(false);
    expect(cancelAllowed(["pending", "funded"]).ok).toBe(true);
    expect(cancelAllowed(["released", "pending"]).ok).toBe(false);
  });
});

describe("Persuna's project checks (mock models)", () => {
  const client = createMockClient();
  const now = new Date("2026-10-29T12:00:00Z");
  const brief =
    "Write a 10-page market report on solar kits in Lagos. Include a competitor table. Interview five shop owners and summarise their answers. Deliver the final report as a Word document.";

  it("plans a brief into milestones that add up to the budget", async () => {
    const plan = await planProject(client, {
      title: "Solar market report",
      brief,
      budgetCents: 100_000,
      deadline: new Date("2026-12-01"),
      now,
    });
    expect(plan.milestones.length).toBeGreaterThanOrEqual(1);
    expect(plan.milestones.length).toBeLessThanOrEqual(5);
    expect(sum(plan.milestones.map((m) => m.amountCents))).toBe(100_000);
    expect(plan.milestones.every((m) => m.criteria.length > 0)).toBe(true);
    expect(milestoneProblem(plan.milestones, 100_000)).toBeNull();
  });

  it("flags a vague brief and an impossible deadline", async () => {
    const plan = await planProject(client, {
      title: "Logo",
      brief: "Make a logo ASAP.",
      budgetCents: 2_000,
      deadline: new Date("2026-10-29T18:00:00Z"),
      now,
    });
    const kinds = plan.flags.map((f) => f.kind);
    expect(kinds).toContain("vague");
    expect(kinds).toContain("unfair_terms");
    expect(kinds).toContain("impossible_deadline");
    expect(kinds).toContain("unfair_budget");
  });

  it("writes a fit report with the price against the budget", async () => {
    const fit = await proposalFit(client, {
      plan: { scope: "A report", criteria: [], milestones: [], flags: [] },
      budgetCents: 10_000,
      deadline: new Date("2026-12-01"),
      priceCents: 12_000,
      days: 7,
      message: "I've written many market reports.",
      skills: [],
    });
    expect(fit.priceNote).toBe("20% over budget");
    expect(fit.recommendation).toBe("weak");
  });

  it("checks a delivery against every criterion, in order", async () => {
    const check = await checkDelivery(client, {
      milestone: "Draft report",
      criteria: ["Includes a competitor table", "Summarises five shop owner interviews"],
      delivery:
        "Here is the draft. It includes a competitor table comparing six brands, with prices and warranty.",
      round: 1,
      earlierRequests: [],
    });
    expect(check.results.map((r) => r.verdict)).toEqual(["met", "not_met"]);
    expect(check.results[1].criterion).toBe("Summarises five shop owner interviews");
    expect(checkLine(check)).toBe("1 of 2 criteria met, 1 not met.");
    expect(check.fairness.poster).toBeTruthy();
  });
});
