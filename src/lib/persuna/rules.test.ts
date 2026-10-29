import { describe, expect, it } from "vitest";
import { coachSkill, examplesToReach, type SkillStats } from "./coach";
import { localToUtc, parseWhen, startOfLocalDay, utcToLocal } from "./when";
import { buildWrapUp } from "./wrapup";

const stats = (over: Partial<SkillStats> = {}): SkillStats => ({
  name: "Minutes",
  slug: "minutes",
  answered: 3,
  totalQuestions: 7,
  trainPairs: 4,
  testPairs: 2,
  hasRules: true,
  published: true,
  score: 74,
  minScore: 80,
  listed: false,
  ...over,
});

describe("coachSkill", () => {
  it("walks a skill from empty to listed", () => {
    expect(coachSkill(stats({ trainPairs: 0, testPairs: 0, answered: 0 })).stage).toBe("start");
    expect(coachSkill(stats({ trainPairs: 1, testPairs: 0 })).stage).toBe("examples");
    expect(coachSkill(stats({ hasRules: false })).stage).toBe("rules");
    expect(coachSkill(stats({ score: null })).stage).toBe("test");
    expect(coachSkill(stats({ score: 85, published: false })).stage).toBe("publish");
    expect(coachSkill(stats({ score: 85 })).stage).toBe("list");
    expect(coachSkill(stats({ score: 85, listed: true })).stage).toBe("listed");
  });

  it("says the score and a rough number of examples to the listing bar", () => {
    const c = coachSkill(stats());
    expect(c.stage).toBe("improve");
    expect(c.message).toContain("scores 74");
    expect(c.message).toContain("About 2 more training examples");
    expect(c.message).toContain("to 80");
  });

  it("names what's missing before scoring", () => {
    expect(coachSkill(stats({ trainPairs: 1, testPairs: 0 })).message).toContain(
      "1 training example and 1 test example",
    );
  });

  it("caps the example estimate", () => {
    expect(examplesToReach(79, 80)).toBe(1);
    expect(examplesToReach(20, 80)).toBe(5);
  });
});

describe("reminder times", () => {
  const now = "2026-10-27T10:15";
  it("reads clock times, later today or tomorrow", () => {
    expect(parseWhen("remind me at 4pm to send the minutes", now)).toBe("2026-10-27T16:00");
    expect(parseWhen("at 16:30 call the venue", now)).toBe("2026-10-27T16:30");
    expect(parseWhen("at 9am check email", now)).toBe("2026-10-28T09:00");
    expect(parseWhen("tomorrow at 12pm lunch", now)).toBe("2026-10-28T12:00");
  });
  it("reads relative times and returns null without one", () => {
    expect(parseWhen("in 10 minutes stretch", now)).toBe("2026-10-27T10:25");
    expect(parseWhen("in an hour", now)).toBe("2026-10-27T11:15");
    expect(parseWhen("buy milk", now)).toBeNull();
  });
  it("converts local wall time with the browser offset", () => {
    // Lagos is UTC+1, so getTimezoneOffset() is -60.
    expect(localToUtc("2026-10-27T16:00", -60)?.toISOString()).toBe("2026-10-27T15:00:00.000Z");
    expect(utcToLocal(new Date("2026-10-27T15:00:00Z"), -60)).toBe("2026-10-27T16:00");
    expect(startOfLocalDay(new Date("2026-10-27T00:30:00Z"), -60).toISOString()).toBe(
      "2026-10-26T23:00:00.000Z",
    );
    expect(localToUtc("not a time", 0)).toBeNull();
  });
});

describe("buildWrapUp", () => {
  it("summarises work, notes and what's still open", () => {
    const text = buildWrapUp({
      name: "Owl",
      focus: "the board minutes",
      messages: 6,
      notes: ["chase the venue quote"],
      jobs: [
        { skill: "Minutes", status: "approved" },
        { skill: "Minutes", status: "review" },
      ],
      done: ["send agenda"],
      open: [{ text: "send the minutes", due: "16:00" }],
    });
    expect(text).toContain("Today we worked on the board minutes.");
    expect(text).toContain("2 tasks drafted, 1 approved, 1 still waiting for your review");
    expect(text).toContain("• chase the venue quote");
    expect(text).toContain("• send the minutes (due 16:00)");
  });
  it("says so on a quiet day", () => {
    expect(
      buildWrapUp({
        name: "Owl",
        focus: null,
        messages: 0,
        notes: [],
        jobs: [],
        done: [],
        open: [],
      }),
    ).toContain("Quiet day");
  });
});
