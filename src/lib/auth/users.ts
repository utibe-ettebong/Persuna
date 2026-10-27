import { eq } from "drizzle-orm";
import { db, schema } from "@/db/client";

/** The account id for an email, for scripts that assign skills to an owner. */
export async function userIdByEmail(email: string): Promise<string> {
  const user = await db().query.authUsers.findFirst({
    where: eq(schema.authUsers.email, email.trim().toLowerCase()),
  });
  if (!user) throw new Error(`No account for ${email}. Sign up in the app first.`);
  return user.id;
}
