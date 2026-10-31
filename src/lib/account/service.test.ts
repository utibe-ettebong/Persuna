import { describe, expect, it } from "vitest";
import {
  DELETE_CONFIRMATION,
  deleteBlocker,
  isDeleteConfirmation,
  scrubJobInput,
  scrubListing,
  scrubSkill,
  scrubTransaction,
} from "./service";

describe("isDeleteConfirmation", () => {
  it("accepts only the exact phrase", () => {
    expect(isDeleteConfirmation(DELETE_CONFIRMATION)).toBe(true);
    expect(isDeleteConfirmation("delete everything ")).toBe(true);
    expect(isDeleteConfirmation("delete")).toBe(false);
    expect(isDeleteConfirmation("")).toBe(false);
  });
});

describe("scrubListing", () => {
  it("keeps a sold listing's row but removes the owner's words", () => {
    expect(scrubListing()).toEqual({
      active: false,
      title: "Removed listing",
      description: "The owner deleted their data.",
      sampleOutput: "",
      employerName: null,
      employerEmail: null,
      employerToken: null,
    });
  });
});

describe("scrubJobInput", () => {
  it("removes the renter's words but keeps the job's record", () => {
    expect(scrubJobInput()).toEqual({
      input: "[removed]",
      draft: "[removed]",
      finalOutput: null,
      complaint: null,
      ratingComment: null,
      requesterName: "Deleted user",
    });
  });
});

describe("scrubTransaction", () => {
  it("removes the renter's identity but keeps the money record", () => {
    expect(scrubTransaction()).toEqual({
      renterName: "Deleted user",
      renterEmail: null,
      ratingComment: null,
    });
  });
});

describe("deleteBlocker", () => {
  it("refuses while a payment or milestone is still moving", () => {
    expect(deleteBlocker({ payments: 1, milestones: 0 })).toMatch(/payment/);
    expect(deleteBlocker({ payments: 0, milestones: 2 })).toMatch(/milestone/);
    expect(deleteBlocker({ payments: 0, milestones: 0 })).toBeNull();
  });
});

describe("scrubSkill", () => {
  it("leaves nothing of the owner's method on a kept skill", () => {
    const scrubbed = scrubSkill("abc");
    expect(scrubbed.ownerId).toBeNull();
    expect(scrubbed.interview).toBeNull();
    expect(scrubbed.slug).toBe("removed-abc");
  });
});
