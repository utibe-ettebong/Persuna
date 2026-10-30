import { describe, expect, it } from "vitest";
import { startOfUtcDay } from "./stats";

describe("startOfUtcDay", () => {
  it("returns midnight UTC of the given day", () => {
    expect(startOfUtcDay(new Date("2026-10-30T15:24:10+01:00"))).toEqual(
      new Date("2026-10-30T00:00:00.000Z"),
    );
  });

  it("defaults to today at midnight UTC", () => {
    const at = startOfUtcDay();
    expect(at.getUTCHours()).toBe(0);
    expect(at.getUTCMinutes()).toBe(0);
    expect(at.toISOString()).toMatch(/T00:00:00\.000Z$/);
  });
});
