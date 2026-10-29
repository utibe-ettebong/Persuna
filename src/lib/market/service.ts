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
import { and, desc, eq, inArray, isNotNull, sql } from "drizzle-orm";
import { db, schema } from "@/db/client";
import { env, paystackConfig } from "@/env";
import { audit } from "@/lib/audit";
import { createJob, draftJob, jobRoundsFor, openJob, reviseJob } from "@/lib/jobs/service";
import type { ModelClient } from "@/lib/models/gateway";
import { createPaystack, paymentMatches } from "@/lib/payments/paystack";
import { NotFoundError, publishedScore } from "@/lib/skill/service";
import { normalizeText } from "@/lib/text";
import { browse, typeOptions, type BrowseQuery } from "./browse";
import {
  MAX_REVISIONS,
  isVerified,
  listingRequirements,
  ratingSummary,
  revisionAllowed,
  splitPayment,
} from "./rules";
import { verificationFor } from "./verification";

const { listings, skills, jobs, transactions } = schema;

export interface ListingInput {
  title: string;
  description: string;
  /** US cents. */
  priceCents: number;
  turnaroundHours: number;
  sampleOutput: string;
  ownerType: "freelancer" | "employee" | "organisation";
  declareOwnership: boolean;
  premiumReviewCents?: number | null;
  employerName?: string;
  employerEmail?: string;
  /** public (default): in the marketplace. unlisted: only people with the link. */
  visibility?: "public" | "unlisted";
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
    priceCents: input.priceCents,
    turnaroundHours: input.turnaroundHours,
    sampleOutput: input.sampleOutput,
    ownerType: input.ownerType,
    ownershipDeclaredAt,
    premiumReviewCents: input.premiumReviewCents ?? null,
    visibility: input.visibility ?? existing?.visibility ?? "public",
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
      priceCents: row.priceCents,
      visibility: row.visibility,
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
    .set({
      active,
      updatedAt: new Date(),
      ...(active ? { pausedAt: null, pausedReason: null } : {}),
    })
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

type ListingRow = { listing: typeof listings.$inferSelect; skill: typeof skills.$inferSelect };

/** Paid rentals and ratings per listing, from the payment records (they outlive jobs). */
async function marketStats(listingIds: string[]) {
  if (!listingIds.length) return new Map<string, { rentals: number; ratings: number[] }>();
  const rows = await db()
    .select({
      listingId: transactions.listingId,
      status: transactions.status,
      rating: transactions.rating,
    })
    .from(transactions)
    .where(inArray(transactions.listingId, listingIds));
  const stats = new Map<string, { rentals: number; ratings: number[] }>();
  for (const r of rows) {
    const s = stats.get(r.listingId) ?? { rentals: 0, ratings: [] };
    if (r.status === "held" || r.status === "released") s.rentals += 1;
    if (r.rating !== null) s.ratings.push(r.rating);
    stats.set(r.listingId, s);
  }
  return stats;
}

async function withMarketFacts(rows: ListingRow[]) {
  const stats = await marketStats(rows.map((r) => r.listing.id));
  const minScore = env().LISTING_MIN_SCORE;
  return Promise.all(
    rows.map(async (r) => {
      const verification = await verificationFor(r.skill.publishedVersionId);
      const s = stats.get(r.listing.id) ?? { rentals: 0, ratings: [] };
      return {
        ...r,
        verification,
        verified: isVerified(verification, minScore),
        score: verification?.score ?? null,
        rentals: s.rentals,
        ratings: ratingSummary(s.ratings),
      };
    }),
  );
}

export type MarketListing = Awaited<ReturnType<typeof withMarketFacts>>[number];

/**
 * Live public listings that still meet the minimum score, searched, filtered
 * and sorted. Unlisted listings never appear here: only their link opens them.
 */
export async function browseListings(query: BrowseQuery) {
  const rows = await db()
    .select({ listing: listings, skill: skills })
    .from(listings)
    .innerJoin(skills, eq(listings.skillId, skills.id))
    .where(and(eq(listings.active, true), eq(listings.visibility, "public")))
    .orderBy(desc(listings.updatedAt));
  const all = (await withMarketFacts(rows)).filter((r) => r.verified);
  const asItem = (r: MarketListing) => ({
    ...r,
    title: r.listing.title,
    description: r.listing.description,
    skillName: r.skill.name,
    inputType: r.skill.inputType,
    outputType: r.skill.outputType,
    priceCents: r.listing.priceCents,
    turnaroundHours: r.listing.turnaroundHours,
    rating: r.ratings.average,
    updatedAt: r.listing.updatedAt,
  });
  const items = all.map(asItem);
  return { results: browse(items, query), total: items.length, types: typeOptions(items) };
}

/** A live listing, public or unlisted, with its verification, ratings and recent reviews. */
export async function getActiveListing(listingId: string) {
  const [row] = await db()
    .select({ listing: listings, skill: skills })
    .from(listings)
    .innerJoin(skills, eq(listings.skillId, skills.id))
    .where(and(eq(listings.id, listingId), eq(listings.active, true)));
  if (!row) throw new NotFoundError("This listing isn't available");
  const [facts] = await withMarketFacts([row]);
  const reviews = await db()
    .select({
      rating: transactions.rating,
      comment: transactions.ratingComment,
      renterName: transactions.renterName,
      at: transactions.settledAt,
    })
    .from(transactions)
    .where(and(eq(transactions.listingId, listingId), isNotNull(transactions.rating)))
    .orderBy(desc(transactions.settledAt))
    .limit(8);
  return {
    ...facts,
    reviews: reviews.map((r) => ({
      rating: r.rating!,
      comment: r.comment,
      // First name only: renters are never fully named in public.
      renter: r.renterName.split(/\s+/)[0] || "A renter",
      at: r.at,
    })),
  };
}

/* ---------- Renting and payment ---------- */

export interface RentInput {
  renterUserId: string;
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
  const premium = rent.premiumReview && listing.premiumReviewCents != null;
  const amount = listing.priceCents + (premium ? (listing.premiumReviewCents ?? 0) : 0);
  const split = splitPayment(
    amount,
    env().PLATFORM_FEE_PERCENT,
    listing.ownerType === "employee" ? (listing.employerSharePercent ?? 0) : 0,
  );
  const job = {
    skillId: skill.id,
    origin: "renter" as const,
    requesterName: rent.renterName,
    requesterUserId: rent.renterUserId,
    input: rent.input,
    ownerReviewRequired: premium,
  };
  const ledger = {
    listingId,
    renterUserId: rent.renterUserId,
    renterName: rent.renterName.trim(),
    renterEmail: rent.renterEmail.trim().toLowerCase(),
    premiumReview: premium,
    currency: "USD" as const,
    ...split,
  };

  const paystack = paystackConfig();
  if (!paystack) {
    const row = await createJob(client, job);
    const [txn] = await db()
      .insert(transactions)
      .values({ ...ledger, jobId: row.id, provider: "mock", status: "held" })
      .returning();
    await auditPayment("payment.held", txn.id, skill.id, {
      amountCents: amount,
      currency: "USD",
      provider: "mock",
    });
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
    amountCents: amount,
    reference,
    callbackUrl: `${paystack.appUrl}/market/orders/${row.id}/paid`,
    metadata: { jobId: row.id, listingId },
  });
  await auditPayment("payment.started", txn.id, skill.id, {
    amountCents: amount,
    currency: "USD",
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
  if (txn.currency !== "USD" || !paymentMatches(result, txn.amountCents)) {
    throw new Error("The amount paid doesn't match the order");
  }
  const [held] = await db()
    .update(transactions)
    .set({ status: "held" })
    .where(and(eq(transactions.id, txn.id), eq(transactions.status, "pending")))
    .returning();
  if (!held) return txn; // another request confirmed it first
  await auditPayment("payment.held", txn.id, null, {
    amountCents: txn.amountCents,
    currency: txn.currency,
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
  const rounds = await jobRoundsFor(jobId);
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
    amountCents: transaction.amountCents,
    currency: transaction.currency,
    premiumReview: transaction.premiumReview,
    provider: transaction.provider,
    escrow: transaction.status,
    /** Earlier versions the renter saw, and the changes they asked for. */
    rounds: rounds.map((r) => ({
      round: r.round,
      output: r.output,
      request: r.request,
      at: r.createdAt,
    })),
    revisionsLeft: Math.max(0, MAX_REVISIONS - rounds.length),
  };
}

/**
 * The renter asks for changes to a delivered result. Persuna revises it with
 * their request; the owner reviews it again when the trust level says so.
 * The payment stays held until they accept.
 */
export async function requestChanges(client: ModelClient, jobId: string, request: string) {
  const order = await getOrder(jobId);
  const allowed = revisionAllowed({
    status: order.status,
    escrow: order.escrow,
    rounds: order.rounds.length,
    complaint: order.complaint,
  });
  if (!allowed.ok) throw new Error(allowed.reason);
  const text = normalizeText(request).slice(0, 2000);
  if (text.length < 5) throw new Error("Say what you'd like changed.");
  return reviseJob(client, jobId, {
    output: order.output ?? "",
    request: text,
    round: order.rounds.length + 1,
    actor: `renter:${order.renterName}`,
  });
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
      .set({
        status: "released",
        settledAt: new Date(),
        rating,
        ratingComment: comment.trim().slice(0, 1000) || null,
      })
      .where(and(eq(transactions.jobId, jobId), eq(transactions.status, "held")))
      .returning({
        id: transactions.id,
        ownerShareCents: transactions.ownerShareCents,
        currency: transactions.currency,
      });
    if (!txn) throw new Error("This order has already been settled");
    await audit(
      {
        actor: `renter:${job.renter}`,
        action: "payment.released",
        entityType: "transaction",
        entityId: txn.id,
        skillId: job.skillId,
        details: { rating, ownerShareCents: txn.ownerShareCents, currency: txn.currency },
      },
      tx,
    );
    return txn.id;
  });
  return txnId;
}

/** Payments for listings on the given skills, or all when null (admins). */
export async function earnings(skillIds: string[] | null) {
  const rows = await db()
    .select({ transaction: transactions, listing: listings })
    .from(transactions)
    .innerJoin(listings, eq(transactions.listingId, listings.id))
    .where(
      skillIds === null
        ? undefined
        : skillIds.length
          ? inArray(listings.skillId, skillIds)
          : sql`false`,
    )
    .orderBy(desc(transactions.createdAt));
  type Key = "ownerShareCents" | "platformFeeCents" | "employerShareCents";
  const totalsIn = (currency: string) => {
    const sum = (status: string, key: Key) =>
      rows
        .filter((r) => r.transaction.status === status && r.transaction.currency === currency)
        .reduce((n, r) => n + r.transaction[key], 0);
    return {
      held: sum("held", "ownerShareCents"),
      released: sum("released", "ownerShareCents"),
      employer: sum("released", "employerShareCents"),
      platformFees: sum("released", "platformFeeCents"),
    };
  };
  return {
    rows,
    /** US dollars, in cents. */
    totals: totalsIn("USD"),
    /** Naira payments made before the switch to dollars (kobo), or null when there are none. */
    legacyNgn: rows.some((r) => r.transaction.currency === "NGN") ? totalsIn("NGN") : null,
  };
}
