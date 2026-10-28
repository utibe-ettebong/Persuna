import { eq } from "drizzle-orm";
import { db, schema } from "@/db/client";
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

/** The account behind an id, as a session user (for calls that carry their own proof, like the voice agent's). */
export async function userById(id: string): Promise<SessionUser | null> {
  const user = await db().query.authUsers.findFirst({ where: eq(schema.authUsers.id, id) });
  if (!user) return null;
  const { name, email } = user;
  return { id, name, email, isAdmin: matchesList(email, parseList(process.env.ADMIN_EMAILS)) };
}
