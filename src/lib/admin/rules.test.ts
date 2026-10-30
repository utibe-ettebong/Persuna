import { describe, expect, it } from "vitest";
import { agentKeyStatus, disputeTotals, fillDaySeries, listingStatus } from "./rules";

describe("listingStatus", () => {
  it("reads one status from three fields", () => {
    expect(listingStatus({ active: true, visibility: "public", pausedAt: null })).toBe("live");
    expect(listingStatus({ active: true, visibility: "unlisted", pausedAt: null })).toBe(
      "unlisted",
    );
    expect(listingStatus({ active: false, visibility: "public", pausedAt: new Date() })).toBe(
      "paused",
    );
    expect(listingStatus({ active: false, visibility: "public", pausedAt: null })).toBe("inactive");
  });
});

describe("disputeTotals", () => {
  it("splits held from settled money", () => {
    expect(
      disputeTotals([
        { status: "funded", amountCents: 5000 },
        { status: "submitted", amountCents: 3000 },
        { status: "released", amountCents: 2000 },
        { status: "refunded", amountCents: 1000 },
        { status: "pending", amountCents: 9000 },
      ]),
    ).toEqual({ held: 2, settled: 2, heldCents: 8000 });
  });

  it("starts empty", () => {
    expect(disputeTotals([])).toEqual({ held: 0, settled: 0, heldCents: 0 });
  });
});

describe("agentKeyStatus", () => {
  it("reads revoked, unused and active keys", () => {
    expect(agentKeyStatus({ revokedAt: new Date(), lastUsedAt: new Date() })).toBe("revoked");
    expect(agentKeyStatus({ revokedAt: null, lastUsedAt: null })).toBe("unused");
    expect(agentKeyStatus({ revokedAt: null, lastUsedAt: new Date() })).toBe("active");
  });
});

describe("fillDaySeries", () => {
  it("zero-fills missing days in order", () => {
    expect(
      fillDaySeries([{ day: "2026-10-28", calls: 4 }], 3, new Date("2026-10-30T12:00:00Z")),
    ).toEqual([
      { day: "2026-10-28", calls: 4 },
      { day: "2026-10-29", calls: 0 },
      { day: "2026-10-30", calls: 0 },
    ]);
  });

  it("ignores points outside the window", () => {
    expect(
      fillDaySeries(
        [
          { day: "2026-01-01", calls: 9 },
          { day: "2026-10-30", calls: 2 },
        ],
        1,
        new Date("2026-10-30T12:00:00Z"),
      ),
    ).toEqual([{ day: "2026-10-30", calls: 2 }]);
  });
});
