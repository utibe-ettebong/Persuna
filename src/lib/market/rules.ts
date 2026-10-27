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
