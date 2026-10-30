import { count, desc, eq, gte, sql } from "drizzle-orm";
import { db, schema } from "@/db/client";
import { startOfUtcDay } from "./stats";
import { fillDaySeries, type DayPoint } from "./rules";

export interface RoleUsage {
  role: string;
  calls: number;
}

/** Model calls grouped by role, most-used first, optionally since a date. Admins only. */
export async function usageByRole(since?: Date): Promise<RoleUsage[]> {
  const rows = await db()
    .select({ role: schema.modelUsage.role, calls: count() })
    .from(schema.modelUsage)
    .where(since ? gte(schema.modelUsage.at, since) : undefined)
    .groupBy(schema.modelUsage.role);
  return rows
    .map((r) => ({ role: r.role, calls: r.calls }))
    .sort((a, b) => b.calls - a.calls || a.role.localeCompare(b.role));
}

export interface UserUsage {
  userId: string;
  name: string;
  email: string;
  calls: number;
}

/** Heaviest model users, most calls first. Admins only. */
export async function topUsersByUsage(limit = 20): Promise<UserUsage[]> {
  const rows = await db()
    .select({
      userId: schema.authUsers.id,
      name: schema.authUsers.name,
      email: schema.authUsers.email,
      calls: count(),
    })
    .from(schema.modelUsage)
    .innerJoin(schema.authUsers, eq(schema.modelUsage.userId, schema.authUsers.id))
    .groupBy(schema.authUsers.id, schema.authUsers.name, schema.authUsers.email);
  return rows
    .map((r) => ({ userId: r.userId, name: r.name, email: r.email, calls: r.calls }))
    .sort((a, b) => b.calls - a.calls)
    .slice(0, limit);
}

/** Model calls per day for the last `days` days, zero-filled. Admins only. */
export async function dailyUsage(days = 14, now = new Date()): Promise<DayPoint[]> {
  const start = startOfUtcDay(new Date(now.getTime() - (days - 1) * 86_400_000));
  const day = sql<string>`to_char(${schema.modelUsage.at}, 'YYYY-MM-DD')`;
  const rows = await db()
    .select({ day, calls: count() })
    .from(schema.modelUsage)
    .where(gte(schema.modelUsage.at, start))
    .groupBy(day)
    .orderBy(desc(day));
  return fillDaySeries(
    rows.map((r) => ({ day: r.day, calls: Number(r.calls) })),
    days,
    now,
  );
}
