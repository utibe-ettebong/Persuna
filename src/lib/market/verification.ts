/**
 * Persuna Verified: what a listing's published version scored on held-back
 * examples, and the automatic pause when that score falls below the listing
 * minimum. Kept apart from the market service so skill publishing and test
 * runs can call it without importing the marketplace.
 */
import { and, count, desc, eq } from "drizzle-orm";
import { db, schema } from "@/db/client";
import { env } from "@/env";
import { audit, type Actor } from "@/lib/audit";
import { shouldPauseListing, type Verification } from "./rules";

const { evalRuns, testResults, skillVersions, skills, listings } = schema;

/** The published version's latest completed test run, or null when it has none. */
export async function verificationFor(publishedVersionId: string | null) {
  if (!publishedVersionId) return null;
  const [run] = await db()
    .select({
      id: evalRuns.id,
      score: evalRuns.meanScore,
      at: evalRuns.completedAt,
      version: skillVersions.version,
    })
    .from(evalRuns)
    .innerJoin(skillVersions, eq(evalRuns.skillVersionId, skillVersions.id))
    .where(and(eq(evalRuns.skillVersionId, publishedVersionId), eq(evalRuns.status, "complete")))
    .orderBy(desc(evalRuns.createdAt))
    .limit(1);
  if (!run || run.score === null) return null;
  const [{ n }] = await db()
    .select({ n: count() })
    .from(testResults)
    .where(eq(testResults.evalRunId, run.id));
  return {
    score: run.score,
    examples: n,
    verifiedAt: run.at ?? new Date(),
    version: run.version,
  } satisfies Verification;
}

/**
 * Re-checks a skill's live listing against the minimum score. Called after a
 * publish and after a test run of the published version: a listing that no
 * longer qualifies is paused, and the pause is audited.
 */
export async function enforceListingScore(skillId: string, actor: Actor = "system") {
  const [row] = await db()
    .select({ listing: listings, publishedVersionId: skills.publishedVersionId })
    .from(listings)
    .innerJoin(skills, eq(listings.skillId, skills.id))
    .where(eq(listings.skillId, skillId));
  if (!row) return null;
  const minScore = env().LISTING_MIN_SCORE;
  const verification = await verificationFor(row.publishedVersionId);
  const score = verification?.score ?? null;
  if (!shouldPauseListing(row.listing.active, score, minScore)) return verification;

  const [paused] = await db()
    .update(listings)
    .set({ active: false, pausedAt: new Date(), pausedReason: "score_below_minimum" })
    .where(and(eq(listings.id, row.listing.id), eq(listings.active, true)))
    .returning({ id: listings.id });
  if (paused) {
    await audit({
      actor,
      action: "listing.paused",
      entityType: "listing",
      entityId: row.listing.id,
      skillId,
      details: { reason: "score_below_minimum", score, minScore },
    });
  }
  return verification;
}
