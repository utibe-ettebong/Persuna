"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { attempt, slugField, uuidField, type ActionState } from "@/lib/action-state";
import { assertOrderAccess, ownedSkillBySlug } from "@/lib/auth/access";
import { requireUser } from "@/lib/auth/session";
import { readTaskInputs } from "@/lib/docs/read-input";
import { createFileStore } from "@/lib/models/files";
import { complainAboutJob } from "@/lib/jobs/service";
import {
  acceptOrder,
  decideEmployerRequest,
  rentSkill,
  saveListing,
  requestChanges,
  setListingActive,
} from "@/lib/market/service";
import { createModelClient } from "@/lib/models";
import { dollarsField } from "@/lib/money";

const listingForm = z.object({
  skillSlug: slugField,
  title: z.string().trim().min(5, "Give the listing a title").max(120),
  description: z.string().trim().min(20, "Describe what renters get (20+ characters)").max(2000),
  /** Dollars as typed ("12.50"), parsed to cents. */
  price: dollarsField("Price", 100, 100_000_00),
  turnaroundHours: z.coerce.number().int().min(1).max(720),
  sampleOutput: z.string().trim().min(20, "Add an anonymised sample output").max(20_000),
  ownerType: z.enum(["freelancer", "employee", "organisation"]),
  declareOwnership: z.literal("on").optional(),
  premiumReview: z
    .union([z.literal("").transform(() => null), dollarsField("Owner review extra", 0, 100_000_00)])
    .optional()
    .transform((v) => v ?? null),
  employerName: z.string().trim().max(120).optional(),
  employerEmail: z.union([z.literal(""), z.email("Enter a valid employer email")]).optional(),
  visibility: z.enum(["public", "unlisted"]).default("public"),
});

export async function saveListingAction(_: ActionState, form: FormData): Promise<ActionState> {
  return attempt(async () => {
    const { skillSlug, declareOwnership, price, premiumReview, ...fields } = listingForm.parse(
      Object.fromEntries(form),
    );
    const skill = await ownedSkillBySlug(await requireUser(), skillSlug);
    await saveListing(skill.id, {
      ...fields,
      priceCents: price,
      premiumReviewCents: premiumReview,
      declareOwnership: declareOwnership === "on",
    });
    revalidatePath(`/skills/${skillSlug}/listing`);
    return `/skills/${skillSlug}/listing`;
  });
}

export async function toggleListingAction(_: ActionState, form: FormData): Promise<ActionState> {
  return attempt(async () => {
    const skillSlug = slugField.parse(form.get("skillSlug"));
    const skill = await ownedSkillBySlug(await requireUser(), skillSlug);
    await setListingActive(skill.id, form.get("intent") === "activate");
    revalidatePath(`/skills/${skillSlug}/listing`);
    revalidatePath("/market");
    return `/skills/${skillSlug}/listing`;
  });
}

const rentForm = z.object({
  listingId: uuidField,
  renterName: z.string().trim().min(2, "Enter your name").max(80),
  renterEmail: z.email("Enter a valid email for your receipt"),
  inputText: z.string().optional(),
  premiumReview: z.literal("on").optional(),
});

export async function rentAction(_: ActionState, form: FormData): Promise<ActionState> {
  return attempt(async () => {
    const { listingId, renterName, renterEmail, inputText, premiumReview } = rentForm.parse(
      Object.fromEntries(form),
    );
    const user = await requireUser();
    // A renter's files (PDFs, scans, photos, text) are read for them, counted
    // against their daily allowance; typed notes go after them.
    const fromFiles = await readTaskInputs(
      form.getAll("inputFile"),
      createModelClient(user),
      createFileStore(),
    );
    const input = [fromFiles, inputText?.trim()].filter(Boolean).join("\n\n");
    if (!input.trim()) throw new Error("Paste your notes or upload a file.");
    const { jobId, redirectUrl } = await rentSkill(
      createModelClient(await requireUser()),
      listingId,
      {
        renterUserId: user.id,
        renterName,
        renterEmail,
        input,
        premiumReview: premiumReview === "on",
      },
    );
    revalidatePath("/jobs");
    revalidatePath("/earnings");
    // With Paystack the renter pays on Paystack's checkout, which returns them to the order.
    return redirectUrl ?? `/market/orders/${jobId}`;
  });
}

export async function complainAction(_: ActionState, form: FormData): Promise<ActionState> {
  return attempt(async () => {
    const jobId = uuidField.parse(form.get("jobId"));
    const complaint = z
      .string()
      .max(1000)
      .parse(form.get("complaint") ?? "");
    if (!(await assertOrderAccess(await requireUser(), jobId)).requester) {
      throw new Error("Only the renter who placed this order can report a problem");
    }
    await complainAboutJob(jobId, complaint);
    revalidatePath("/earnings");
    return `/market/orders/${jobId}`;
  });
}

const employerForm = z.object({
  token: z.string().min(20).max(100),
  intent: z.enum(["approved", "declined"]),
  sharePercent: z.coerce.number().int().min(0, "0–100%").max(100, "0–100%").default(0),
});

export async function employerDecisionAction(_: ActionState, form: FormData): Promise<ActionState> {
  return attempt(async () => {
    const { token, intent, sharePercent } = employerForm.parse(Object.fromEntries(form));
    await decideEmployerRequest(token, intent, sharePercent);
    return `/approvals/${token}`;
  });
}

const acceptForm = z.object({
  jobId: uuidField,
  rating: z.coerce.number().int().min(1, "Choose a rating").max(5),
  comment: z.string().max(1000).default(""),
});

export async function acceptOrderAction(_: ActionState, form: FormData): Promise<ActionState> {
  return attempt(async () => {
    const { jobId, rating, comment } = acceptForm.parse(Object.fromEntries(form));
    if (!(await assertOrderAccess(await requireUser(), jobId)).requester) {
      throw new Error("Only the renter who placed this order can accept it");
    }
    await acceptOrder(jobId, rating, comment);
    revalidatePath("/earnings");
    return `/market/orders/${jobId}`;
  });
}

const changesForm = z.object({
  jobId: uuidField,
  request: z.string().trim().min(5, "Say what you'd like changed").max(2000),
});

/** The renter asks for changes to a delivered result. */
export async function requestChangesAction(_: ActionState, form: FormData): Promise<ActionState> {
  return attempt(async () => {
    const { jobId, request } = changesForm.parse(Object.fromEntries(form));
    const user = await requireUser();
    if (!(await assertOrderAccess(user, jobId)).requester) {
      throw new Error("Only the renter who placed this order can ask for changes");
    }
    await requestChanges(createModelClient(user), jobId, request);
    revalidatePath("/jobs");
    return `/market/orders/${jobId}`;
  });
}
