/**
 * Splits a renter's payment. The platform fee rounds to the nearest naira; the
 * rest is the owner's share, of which an employer (for employee listings)
 * takes `employerPercent`. No naira is lost to rounding.
 */
export function splitPayment(amountNgn: number, feePercent: number, employerPercent = 0) {
  if (!Number.isInteger(amountNgn) || amountNgn <= 0)
    throw new Error("Price must be a whole number of naira above zero");
  if (employerPercent < 0 || employerPercent > 100)
    throw new Error("Employer share must be 0–100%");
  const platformFeeNgn = Math.round((amountNgn * feePercent) / 100);
  const earnings = amountNgn - platformFeeNgn;
  const employerShareNgn = Math.round((earnings * employerPercent) / 100);
  return {
    amountNgn,
    platformFeeNgn,
    employerShareNgn,
    ownerShareNgn: earnings - employerShareNgn,
  };
}

export interface ListingRequirement {
  key: "published" | "score" | "ownership" | "employer";
  label: string;
  met: boolean;
}

/** What a skill needs before its listing can go live. */
export function listingRequirements(input: {
  hasPublishedVersion: boolean;
  publishedScore: number | null;
  ownershipDeclared: boolean;
  minScore: number;
  /** Set for employee listings: whether the employer has approved. */
  employerApproved?: boolean;
}): ListingRequirement[] {
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
      key: "ownership",
      label: "Ownership of the method declared",
      met: input.ownershipDeclared,
    },
  ];
}

export const formatNaira = (n: number) => `₦${n.toLocaleString("en-NG")}`;

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
