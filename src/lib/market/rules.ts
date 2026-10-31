/**
 * Splits a payment in US cents. The platform fee rounds to the nearest cent;
 * the rest is the owner's (or seller's) share, of which an employer (for
 * employee listings) takes `employerPercent`. No cent is lost to rounding.
 */
export function splitPayment(amountCents: number, feePercent: number, employerPercent = 0) {
  if (!Number.isInteger(amountCents) || amountCents <= 0)
    throw new Error("Price must be a whole number of cents above zero");
  if (employerPercent < 0 || employerPercent > 100)
    throw new Error("Employer share must be 0–100%");
  const platformFeeCents = Math.round((amountCents * feePercent) / 100);
  const earnings = amountCents - platformFeeCents;
  const employerShareCents = Math.round((earnings * employerPercent) / 100);
  return {
    amountCents,
    platformFeeCents,
    employerShareCents,
    ownerShareCents: earnings - employerShareCents,
  };
}

export interface ListingRequirement {
  key:
    "confidential" | "published" | "score" | "coverage" | "confidence" | "ownership" | "employer";
  label: string;
  met: boolean;
}

/**
 * Why a skill that's part of a company role can't be listed: company know-how
 * is confidential to the company (see lib/teams).
 */
export function confidentialListingMessage(orgName: string): string {
  return `This skill is part of your job at ${orgName}. Company know-how stays confidential, so it can't be listed on the marketplace. To list it, it must first be detached from your role there.`;
}

/** Throws the clear message when the skill is company know-how. */
export function assertListable(confidentialTo: string | null | undefined) {
  if (confidentialTo) throw new Error(confidentialListingMessage(confidentialTo));
}

/** What a skill needs before its listing can go live. */
export function listingRequirements(input: {
  hasPublishedVersion: boolean;
  publishedScore: number | null;
  ownershipDeclared: boolean;
  minScore: number;
  /** Set for employee listings: whether the employer has approved. */
  employerApproved?: boolean;
  /** The organisation the skill is confidential to, when it's part of a company role. */
  confidentialTo?: string | null;
  /** Composite coverage (null when nothing was observed yet): gates unobserved branches. */
  coverage?: number | null;
  minCoverage?: number;
  /** Composite confidence (null when there are no rules yet). */
  confidence?: number | null;
  minConfidence?: number;
}): ListingRequirement[] {
  const confidential: ListingRequirement[] = input.confidentialTo
    ? [
        {
          key: "confidential",
          label: confidentialListingMessage(input.confidentialTo),
          met: false,
        },
      ]
    : [];
  const employer: ListingRequirement[] =
    input.employerApproved === undefined
      ? []
      : [
          {
            key: "employer",
            label: "Employer has approved the listing",
            met: input.employerApproved,
          },
        ];
  return [
    ...confidential,
    ...employer,
    {
      key: "published",
      label: "A published skill version",
      met: input.hasPublishedVersion,
    },
    {
      key: "score",
      label: `Published version scores at least ${input.minScore} on held-back examples`,
      met: input.publishedScore !== null && input.publishedScore >= input.minScore,
    },
    {
      key: "coverage",
      label:
        input.coverage == null
          ? "Observed work stays covered (nothing observed yet)"
          : `Observed work stays covered, every branch seen (at least ${input.minCoverage ?? 0})`,
      met:
        input.coverage == null ||
        (input.minCoverage != null && input.coverage >= input.minCoverage),
    },
    {
      key: "confidence",
      label:
        input.confidence == null
          ? "Rules confirmed by repetition (no rules yet)"
          : `Rules confirmed by repetition (at least ${input.minConfidence ?? 0})`,
      met:
        input.confidence == null ||
        (input.minConfidence != null && input.confidence >= input.minConfidence),
    },
    {
      key: "ownership",
      label: "Ownership of the method declared",
      met: input.ownershipDeclared,
    },
  ];
}

/** How many times a renter may ask for changes to one order before accepting it. */
export const MAX_REVISIONS = 2;

/**
 * Whether a renter may ask for changes now: only to a delivered result they
 * haven't accepted, reported or been refunded for, and only a few times.
 */
export function revisionAllowed(order: {
  status: string;
  escrow: string;
  rounds: number;
  complaint: string | null;
}): { ok: true } | { ok: false; reason: string } {
  if (order.status !== "approved")
    return { ok: false, reason: "There's no delivered result to change yet" };
  if (order.escrow !== "held" || order.complaint)
    return { ok: false, reason: "This order is already settled" };
  if (order.rounds >= MAX_REVISIONS)
    return {
      ok: false,
      reason: `You've used all ${MAX_REVISIONS} rounds of changes on this order`,
    };
  return { ok: true };
}

/* ---------- Persuna Verified ---------- */

/** What Persuna checked: the published version's latest test run on held-back examples. */
export interface Verification {
  score: number;
  /** Held-back examples the score was measured on. */
  examples: number;
  verifiedAt: Date;
  version: number;
}

/** "Persuna Verified": tested on at least one held-back example and scoring at least the minimum. */
export function isVerified(v: Verification | null, minScore: number): v is Verification {
  return v !== null && v.examples > 0 && v.score >= minScore;
}

/**
 * A live listing is paused when its published version no longer meets the
 * listing minimum (a lower-scoring version was published, or a re-test scored lower).
 */
export function shouldPauseListing(active: boolean, score: number | null, minScore: number) {
  return active && (score === null || score < minScore);
}

/* ---------- Ratings ---------- */

export function ratingSummary(ratings: number[]) {
  const valid = ratings.filter((r) => Number.isInteger(r) && r >= 1 && r <= 5);
  const stars = [1, 2, 3, 4, 5].map((n) => valid.filter((r) => r === n).length);
  return {
    count: valid.length,
    average: valid.length
      ? Math.round((valid.reduce((a, b) => a + b, 0) / valid.length) * 10) / 10
      : null,
    /** How many ratings gave 1, 2, 3, 4 and 5 stars. */
    stars,
  };
}
