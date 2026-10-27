export type PublishCheck =
  | { ok: true }
  | { ok: false; reason: "untested" }
  | { ok: false; reason: "lower-score"; candidate: number; published: number };

/**
 * A version can be published once it has a completed test run. A version that
 * scores lower than the one currently published is blocked until the owner
 * explicitly confirms they have reviewed it.
 */
export function checkPublish(
  candidateScore: number | null,
  publishedScore: number | null,
  ownerConfirmedLower: boolean,
): PublishCheck {
  if (candidateScore === null) return { ok: false, reason: "untested" };
  if (publishedScore !== null && candidateScore < publishedScore && !ownerConfirmedLower) {
    return {
      ok: false,
      reason: "lower-score",
      candidate: candidateScore,
      published: publishedScore,
    };
  }
  return { ok: true };
}

export function publishCheckMessage(check: PublishCheck): string | null {
  if (check.ok) return null;
  if (check.reason === "untested") return "Run the tests on this version before publishing it.";
  return `This version scores ${check.candidate.toFixed(1)}, lower than the published ${check.published.toFixed(1)}. Review its test run, then tick the box to publish anyway.`;
}
