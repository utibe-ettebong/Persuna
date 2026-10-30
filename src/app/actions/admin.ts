"use server";

import { revalidatePath } from "next/cache";
import { attempt, type ActionState } from "@/lib/action-state";
import { audit } from "@/lib/audit";
import { actorOf, requireAdmin } from "@/lib/auth/session";
import { parseSuspendForm, setSuspended } from "@/lib/auth/users";

const USERS = "/admin/users";

/** Suspends or reinstates an account. Admins only; every change is audited. */
export async function setSuspendedAction(_: ActionState, form: FormData): Promise<ActionState> {
  return attempt(async () => {
    const admin = await requireAdmin();
    const { userId, suspended } = parseSuspendForm(Object.fromEntries(form));
    if (userId === admin.id) throw new Error("You can't suspend your own account.");
    await setSuspended(userId, suspended);
    await audit({
      actor: actorOf(admin),
      action: suspended ? "user.suspended" : "user.unsuspended",
      entityType: "user",
      entityId: userId,
    });
    revalidatePath(USERS);
    return `${USERS}/${encodeURIComponent(userId)}`;
  });
}
