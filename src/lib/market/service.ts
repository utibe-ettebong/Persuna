/**
 * Marketplace: listings, the ownership and employer-approval gates, renting a
 * skill per task, escrow held until the renter accepts, then released to the
 * owner (and employer) minus the platform fee.
 *
 * Payments run through PAYMENTS_PROVIDER: "mock" records the ledger only;
 * "paystack" collects real money and refunds through Paystack. Payouts to
 * owners are recorded here and settled from the Paystack dashboard.
 */
import { randomBytes } from "node:crypto";
import { and, desc, eq } from "drizzle-orm";
import { db, schema } from "@/db/client";
import { env, paystackConfig } from "@/env";
import { audit } from "@/lib/audit";
import { createJob, draftJob, openJob } from "@/lib/jobs/service";
import type { ModelClient } from "@/lib/models/gateway";
import { createPaystack } from "@/lib/payments/paystack";
import { NotFoundError, publishedScore } from "@/lib/skill/service";
import { listingRequirements, splitPayment } from "./rules";

const { listings, skills, jobs, transactions } = schema;

export interface ListingInput {
  title: string;
  description: string;
  priceNgn: number;
  turnaroundHours: number;
  sampleOutput: string;
  ownerType: "freelancer" | "employee" | "organisation";
  declareOwnership: boolean;
  premiumReviewNgn?: number | null;
  employerName?: string;
  employerEmail?: string;
}

export async function getListingForSkill(skillId: string) {
  return (await db().query.listings.findFirst({ where: eq(listings.skillId, skillId) })) ?? null;
}

export async function saveListing(skillId: string, input: ListingInput) {
  const existing = await getListingForSkill(skillId);
  const ownershipDeclaredAt = input.declareOwnership
    ? (existing?.ownershipDeclaredAt ?? new Date())
    : null;

  // Employee listings need the employer's sign-off. Changing the employer starts it again.
  let employer = {
    employerName: null as string | null,
    employerEmail: null as string | null,
    employerToken: null as string | null,
    employerDecision: null as "pending" | "approved" | "declined" | null,
    employerDecidedAt: null as Date | null,
    employerSharePercent: null as number | null,
  };
  if (input.ownerType === "employee") {
    const name = input.employerName?.trim();
    const email = input.employerEmail?.trim().toLowerCase();
    if (!name || !email) throw new Error("Add your employer's name and email for their approval");
    const same =
      existing?.ownerType === "employee" &&
      existing.employerName === name &&
      existing.employerEmail === email &&
      existing.employerToken;
    employer = same
      ? {
          employerName: name,
          employerEmail: email,
          employerToken: existing.employerToken,
          employerDecision: existing.employerDecision,
          employerDecidedAt: existing.employerDecidedAt,
          employerSharePercent: existing.employerSharePercent,
        }
      : {
          employerName: name,
          employerEmail: email,
          employerToken: randomBytes(24).toString("base64url"),
          employerDecision: "pending",
          employerDecidedAt: null,
          employerSharePercent: null,
        };
  }

  const values = {
    title: input.title,
    description: input.description,
    priceNgn: input.priceNgn,
    turnaroundHours: input.turnaroundHours,
    sampleOutput: input.sampleOutput,
    ownerType: input.ownerType,
    ownershipDeclaredAt,
    premiumReviewNgn: input.premiumReviewNgn ?? null,
    ...employer,
    updatedAt: new Date(),
  };
  const [row] = existing
    ? await db().update(listings).set(values).where(eq(listings.id, existing.id)).returning()
    : await db()
        .insert(listings)
        .values({ ...values, skillId })
        .returning();

  const blocked =
    !ownershipDeclaredAt || (row.ownerType === "employee" && row.employerDecision !== "approved");
  if (blocked && row.active) {
    await db().update(listings).set({ active: false }).where(eq(listings.id, row.id));
  }
  await audit({
    actor: "owner",
    action: existing ? "listing.updated" : "listing.created",
    entityType: "listing",
    entityId: row.id,
    skillId,
    details: {
      priceNgn: row.priceNgn,
      ownerType: row.ownerType,
      ownershipDeclared: Boolean(ownershipDeclaredAt),
      employerApprovalRequested:
        employer.employerDecision === "pending" && !existing?.employerToken,
    },
  });
  return row;
}

export async function readiness(skillId: string) {
  const skill = await db().query.skills.findFirst({ where: eq(skills.id, skillId) });
  if (!skill) throw new NotFoundError("No such skill");
  const listing = await getListingForSkill(skillId);
  const score = await publishedScore(skill);
  const requirements = listingRequirements({
    hasPublishedVersion: Boolean(skill.publishedVersionId),
    publishedScore: score,
    ownershipDeclared: Boolean(listing?.ownershipDeclaredAt),
    minScore: env().LISTING_MIN_SCORE,
    employerApproved:
      listing?.ownerType === "employee" ? listing.employerDecision === "approved" : undefined,
  });
  return { skill, listing, score, requirements, ready: requirements.every((r) => r.met) };
}

export async function setListingActive(skillId: string, active: boolean) {
  const { listing, ready } = await readiness(skillId);
  if (!listing) throw new Error("Save the listing first");
  if (active && !ready) throw new Error("The listing doesn't meet every requirement yet");
  await db()
    .update(listings)
    .set({ active, updatedAt: new Date() })
    .where(eq(listings.id, listing.id));
  await audit({
    actor: "owner",
    action: active ? "listing.activated" : "listing.deactivated",
    entityType: "listing",
    entityId: listing.id,
    skillId,
  });
}

/* ---------- Employer approval ---------- */

export async function getEmployerRequest(token: string) {
  const [row] = await db()
    .select({ listing: listings, skill: skills })
    .from(listings)
    .innerJoin(skills, eq(listings.skillId, skills.id))
    .where(and(eq(listings.employerToken, token), eq(listings.ownerType, "employee")));
  if (!row) throw new NotFoundError("This approval link isn't valid");
  return row;
}

/** The employer approves (setting their share of earnings) or declines. */
export async function decideEmployerRequest(
  token: string,
  decision: "approved" | "declined",
  sharePercent: number,
) {
  const { listing } = await getEmployerRequest(token);
  if (
    decision === "approved" &&
    (!Number.isInteger(sharePercent) || sharePercent < 0 || sharePercent > 100)
  ) {
    throw new Error("Set a share between 0 and 100%");
  }
  await db()
    .update(listings)
    .set({
      employerDecision: decision,
      employerDecidedAt: new Date(),
      employerSharePercent: decision === "approved" ? sharePercent : null,
      ...(decision === "declined" ? { active: false } : {}),
    })
    .where(eq(listings.id, listing.id));
  await audit({
    actor: "employer",
    action: `employer.${decision}`,
    entityType: "listing",
    entityId: listing.id,
    skillId: listing.skillId,
    details: {
      employer: listing.employerName,
      sharePercent: decision === "approved" ? sharePercent : null,
    },
  });
}

/* ---------- Browsing ---------- */

export async function listActiveListings() {
  const rows = await db()
    .select({ listing: listings, skill: skills })
    .from(listings)
    .innerJoin(skills, eq(listings.skillId, skills.id))
    .where(eq(listings.active, true))
    .orderBy(desc(listings.updatedAt));
  return Promise.all(rows.map(async (r) => ({ ...r, score: await publishedScore(r.skill) })));
}

export async function getActiveListing(listingId: string) {
  const [row] = await db()
    .select({ listing: listings, skill: skills })
    .from(listings)
    .innerJoin(skills, eq(listings.skillId, skills.id))
    .where(and(eq(listings.id, listingId), eq(listings.active, true)));
  if (!row) throw new NotFoundError("This listing isn't available");
  return { ...row, score: await publishedScore(row.skill) };
}

/* ---------- Renting and payment ---------- */

export interface RentInput {
  renterName: string;
  renterEmail: string;
  input: string;
  premiumReview: boolean;
}

/**
 * A renter submits a task. With mock payments the job is drafted at once and
 * the payment recorded as held. With Paystack the job waits for payment and
 * the renter is sent to Paystack's checkout.
 */
export async function rentSkill(
  client: ModelClient,
  listingId: string,
  rent: RentInput,
): Promise<{ jobId: string; redirectUrl: string | null }> {
  const { listing, skill } = await getActiveListing(listingId);
  const { ready } = await readiness(skill.id);
  if (!ready) throw new Error("This listing isn't available right now");
  const premium = rent.premiumReview && listing.premiumReviewNgn != null;
  const amount = listing.priceNgn + (premium ? (listing.premiumReviewNgn ?? 0) : 0);
  const split = splitPayment(
    amount,
    env().PLATFORM_FEE_PERCENT,
    listing.ownerType === "employee" ? (listing.employerSharePercent ?? 0) : 0,
  );
  const job = {
    skillId: skill.id,
    origin: "renter" as const,
    requesterName: rent.renterName,
    input: rent.input,
    ownerReviewRequired: premium,
  };
  const ledger = {
    listingId,
    renterName: rent.renterName.trim(),
    renterEmail: rent.renterEmail.trim().toLowerCase(),
    premiumReview: premium,
    ...split,
  };

  const paystack = paystackConfig();
  if (!paystack) {
    const row = await createJob(client, job);
    const [txn] = await db()
      .insert(transactions)
      .values({ ...ledger, jobId: row.id, provider: "mock", status: "held" })
      .returning();
    await auditPayment("payment.held", txn.id, skill.id, { amountNgn: amount, provider: "mock" });
    return { jobId: row.id, redirectUrl: null };
  }

  const row = await openJob(job, "awaiting_payment");
  const reference = `persuna-${row.id}`;
  const [txn] = await db()
    .insert(transactions)
    .values({
      ...ledger,
      jobId: row.id,
      provider: "paystack",
      providerReference: reference,
      status: "pending",
    })
    .returning();
  const { authorizationUrl } = await createPaystack(paystack.secretKey).initialize({
    email: ledger.renterEmail,
    amountNgn: amount,
    reference,
    callbackUrl: `${paystack.appUrl}/market/orders/${row.id}/paid`,
    metadata: { jobId: row.id, listingId },
  });
  await auditPayment("payment.started", txn.id, skill.id, {
    amountNgn: amount,
    provider: "paystack",
  });
  return { jobId: row.id, redirectUrl: authorizationUrl };
}

/**
 * Confirms a Paystack payment (from the checkout redirect or the webhook),
 * then drafts the job. Safe to call more than once for the same reference.
 */
export async function confirmPayment(client: ModelClient, reference: string) {
  const paystack = paystackConfig();
  if (!paystack) throw new Error("Paystack is not configured");
  const txn = await db().query.transactions.findFirst({
    where: eq(transactions.providerReference, reference),
  });
  if (!txn) throw new NotFoundError("Unknown payment reference");
  if (txn.status !== "pending") return txn;

  const result = await createPaystack(paystack.secretKey).verify(reference);
  if (!result.paid) throw new Error("The payment hasn't completed");
  if (result.currency !== "NGN" || Math.round(result.amountNgn) !== txn.amountNgn) {
    throw new Error("The amount paid doesn't match the order");
  }
  const [held] = await db()
    .update(transactions)
    .set({ status: "held" })
    .where(and(eq(transactions.id, txn.id), eq(transactions.status, "pending")))
    .returning();
  if (!held) return txn; // another request confirmed it first
  await auditPayment("payment.held", txn.id, null, {
    amountNgn: txn.amountNgn,
    provider: "paystack",
  });

  if (txn.jobId) {
    await db()
      .update(jobs)
      .set({ status: "review" })
      .where(and(eq(jobs.id, txn.jobId), eq(jobs.status, "awaiting_payment")));
    await draftJob(client, txn.jobId);
  }
  return held;
}

async function auditPayment(
  action: string,
  transactionId: string,
  skillId: string | null,
  details: Record<string, unknown>,
) {
  await audit({
    actor: "system",
    action,
    entityType: "transaction",
    entityId: transactionId,
    skillId,
    details,
  });
}

/** The renter's view of their order. Never exposes rules, examples or the draft. */
export async function getOrder(jobId: string) {
  const [row] = await db()
    .select({ job: jobs, listing: listings, transaction: transactions })
    .from(jobs)
    .innerJoin(transactions, eq(transactions.jobId, jobs.id))
    .innerJoin(listings, eq(transactions.listingId, listings.id))
    .where(and(eq(jobs.id, jobId), eq(jobs.origin, "renter")));
  if (!row) throw new NotFoundError("No such order");
  const { job, listing, transaction } = row;
  return {
    id: job.id,
    listingTitle: listing.title,
    renterName: job.requesterName,
    status: job.status,
    output: job.status === "approved" ? job.finalOutput : null,
    approvedBy: job.approvedBy,
    rating: job.rating,
    complaint: job.complaint,
    createdAt: job.createdAt,
    amountNgn: transaction.amountNgn,
    premiumReview: transaction.premiumReview,
    provider: transaction.provider,
    escrow: transaction.status,
  };
}

/** The renter accepts and rates the delivered work; escrow is released to the owner. */
export async function acceptOrder(jobId: string, rating: number, comment: string) {
  if (!Number.isInteger(rating) || rating < 1 || rating > 5) throw new Error("Rate from 1 to 5");
  const txnId = await db().transaction(async (tx) => {
    const [job] = await tx
      .update(jobs)
      .set({ rating, ratingComment: comment.trim() || null })
      .where(and(eq(jobs.id, jobId), eq(jobs.status, "approved"), eq(jobs.origin, "renter")))
      .returning({ id: jobs.id, renter: jobs.requesterName, skillId: jobs.skillId });
    if (!job) throw new Error("Only delivered orders can be accepted");
    const [txn] = await tx
      .update(transactions)
      .set({ status: "released", settledAt: new Date() })
      .where(and(eq(transactions.jobId, jobId), eq(transactions.status, "held")))
      .returning({ id: transactions.id, ownerShareNgn: transactions.ownerShareNgn });
    if (!txn) throw new Error("This order has already been settled");
    await audit(
      {
        actor: `renter:${job.renter}`,
        action: "payment.released",
        entityType: "transaction",
        entityId: txn.id,
        skillId: job.skillId,
        details: { rating, ownerShareNgn: txn.ownerShareNgn },
      },
      tx,
    );
    return txn.id;
  });
  return txnId;
}

export async function earnings() {
  const rows = await db()
    .select({ transaction: transactions, listing: listings })
    .from(transactions)
    .innerJoin(listings, eq(transactions.listingId, listings.id))
    .orderBy(desc(transactions.createdAt));
  const sum = (status: string, key: "ownerShareNgn" | "platformFeeNgn" | "employerShareNgn") =>
    rows.filter((r) => r.transaction.status === status).reduce((n, r) => n + r.transaction[key], 0);
  return {
    rows,
    totals: {
      held: sum("held", "ownerShareNgn"),
      released: sum("released", "ownerShareNgn"),
      employer: sum("released", "employerShareNgn"),
      platformFees: sum("released", "platformFeeNgn"),
    },
  };
}
