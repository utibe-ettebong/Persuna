import { describe, expect, it } from "vitest";
import { isExcludedApp, modeForTurn, workAutoOffDue } from "./screen-mode";

describe("modeForTurn", () => {
  it("sends work turns as work even without a read", () => {
    expect(modeForTurn(true, false)).toBe("work");
  });

  it("sends a read outside Work mode as a look", () => {
    expect(modeForTurn(false, true)).toBe("look");
  });

  it("sends plain talk as talk", () => {
    expect(modeForTurn(false, false)).toBe("talk");
  });
});

describe("isExcludedApp", () => {
  it("matches whole names, ignoring case and blanks", () => {
    expect(isExcludedApp("1Password", ["1password"])).toBe(true);
    expect(isExcludedApp("  Mail ", ["mail"])).toBe(true);
    expect(isExcludedApp("Mail", ["  "])).toBe(false);
  });

  it("never matches an empty app name", () => {
    expect(isExcludedApp("", ["mail"])).toBe(false);
    expect(isExcludedApp("   ", ["mail"])).toBe(false);
  });

  it("does not match part of a name", () => {
    expect(isExcludedApp("Gmail", ["mail"])).toBe(false);
  });
});

describe("workAutoOffDue", () => {
  it("fires after the quiet minutes pass", () => {
    expect(workAutoOffDue(1_000_000, 1_000_000 - 31 * 60_000, 30)).toBe(true);
    expect(workAutoOffDue(1_000_000, 1_000_000 - 29 * 60_000, 30)).toBe(false);
  });

  it("never fires when set to never", () => {
    expect(workAutoOffDue(1_000_000, 0, 0)).toBe(false);
  });
});
