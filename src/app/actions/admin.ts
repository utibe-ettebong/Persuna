"use server";

import { revalidatePath } from "next/cache";
import { unstable_rethrow } from "next/navigation";
import { after } from "next/server";
import { z } from "zod";
import { attempt, type ActionState } from "@/lib/action-state";
import {
  parseCatalogEntryForm,
  parseCatalogToggleForm,
  parseDeleteEntryForm,
  parseDisputeForm,
  parseProbeForm,
  parseRefundForm,
  parseResumeForm,
  parseRetryImportForm,
  parseRevertForm,
  parseRevokeKeyForm,
  parseSelectForm,
  parseTakedownForm,
} from "@/lib/admin/forms";
import { audit } from "@/lib/audit";
import { actorOf, requireAdmin } from "@/lib/auth/session";
import { parseSuspendForm, setSuspended } from "@/lib/auth/users";
import { setListingActive } from "@/lib/market/service";
import { createModelClient } from "@/lib/models";
import {
  addCatalogEntry,
  deleteCatalogEntry,
  getCatalogEntry,
  probeModel,
  revertRole,
  selectModel,
  setCatalogEnabled,
} from "@/lib/models/selection";
import { refundForJob } from "@/lib/payments/service";
import { resolveMilestone, resumeProject } from "@/lib/projects/service";
import { processImport, retryAnyImport, revokeAnyAgentKey } from "@/lib/agents/service";

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

/** Catalogs a model id for a role. */
export async function addCatalogEntryAction(_: ActionState, form: FormData): Promise<ActionState> {
  return attempt(async () => {
    const admin = await requireAdmin();
    const input = parseCatalogEntryForm(Object.fromEntries(form));
    await addCatalogEntry(input, actorOf(admin));
    revalidatePath("/admin/models");
    return "/admin/models";
  });
}

/** Enables or disables a catalog entry. Disabling the selected one falls back to env. */
export async function setCatalogEnabledAction(
  _: ActionState,
  form: FormData,
): Promise<ActionState> {
  return attempt(async () => {
    const admin = await requireAdmin();
    const { entryId, enabled } = parseCatalogToggleForm(Object.fromEntries(form));
    await setCatalogEnabled(entryId, enabled, actorOf(admin));
    revalidatePath("/admin/models");
    return "/admin/models";
  });
}

/** Deletes a catalog entry. Deleting the selected one reverts its role to env. */
export async function deleteCatalogEntryAction(
  _: ActionState,
  form: FormData,
): Promise<ActionState> {
  return attempt(async () => {
    const admin = await requireAdmin();
    const { entryId } = parseDeleteEntryForm(Object.fromEntries(form));
    await deleteCatalogEntry(entryId, actorOf(admin));
    revalidatePath("/admin/models");
    return "/admin/models";
  });
}

/** Points a role at a catalog entry, after probing that the id works there. */
export async function selectModelAction(_: ActionState, form: FormData): Promise<ActionState> {
  return attempt(async () => {
    const admin = await requireAdmin();
    const { role, entryId } = parseSelectForm(Object.fromEntries(form));
    const entry = await getCatalogEntry(entryId);
    if (!entry || entry.role !== role) throw new Error("No such catalog entry for that role.");
    const probed = await probeModel({ role, model: entry.model });
    if (!probed.ok) throw new Error(`Probe failed, nothing saved: ${probed.detail}`);
    await selectModel(role, entryId, actorOf(admin));
    revalidatePath("/admin/models");
    return "/admin/models";
  });
}

/** Drops a role's selection; env settings serve it again. */
export async function revertRoleAction(_: ActionState, form: FormData): Promise<ActionState> {
  return attempt(async () => {
    const admin = await requireAdmin();
    const { role } = parseRevertForm(Object.fromEntries(form));
    await revertRole(role, actorOf(admin));
    revalidatePath("/admin/models");
    return "/admin/models";
  });
}

export interface ProbeState {
  error: string | null;
  result: string | null;
}

/** Tests a model id against its role's live settings without saving anything. */
export async function probeModelAction(_: ProbeState, form: FormData): Promise<ProbeState> {
  try {
    await requireAdmin();
    const { role, model } = parseProbeForm(Object.fromEntries(form));
    const probed = await probeModel({ role, model });
    return probed.ok
      ? { error: null, result: probed.detail }
      : { error: probed.detail, result: null };
  } catch (error) {
    unstable_rethrow(error);
    console.error(error);
    if (error instanceof z.ZodError)
      return { error: error.issues[0]?.message ?? "Invalid input.", result: null };
    return {
      error: error instanceof Error ? error.message : "Something went wrong.",
      result: null,
    };
  }
}

/** Revokes any account's agent key. */
export async function revokeAnyAgentKeyAction(
  _: ActionState,
  form: FormData,
): Promise<ActionState> {
  return attempt(async () => {
    const admin = await requireAdmin();
    const { keyId } = parseRevokeKeyForm(Object.fromEntries(form));
    await revokeAnyAgentKey(keyId, actorOf(admin));
    revalidatePath("/admin/agents");
    return "/admin/agents";
  });
}

/** Retries any account's failed import and retriggers processing. */
export async function retryAnyImportAction(_: ActionState, form: FormData): Promise<ActionState> {
  return attempt(async () => {
    const admin = await requireAdmin();
    const { importId } = parseRetryImportForm(Object.fromEntries(form));
    await retryAnyImport(importId, actorOf(admin));
    after(async () => {
      await processImport(importId).catch((e) => console.error("Agent import failed:", e));
    });
    revalidatePath("/admin/agents");
    return "/admin/agents";
  });
}
