import { describe, expect, it } from "vitest";
import { greetingFor, projectNextStep, weekStart, weeklyTotals } from "./rules";

describe("weekly totals", () => {
  it("starts weeks on Monday", () => {
    expect(weekStart(new Date("2026-10-29T15:00:00Z")).toISOString()).toBe(
      "2026-10-26T00:00:00.000Z",
    );
    expect(weekStart(new Date("2026-10-26T00:00:00Z")).toISOString()).toBe(
      "2026-10-26T00:00:00.000Z",
    );
  });

  it("buckets payments into the last eight weeks, zeros included", () => {
    const now = new Date("2026-10-29T12:00:00Z");
    const weeks = weeklyTotals(
      [
        { at: new Date("2026-10-27T09:00:00Z"), cents: 500 },
        { at: new Date("2026-10-28T09:00:00Z"), cents: 250 },
        { at: new Date("2026-10-20T09:00:00Z"), cents: 100 },
        { at: new Date("2026-01-01T09:00:00Z"), cents: 9999 },
      ],
      now,
    );
    expect(weeks).toHaveLength(8);
    expect(weeks.at(-1)!.cents).toBe(750);
    expect(weeks.at(-2)!.cents).toBe(100);
    expect(weeks.slice(0, 6).every((w) => w.cents === 0)).toBe(true);
  });
});

describe("a project's next step", () => {
  const p = (status: string, proposals = 0, rated = false) => ({ status, proposals, rated });

  it("asks the poster to review proposals, and tells proposers to wait", () => {
    expect(projectNextStep(p("open", 2), [], "poster")).toEqual({
      label: "Review 2 proposals",
      yours: true,
    });
    expect(projectNextStep(p("open", 2), [], "proposer").yours).toBe(false);
  });

  it("follows the milestones: deliver, check, fix, fund", () => {
    expect(projectNextStep(p("in_progress"), [{ status: "funded" }], "seller")).toEqual({
      label: "Deliver the funded milestone",
      yours: true,
    });
    expect(projectNextStep(p("in_progress"), [{ status: "submitted" }], "poster").yours).toBe(true);
    expect(
      projectNextStep(p("in_progress"), [{ status: "changes_requested" }], "seller").yours,
    ).toBe(true);
    expect(
      projectNextStep(p("in_progress"), [{ status: "released" }, { status: "pending" }], "poster"),
    ).toEqual({ label: "Fund the next milestone", yours: true });
  });

  it("asks for a rating once it's done", () => {
    expect(projectNextStep(p("completed"), [], "seller")).toEqual({
      label: "Rate the client",
      yours: true,
    });
    expect(projectNextStep(p("completed", 0, true), [], "seller").yours).toBe(false);
  });
});

it("greets by the hour", () => {
  expect([greetingFor(8), greetingFor(13), greetingFor(20)]).toEqual([
    "Good morning",
    "Good afternoon",
    "Good evening",
  ]);
});
