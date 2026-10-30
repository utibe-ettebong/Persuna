import { count, desc, eq, ilike, or } from "drizzle-orm";
import { z } from "zod";
import { db, schema } from "@/db/client";
import type { AuthUser } from "@/db/schema";
import { matchesList, parseList } from "./policy";
import type { SessionUser } from "./session";

/** The account id for an email, for scripts that assign skills to an owner. */
export async function userIdByEmail(email: string): Promise<string> {
  const user = await db().query.authUsers.findFirst({
    where: eq(schema.authUsers.email, email.trim().toLowerCase()),
  });
  if (!user) throw new Error(`No account for ${email}. Sign up in the app first.`);
  return user.id;
}

/**
 * The account behind an id, as a session user (for calls that carry their own
 * proof, like the voice agent's). Suspended accounts read as unknown, so
 * their calls fail closed wherever this is used.
 */
export async function userById(id: string): Promise<SessionUser | null> {
  const user = await db().query.authUsers.findFirst({ where: eq(schema.authUsers.id, id) });
  if (!user || user.suspended) return null;
  const { name, email } = user;
  return { id, name, email, isAdmin: matchesList(email, parseList(process.env.ADMIN_EMAILS)) };
}

/** The account row as-is, including suspended accounts. Admin tooling only. */
export async function getUserRecord(id: string): Promise<AuthUser | null> {
  return (await db().query.authUsers.findFirst({ where: eq(schema.authUsers.id, id) })) ?? null;
}

/** Whether the account is suspended. Missing accounts count as active. */
export async function isSuspended(id: string): Promise<boolean> {
  const user = await db().query.authUsers.findFirst({
    where: eq(schema.authUsers.id, id),
    columns: { suspended: true },
  });
  return user?.suspended ?? false;
}

/** Suspends or reinstates an account. Throws when there is no such user. */
export async function setSuspended(userId: string, suspended: boolean): Promise<void> {
  const [row] = await db()
    .update(schema.authUsers)
    .set({ suspended })
    .where(eq(schema.authUsers.id, userId))
    .returning({ id: schema.authUsers.id });
  if (!row) throw new Error("No such user");
}

/** Accounts per admin users page. */
export const USER_PAGE_SIZE = 50;

export interface UserListQuery {
  search?: string;
  page: number;
}

/** List query from URL params. Never throws: bad values fall back to defaults. */
export function parseUserListQuery(input: { q?: unknown; page?: unknown }): UserListQuery {
  const search =
    typeof input.q === "string" && input.q.trim() ? input.q.trim().slice(0, 120) : undefined;
  const raw =
    typeof input.page === "string" || typeof input.page === "number" ? Number(input.page) : NaN;
  const page = Number.isSafeInteger(raw) && (raw as number) >= 1 ? Math.floor(raw as number) : 1;
  return { search, page };
}

/** Escapes LIKE wildcards in admin-typed search text. */
export function escapeLike(value: string): string {
  return value.replace(/[\\%_]/g, (c) => `\\${c}`);
}

export interface UserListItem {
  id: string;
  name: string;
  email: string;
  suspended: boolean;
  createdAt: Date;
}

/** Every account, newest first, optionally searched by name or email. Admins only. */
export async function listUsers(
  query: UserListQuery,
): Promise<{ rows: UserListItem[]; total: number }> {
  const pattern = query.search ? `%${escapeLike(query.search)}%` : null;
  const where = pattern
    ? or(ilike(schema.authUsers.name, pattern), ilike(schema.authUsers.email, pattern))
    : undefined;
  const [rows, total] = await Promise.all([
    db()
      .select({
        id: schema.authUsers.id,
        name: schema.authUsers.name,
        email: schema.authUsers.email,
        suspended: schema.authUsers.suspended,
        createdAt: schema.authUsers.createdAt,
      })
      .from(schema.authUsers)
      .where(where)
      .orderBy(desc(schema.authUsers.createdAt))
      .limit(USER_PAGE_SIZE)
      .offset((query.page - 1) * USER_PAGE_SIZE),
    db()
      .select({ n: count() })
      .from(schema.authUsers)
      .where(where)
      .then((found) => found[0]?.n ?? 0),
  ]);
  return { rows, total };
}

/** What one account owns and has used. Admin user detail only. */
export async function userOverview(userId: string): Promise<{
  record: AuthUser;
  counts: Record<"skills" | "jobsOrdered" | "projectsPosted" | "modelCalls", number>;
} | null> {
  const record = await getUserRecord(userId);
  if (!record) return null;
  const { skills, jobs, projects, modelUsage } = schema;
  const tally = (rows: Promise<{ n: number }[]>) => rows.then((found) => found[0]?.n ?? 0);
  const [owned, ordered, posted, calls] = await Promise.all([
    tally(db().select({ n: count() }).from(skills).where(eq(skills.ownerId, userId))),
    tally(db().select({ n: count() }).from(jobs).where(eq(jobs.requesterUserId, userId))),
    tally(db().select({ n: count() }).from(projects).where(eq(projects.posterId, userId))),
    tally(db().select({ n: count() }).from(modelUsage).where(eq(modelUsage.userId, userId))),
  ]);
  return {
    record,
    counts: { skills: owned, jobsOrdered: ordered, projectsPosted: posted, modelCalls: calls },
  };
}

const suspendForm = z.object({
  userId: z.string().min(1, "Missing user."),
  intent: z.enum(["suspend", "unsuspend"]),
});

/** The suspend form's intent as a boolean. Throws ZodError on bad input. */
export function parseSuspendForm(input: unknown): { userId: string; suspended: boolean } {
  const parsed = suspendForm.parse(input);
  return { userId: parsed.userId, suspended: parsed.intent === "suspend" };
}
