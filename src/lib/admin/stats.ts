import { and, count, eq, gte, inArray, sql } from "drizzle-orm";
import { db, schema } from "@/db/client";

export interface PlatformStats {
  users: number;
  liveListings: number;
  openProjects: number;
  disputedProjects: number;
  /** US cents currently held in renter escrow (USD only; pre-switch naira excluded). */
  escrowHeldCents: number;
  modelCallsToday: number;
}

/** Midnight UTC of the given day, for "today" counts. */
export function startOfUtcDay(now = new Date()): Date {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
}

const tally = (rows: Promise<{ n: number }[]>) => rows.then((found) => found[0]?.n ?? 0);

/** Platform-wide counts for the admin overview. Admins only. */
export async function platformStats(now = new Date()): Promise<PlatformStats> {
  const { authUsers, listings, projects, transactions, modelUsage } = schema;
  const [users, liveListings, openProjects, disputedProjects, held, calls] = await Promise.all([
    tally(db().select({ n: count() }).from(authUsers)),
    tally(db().select({ n: count() }).from(listings).where(eq(listings.active, true))),
    tally(
      db()
        .select({ n: count() })
        .from(projects)
        .where(inArray(projects.status, ["open", "in_progress"])),
    ),
    tally(db().select({ n: count() }).from(projects).where(eq(projects.status, "disputed"))),
    db()
      .select({ total: sql<number>`coalesce(sum(${transactions.ownerShareCents}), 0)` })
      .from(transactions)
      .where(and(eq(transactions.status, "held"), eq(transactions.currency, "USD")))
      .then((found) => Number(found[0]?.total ?? 0)),
    tally(
      db()
        .select({ n: count() })
        .from(modelUsage)
        .where(gte(modelUsage.at, startOfUtcDay(now))),
    ),
  ]);
  return {
    users,
    liveListings,
    openProjects,
    disputedProjects,
    escrowHeldCents: held,
    modelCallsToday: calls,
  };
}
