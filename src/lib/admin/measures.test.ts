import { describe, expect, it } from "vitest";
import { categoryOf, latencySummary, percentile, weekOf } from "./measures";

describe("percentile", () => {
  it("picks p50 and p95 off sorted samples", () => {
    const samples = [100, 200, 300, 400, 500, 600, 700, 800, 900, 1000];
    expect(percentile(samples, 50)).toBe(500);
    expect(percentile(samples, 95)).toBe(1000);
    expect(percentile([42], 50)).toBe(42);
  });

  it("returns null without samples", () => {
    expect(percentile([], 50)).toBeNull();
  });
});

describe("latencySummary", () => {
  it("summarises one stage, skipping turns that never marked it", () => {
    expect(latencySummary([100, null, 300, null, 200])).toEqual({ p50: 200, p95: 300, n: 3 });
    expect(latencySummary([null, null])).toEqual({ p50: null, p95: null, n: 0 });
  });
});

describe("weekOf", () => {
  it("buckets days into Monday-starting weeks", () => {
    // Saturday 2026-10-31 and the Monday before share a week.
    expect(weekOf(new Date("2026-10-31T12:00:00Z"))).toBe("2026-10-26");
    expect(weekOf(new Date("2026-10-26T00:00:00Z"))).toBe("2026-10-26");
    expect(weekOf(new Date("2026-10-25T23:59:59Z"))).toBe("2026-10-19");
  });
});

describe("categoryOf", () => {
  it("splits usage roles into model, voice and transcription", () => {
    expect(categoryOf("speech")).toBe("voice");
    expect(categoryOf("transcribe")).toBe("transcription");
    expect(categoryOf("chat")).toBe("model");
    expect(categoryOf("listen")).toBe("model");
  });
});
