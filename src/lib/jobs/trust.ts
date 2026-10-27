/**
 * The trust ladder. Every skill starts at level 0 and earns autonomy from its
 * record on the current published version. The owner decides when to climb
 * and can step down at any time. Thresholds are starting assumptions.
 */
export type TrustLevel = 0 | 1 | 2;

export interface TrustThresholds {
  level1MinJobs: number;
  level1MinCleanRate: number;
  level2MinJobs: number;
  spotCheckEvery: number;
}

export const DEFAULT_THRESHOLDS: TrustThresholds = {
  level1MinJobs: 20,
  level1MinCleanRate: 90,
  level2MinJobs: 50,
  spotCheckEvery: 5,
};

export interface TrustRecord {
  /** Owner-reviewed jobs on the published version. */
  reviewed: number;
  /** Of those, approved unchanged or with minor edits. */
  clean: number;
  rejected: number;
  /** Jobs completed while the skill was at level 1 or above. */
  jobsAtLevel1: number;
  rejectedAtLevel1: number;
  complaints: number;
}

export interface Eligibility {
  level: TrustLevel;
  eligible: boolean;
  reason: string;
}

export function eligibility(record: TrustRecord, t: TrustThresholds): Eligibility[] {
  const rate = record.reviewed ? (record.clean / record.reviewed) * 100 : 0;
  const l1 =
    record.reviewed >= t.level1MinJobs && rate >= t.level1MinCleanRate && record.complaints === 0;
  const l2 = l1 && record.jobsAtLevel1 >= t.level2MinJobs && record.rejectedAtLevel1 === 0;
  return [
    { level: 0, eligible: true, reason: "Review every draft." },
    {
      level: 1,
      eligible: l1,
      reason: `${t.level1MinJobs}+ reviewed jobs with ${t.level1MinCleanRate}%+ approved unchanged or with minor edits, and no complaints. Now: ${record.reviewed} jobs, ${Math.round(rate)}%, ${record.complaints} complaints.`,
    },
    {
      level: 2,
      eligible: l2,
      reason: `Level 1 met, plus ${t.level2MinJobs}+ jobs at level 1 with none rejected. Now: ${record.jobsAtLevel1} jobs, ${record.rejectedAtLevel1} rejected.`,
    },
  ];
}

export function canSetLevel(level: TrustLevel, record: TrustRecord, t: TrustThresholds): boolean {
  return eligibility(record, t).find((e) => e.level === level)?.eligible ?? false;
}

/**
 * Whether a new job needs the owner. Flagged jobs, premium-review jobs and
 * level 0 always do. Level 1 auto-approves the rest. Level 2 also sends a
 * random sample (1 in `spotCheckEvery`) for a spot check.
 */
export function needsOwnerReview(input: {
  level: number;
  flagged: boolean;
  ownerReviewRequired: boolean;
  spotCheckEvery: number;
  random?: () => number;
}): boolean {
  if (input.flagged || input.ownerReviewRequired || input.level <= 0) return true;
  if (input.level >= 2) return (input.random ?? Math.random)() < 1 / input.spotCheckEvery;
  return false;
}

export const TRUST_LABEL: Record<TrustLevel, string> = {
  0: "Owner reviews every result",
  1: "Proven results auto-approved, the rest reviewed",
  2: "Spot-checked by the owner",
};
