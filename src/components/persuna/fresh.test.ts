import { describe, expect, it } from "vitest";
import { QUIET_MS, shouldRefresh } from "./fresh";

describe("shouldRefresh", () => {
  it("reloads onto a new build when nothing is going on", () => {
    expect(shouldRefresh("old", "new", QUIET_MS, false)).toBe(true);
  });

  it("waits while you're talking, or were just now", () => {
    expect(shouldRefresh("old", "new", QUIET_MS, true)).toBe(false);
    expect(shouldRefresh("old", "new", QUIET_MS - 1, false)).toBe(false);
  });

  it("stays put on the same build, or when either build is unknown", () => {
    expect(shouldRefresh("same", "same", QUIET_MS, false)).toBe(false);
    expect(shouldRefresh(null, "new", QUIET_MS, false)).toBe(false);
    expect(shouldRefresh("old", null, QUIET_MS, false)).toBe(false);
    expect(shouldRefresh("old", undefined, QUIET_MS, false)).toBe(false);
  });
});
