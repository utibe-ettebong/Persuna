import { HELD } from "@/lib/projects/rules";

/** What an admin sees for a listing: one status from three fields. */
export type ListingStatus = "live" | "unlisted" | "paused" | "inactive";

export function listingStatus(listing: {
  active: boolean;
  visibility: string;
  pausedAt: Date | null;
}): ListingStatus {
  if (!listing.active) return listing.pausedAt ? "paused" : "inactive";
  return listing.visibility === "unlisted" ? "unlisted" : "live";
}

export interface DisputeTotals {
  held: number;
  settled: number;
  heldCents: number;
}

/** How much of a dispute is still held vs already settled. */
export function disputeTotals(
  milestones: { status: string; amountCents: number }[],
): DisputeTotals {
  const held = milestones.filter((m) => (HELD as string[]).includes(m.status));
  const settled = milestones.filter((m) => m.status === "released" || m.status === "refunded");
  return {
    held: held.length,
    settled: settled.length,
    heldCents: held.reduce((n, m) => n + m.amountCents, 0),
  };
}

export interface DayPoint {
  day: string;
  calls: number;
}

/** Fills missing days with zeroes so usage series render without gaps. */
export function fillDaySeries(points: DayPoint[], days: number, today = new Date()): DayPoint[] {
  const have = new Map(points.map((p) => [p.day, p.calls]));
  const out: DayPoint[] = [];
  for (let i = days - 1; i >= 0; i--) {
    const at = new Date(
      Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate() - i),
    );
    const day = at.toISOString().slice(0, 10);
    out.push({ day, calls: have.get(day) ?? 0 });
  }
  return out;
}
