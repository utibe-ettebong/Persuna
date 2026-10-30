import { describe, expect, it } from "vitest";
import { z } from "zod";
import {
  parseCatalogEntryForm,
  parseCatalogToggleForm,
  parseDeleteEntryForm,
  parseDisputeForm,
  parseProbeForm,
  parseRefundForm,
  parseResumeForm,
  parseRetryImportForm,
  parseRevertForm,
  parseRevokeKeyForm,
  parseSelectForm,
  parseTakedownForm,
} from "./forms";

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

describe("catalog forms", () => {
  it("reads entries, selections and reverts", () => {
    expect(
      parseCatalogEntryForm({ role: "draft", label: "Spark 1.3", model: "muse-spark-1.3" }),
    ).toEqual({ role: "draft", label: "Spark 1.3", model: "muse-spark-1.3" });
    expect(parseSelectForm({ role: "draft", entryId: uuid })).toEqual({
      role: "draft",
      entryId: uuid,
    });
    expect(parseRevertForm({ role: "draft" })).toEqual({ role: "draft" });
    expect(parseCatalogToggleForm({ entryId: uuid, intent: "disable" })).toEqual({
      entryId: uuid,
      enabled: false,
    });
    expect(parseDeleteEntryForm({ entryId: uuid })).toEqual({ entryId: uuid });
    expect(parseProbeForm({ role: "speech", model: "v" })).toEqual({ role: "speech", model: "v" });
  });

  it("rejects unknown roles and ids", () => {
    expect(() => parseCatalogEntryForm({ role: "writer", label: "x", model: "y" })).toThrow(
      z.ZodError,
    );
    expect(() => parseSelectForm({ role: "draft", entryId: "nope" })).toThrow(z.ZodError);
    expect(() => parseCatalogEntryForm({ role: "draft", label: "x", model: "y" })).toThrow(
      z.ZodError,
    );
  });
});

describe("agent forms", () => {
  it("needs key and import ids", () => {
    expect(parseRevokeKeyForm({ keyId: uuid })).toEqual({ keyId: uuid });
    expect(parseRetryImportForm({ importId: uuid })).toEqual({ importId: uuid });
    expect(() => parseRevokeKeyForm({ keyId: "nope" })).toThrow(z.ZodError);
    expect(() => parseRetryImportForm({})).toThrow(z.ZodError);
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
