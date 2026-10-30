"use server";

import { revalidatePath } from "next/cache";
import { attempt, type ActionState } from "@/lib/action-state";
import {
  parseDisputeForm,
  parseRefundForm,
  parseResumeForm,
  parseTakedownForm,
} from "@/lib/admin/forms";
import { audit } from "@/lib/audit";
import { actorOf, requireAdmin } from "@/lib/auth/session";
import { parseSuspendForm, setSuspended } from "@/lib/auth/users";
import { setListingActive } from "@/lib/market/service";
import { createModelClient } from "@/lib/models";
import { refundForJob } from "@/lib/payments/service";
import { resolveMilestone, resumeProject } from "@/lib/projects/service";

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

/** Takes a listing down or puts it back. Reinstate fails loudly when the listing no longer meets every requirement. */
export async function setListingActiveAction(_: ActionState, form: FormData): Promise<ActionState> {
  return attempt(async () => {
    const admin = await requireAdmin();
    const { skillId, active, reason } = parseTakedownForm(Object.fromEntries(form));
    await setListingActive(skillId, active, actorOf(admin), reason ? { reason } : {});
    revalidatePath("/admin/moderation");
    return "/admin/moderation";
  });
}

/** Settles one disputed milestone: pays the seller or refunds the poster. Needs the confirmation box. */
export async function resolveDisputeAction(_: ActionState, form: FormData): Promise<ActionState> {
  return attempt(async () => {
    const admin = await requireAdmin();
    const { milestoneId, decision } = parseDisputeForm(Object.fromEntries(form));
    await resolveMilestone(createModelClient(), admin, milestoneId, decision);
    revalidatePath("/admin/disputes");
    return "/admin/disputes";
  });
}

/** Ends a dispute and lets the work carry on. */
export async function resumeProjectAction(_: ActionState, form: FormData): Promise<ActionState> {
  return attempt(async () => {
    const admin = await requireAdmin();
    const { projectId } = parseResumeForm(Object.fromEntries(form));
    await resumeProject(admin, projectId);
    revalidatePath("/admin/disputes");
    return "/admin/disputes";
  });
}

/** Refunds a job's payment with a note. Needs the confirmation box. */
export async function refundJobAction(_: ActionState, form: FormData): Promise<ActionState> {
  return attempt(async () => {
    const admin = await requireAdmin();
    const { jobId, note } = parseRefundForm(Object.fromEntries(form));
    const txn = await refundForJob(jobId, note, actorOf(admin));
    if (!txn) throw new Error("Nothing refundable on this job.");
    revalidatePath("/admin/transactions");
    return "/admin/transactions";
  });
}
