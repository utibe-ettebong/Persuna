import { describe, expect, it } from "vitest";
import { fitnessOf, mergeSteps, stepsFromEvents, type ObservedStep } from "./episodes";
import type { SkillStep } from "@/db/schema";

const event = (
  app: string,
  action: string,
  role = "",
  label = "",
  window = "",
  at = "2026-10-31T09:00:00Z",
) => ({ app, window, action, role, label, at: new Date(at) });

const step = (over: Partial<SkillStep> & { app: string; action: string }): SkillStep =>
  ({
    id: `step-${over.app}-${over.action}-${Math.random()}`,
    skillId: "skill-1",
    seq: 0,
    targetRole: "",
    targetLabel: "",
    decisionKey: null,
    branchLabel: null,
    evidenceCount: 1,
    episodeIds: [],
    createdAt: new Date(),
    ...over,
  }) as SkillStep;

function applyMerge(
  existing: SkillStep[],
  observed: ObservedStep[],
  episodeId: string,
): SkillStep[] {
  const { updates, inserts } = mergeSteps(existing, observed, episodeId);
  const next = existing.map((s) => {
    const update = updates.find((u) => u.id === s.id);
    return update
      ? {
          ...s,
          seq: update.seq,
          evidenceCount: update.evidenceCount,
          episodeIds: update.episodeIds,
        }
      : s;
  });
  for (const insert of inserts) {
    next.push(
      step({
        app: insert.app,
        action: insert.action,
        targetRole: insert.targetRole,
        targetLabel: insert.targetLabel,
        seq: insert.seq,
        evidenceCount: 1,
        episodeIds: [episodeId],
      }),
    );
  }
  return next.sort((a, b) => a.seq - b.seq);
}

describe("stepsFromEvents", () => {
  it("turns step-change events into steps, dropping consecutive repeats", () => {
    const steps = stepsFromEvents([
      event("Mail", "switch"),
      event("Mail", "focus", "field", "Search"),
      event("Mail", "focus", "field", "Search"),
      event("Mail", "select", "row", "Invoice from Ada"),
    ]);

    expect(steps).toEqual([
      { app: "Mail", action: "switch", targetRole: "", targetLabel: "" },
      { app: "Mail", action: "focus", targetRole: "field", targetLabel: "Search" },
      { app: "Mail", action: "select", targetRole: "row", targetLabel: "Invoice from Ada" },
    ]);
  });
});

describe("mergeSteps", () => {
  it("matches repeated steps case-insensitively and counts evidence", () => {
    const existing = [
      step({ app: "Mail", action: "focus", targetRole: "field", targetLabel: "Search", seq: 1 }),
    ];
    const { updates, inserts } = mergeSteps(
      existing,
      [{ app: "mail", action: "focus", targetRole: "field", targetLabel: " search " }],
      "ep-2",
    );

    expect(inserts).toEqual([]);
    expect(updates).toHaveLength(1);
    expect(updates[0]).toMatchObject({ evidenceCount: 2, episodeIds: ["ep-2"] });
  });

  it("treats numbered labels as the same step", () => {
    const existing = [
      step({ app: "Mail", action: "select", targetRole: "row", targetLabel: "Row 3", seq: 1 }),
    ];
    const { updates, inserts } = mergeSteps(
      existing,
      [{ app: "Mail", action: "select", targetRole: "row", targetLabel: "Row 7" }],
      "ep-2",
    );

    expect(inserts).toEqual([]);
    expect(updates).toHaveLength(1);
  });

  it("appends new steps after the existing procedure", () => {
    const existing = [step({ app: "Mail", action: "switch", seq: 1 })];
    const { updates, inserts } = mergeSteps(
      existing,
      [
        { app: "Mail", action: "switch", targetRole: "", targetLabel: "" },
        { app: "Notes", action: "switch", targetRole: "", targetLabel: "" },
      ],
      "ep-2",
    );

    expect(updates).toHaveLength(1);
    expect(inserts).toEqual([
      { app: "Notes", action: "switch", targetRole: "", targetLabel: "", seq: 2 },
    ]);
  });

  it("inserts a new step where it was seen, not at the end", () => {
    const existing = [
      step({ app: "Mail", action: "switch", seq: 1 }),
      step({ app: "Notes", action: "switch", seq: 2 }),
    ];
    const { updates, inserts } = mergeSteps(
      existing,
      [
        { app: "Mail", action: "switch", targetRole: "", targetLabel: "" },
        { app: "Calendar", action: "switch", targetRole: "", targetLabel: "" },
        { app: "Notes", action: "switch", targetRole: "", targetLabel: "" },
      ],
      "ep-2",
    );

    expect(inserts).toEqual([
      { app: "Calendar", action: "switch", targetRole: "", targetLabel: "", seq: 2 },
    ]);
    expect(updates.find((u) => u.id === existing[1]!.id)?.seq).toBe(3);
  });

  it("marks a middle divergence as a decision with two branches", () => {
    const existing = [
      step({ app: "Mail", action: "switch", seq: 1 }),
      step({ app: "Mail", action: "select", targetRole: "row", targetLabel: "Invoice", seq: 2 }),
      step({ app: "Notes", action: "switch", seq: 3 }),
    ];
    const { updates, inserts } = mergeSteps(
      existing,
      [
        { app: "Mail", action: "switch", targetRole: "", targetLabel: "" },
        { app: "Calendar", action: "switch", targetRole: "", targetLabel: "" },
        { app: "Notes", action: "switch", targetRole: "", targetLabel: "" },
      ],
      "ep-2",
    );

    // The Calendar detour and the skipped select become branches d1.
    expect(inserts).toHaveLength(1);
    expect(inserts[0]).toMatchObject({ decisionKey: "d1", branchLabel: "Calendar switch" });
    const skipped = updates.find((u) => u.id === existing[1]!.id);
    expect(skipped).toMatchObject({ decisionKey: "d1", branchLabel: "Mail select Invoice" });
  });

  it("leaves beginnings, endings and straight runs unbranched", () => {
    const existing = [step({ app: "Mail", action: "switch", seq: 1 })];
    const { inserts } = mergeSteps(
      existing,
      [
        { app: "Calendar", action: "switch", targetRole: "", targetLabel: "" },
        { app: "Mail", action: "switch", targetRole: "", targetLabel: "" },
        { app: "Notes", action: "switch", targetRole: "", targetLabel: "" },
      ],
      "ep-2",
    );

    expect(inserts).toHaveLength(2);
    expect(inserts.every((insert) => !insert.decisionKey)).toBe(true);
  });

  it("never nests a decision inside a decided span", () => {
    const existing = [
      step({ app: "Mail", action: "switch", seq: 1 }),
      step({
        app: "Mail",
        action: "select",
        targetRole: "row",
        targetLabel: "Invoice",
        seq: 2,
        decisionKey: "d1",
        branchLabel: "Mail select Invoice",
      }),
      step({ app: "Notes", action: "switch", seq: 3 }),
    ];
    const { updates, inserts } = mergeSteps(
      existing,
      [
        { app: "Mail", action: "switch", targetRole: "", targetLabel: "" },
        { app: "Calendar", action: "check", targetRole: "", targetLabel: "" },
        { app: "Notes", action: "switch", targetRole: "", targetLabel: "" },
      ],
      "ep-3",
    );

    // The detour spans a decided member: Calendar joins unkeyed, no nesting.
    expect(inserts).toHaveLength(1);
    expect(inserts[0]!.decisionKey).toBeUndefined();
    expect(updates.every((u) => u.decisionKey === undefined)).toBe(true);
  });

  it("never counts the same episode twice", () => {
    const existing = [
      step({
        app: "Mail",
        action: "switch",
        seq: 1,
        evidenceCount: 2,
        episodeIds: ["ep-1", "ep-2"],
      }),
    ];
    const { updates, inserts } = mergeSteps(
      existing,
      [{ app: "Mail", action: "switch", targetRole: "", targetLabel: "" }],
      "ep-2",
    );

    // Nothing changed, so there is nothing to write.
    expect(updates).toEqual([]);
    expect(inserts).toEqual([]);
  });
});

describe("fitnessOf", () => {
  it("maps observed steps to skill steps in order", () => {
    const skill = [
      step({ app: "Mail", action: "switch", seq: 1 }),
      step({ app: "Mail", action: "select", targetRole: "row", targetLabel: "Invoice", seq: 2 }),
      step({ app: "Notes", action: "switch", seq: 3 }),
    ];
    const observed: ObservedStep[] = [
      { app: "Mail", action: "switch", targetRole: "", targetLabel: "" },
      { app: "Mail", action: "select", targetRole: "row", targetLabel: "Invoice" },
      { app: "Notes", action: "switch", targetRole: "", targetLabel: "" },
    ];

    expect(fitnessOf(skill, observed).fitness).toBe(1);
  });

  it("reports unmapped and skipped steps", () => {
    const skill = [
      step({ app: "Mail", action: "switch", seq: 1 }),
      step({ app: "Mail", action: "select", targetRole: "row", targetLabel: "Invoice", seq: 2 }),
    ];
    const observed: ObservedStep[] = [
      { app: "Mail", action: "switch", targetRole: "", targetLabel: "" },
      { app: "Calendar", action: "switch", targetRole: "", targetLabel: "" },
    ];
    const result = fitnessOf(skill, observed);

    expect(result.fitness).toBe(0.5);
    expect(result.unmapped).toHaveLength(1);
    expect(result.skipped).toHaveLength(1);
  });

  it("treats an empty episode as vacuous", () => {
    expect(fitnessOf([step({ app: "Mail", action: "switch", seq: 1 })], []).fitness).toBe(1);
  });
});

describe("learning from episodes", () => {
  // Plan §4.4: a skill learned from three episodes passes fitness ≥ 90% on a fourth.
  it("passes fitness on a held-out fourth episode", () => {
    const doing = (invoice: string, extra: boolean) => [
      event("Mail", "switch", "", "", "Inbox"),
      event("Mail", "select", "row", invoice),
      event("Mail", "focus", "field", "Search"),
      ...(extra ? [event("Calendar", "switch", "", "", "Week")] : []),
      event("Notes", "switch", "", "", "Minutes"),
      event("Notes", "focus", "field", "Title"),
    ];
    let skill: SkillStep[] = [];
    for (const [i, invoice] of [
      "Invoice from Ada",
      "Invoice from Bo",
      "Invoice from Cy",
    ].entries()) {
      skill = applyMerge(skill, stepsFromEvents(doing(invoice, i === 1)), `ep-${i + 1}`);
    }
    const heldOut = stepsFromEvents(doing("Invoice from Dee", false));

    expect(fitnessOf(skill, heldOut).fitness).toBeGreaterThanOrEqual(0.9);
    // The core procedure was seen three times.
    for (const s of skill.filter((s) => s.app !== "Calendar")) {
      expect(s.evidenceCount).toBe(3);
    }
  });
});
