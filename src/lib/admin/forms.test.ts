import { describe, expect, it } from "vitest";
import { z } from "zod";
import { parseDisputeForm, parseRefundForm, parseResumeForm, parseTakedownForm } from "./forms";

const uuid = "123e4567-e89b-12d3-a456-426614174000";

describe("parseTakedownForm", () => {
  it("reads takedown and reinstate with an optional reason", () => {
    expect(parseTakedownForm({ skillId: uuid, intent: "takedown", reason: " Spam " })).toEqual({
      skillId: uuid,
      active: false,
      reason: "Spam",
    });
    expect(parseTakedownForm({ skillId: uuid, intent: "reinstate" })).toEqual({
      skillId: uuid,
      active: true,
      reason: undefined,
    });
  });

  it("rejects bad ids and intents", () => {
    expect(() => parseTakedownForm({ skillId: "nope", intent: "takedown" })).toThrow(z.ZodError);
    expect(() => parseTakedownForm({ skillId: uuid, intent: "hide" })).toThrow(z.ZodError);
  });
});

describe("parseDisputeForm", () => {
  it("reads the button intent as the decision, with a ticked confirmation", () => {
    expect(parseDisputeForm({ milestoneId: uuid, intent: "release", confirm: "on" })).toEqual({
      milestoneId: uuid,
      decision: "release",
    });
    expect(() => parseDisputeForm({ milestoneId: uuid, intent: "release" })).toThrow(z.ZodError);
    expect(() => parseDisputeForm({ milestoneId: uuid, intent: "split", confirm: "on" })).toThrow(
      z.ZodError,
    );
  });
});

describe("parseResumeForm", () => {
  it("needs a project id", () => {
    expect(parseResumeForm({ projectId: uuid })).toEqual({ projectId: uuid });
    expect(() => parseResumeForm({ projectId: "nope" })).toThrow(z.ZodError);
  });
});

describe("parseRefundForm", () => {
  it("needs a note and a ticked confirmation", () => {
    expect(parseRefundForm({ jobId: uuid, note: "Duplicate charge", confirm: "on" })).toEqual({
      jobId: uuid,
      note: "Duplicate charge",
    });
    expect(() => parseRefundForm({ jobId: uuid, note: "  ", confirm: "on" })).toThrow(z.ZodError);
    expect(() => parseRefundForm({ jobId: uuid, note: "Duplicate charge" })).toThrow(z.ZodError);
  });
});
