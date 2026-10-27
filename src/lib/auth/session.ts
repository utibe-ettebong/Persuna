import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { cache } from "react";
import { auth } from "./index";
import { matchesList, parseList } from "./policy";

export interface SessionUser {
  id: string;
  name: string;
  email: string;
  isAdmin: boolean;
}

/** The signed-in user for this request, or null. Cached per request. */
export const getUser = cache(async (): Promise<SessionUser | null> => {
  // Read headers first: it marks the page as per-request, so builds never create the auth instance.
  const requestHeaders = await headers();
  const session = await auth().api.getSession({ headers: requestHeaders });
  if (!session) return null;
  const { id, name, email } = session.user;
  return { id, name, email, isAdmin: matchesList(email, parseList(process.env.ADMIN_EMAILS)) };
});

/** The signed-in user; sends anyone else to sign in. */
export async function requireUser(next?: string): Promise<SessionUser> {
  const user = await getUser();
  if (!user) redirect(next ? `/sign-in?next=${encodeURIComponent(next)}` : "/sign-in");
  return user;
}

export async function requireAdmin(): Promise<SessionUser> {
  const user = await requireUser();
  if (!user.isAdmin) redirect("/skills");
  return user;
}

/** How the user appears in the audit log. */
export const actorOf = (user: SessionUser) => `user:${user.email}` as const;
