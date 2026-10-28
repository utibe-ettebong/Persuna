/**
 * Real work through a published skill: submit, draft, self-check, review (or
 * auto-approve when the skill has earned it), deliver. Job content is
 * material, not method: it stays in the jobs table and is deleted after the
 * retention period.
 */
import { and, desc, eq, gte, inArray, lt } from "drizzle-orm";
import { db, schema } from "@/db/client";
import { env, trustThresholds } from "@/env";
import { audit, type Actor } from "@/lib/audit";
import type { ModelClient } from "@/lib/models/gateway";
import { refundForJob } from "@/lib/payments/service";
import { draftGrounded, selfCheck } from "@/lib/skill/engine";
import { closestPairs } from "@/lib/skill/retrieve";
import { NotFoundError, trainingPairs } from "@/lib/skill/service";
import { normalizeText } from "@/lib/text";
import { classifyEdit } from "./edit-size";
import { groundingFlags } from "./grounding";
import { mergeFlags } from "./self-check";
import {
  canSetLevel,
  eligibility,
  needsOwnerReview,
  type TrustLevel,
  type TrustRecord,
} from "./trust";

const { jobs, skills, skillVersions } = schema;

export interface NewJob {
  skillId: string;
  origin: "owner" | "renter";
  requesterName: string;
  /** The account that asked for the job (the owner, or a renter). */
  requesterUserId?: string;
  input: string;
  /** Renter paid for guaranteed owner review. */
  ownerReviewRequired?: boolean;
}

async function publishedVersion(skillId: string) {
  const skill = await db().query.skills.findFirst({ where: eq(skills.id, skillId) });
  if (!skill) throw new NotFoundError("No such skill");
  if (!skill.publishedVersionId) throw new Error(`"${skill.name}" has no published version yet`);
  const version = await db().query.skillVersions.findFirst({
    where: eq(skillVersions.id, skill.publishedVersionId),
  });
  if (!version) throw new NotFoundError("Published version is missing");
  return { skill, version };
}

/**
 * Records a job before any drafting. Renter jobs paid through Paystack wait
 * here (awaiting_payment) until the payment is confirmed.
 */
export async function openJob(job: NewJob, status: "awaiting_payment" | "review" = "review") {
  const { skill, version } = await publishedVersion(job.skillId);
  const input = normalizeText(job.input);
  if (!input) throw new Error("The job has no input");
  const [row] = await db()
    .insert(jobs)
    .values({
      skillId: skill.id,
      skillVersionId: version.id,
      origin: job.origin,
      requesterUserId: job.requesterUserId ?? null,
      requesterName: job.requesterName.trim() || "Owner",
      input,
      draft: "",
      model: "",
      status,
      trustLevel: skill.trustLevel,
      ownerReviewRequired: job.ownerReviewRequired ?? false,
      expiresAt: new Date(Date.now() + env().JOB_RETENTION_DAYS * 86_400_000),
    })
    .returning();
  await audit({
    actor: job.origin === "renter" ? `renter:${row.requesterName}` : "owner",
    action: "job.created",
    entityType: "job",
    entityId: row.id,
    skillId: skill.id,
    details: { origin: row.origin, version: version.version, status },
  });
  return row;
}

/**
 * Drafts the job with the published version, runs the self-check, then either
 * sends it to the owner or auto-approves it, depending on the trust level.
 */
export async function draftJob(client: ModelClient, jobId: string, random = Math.random) {
  const job = await getJob(jobId);
  if (job.draft) return job;
  const version = await db().query.skillVersions.findFirst({
    where: eq(skillVersions.id, job.skillVersionId),
  });
  if (!version) throw new NotFoundError("Skill version is missing");
  const skill = await db().query.skills.findFirst({ where: eq(skills.id, job.skillId) });
  if (!skill) throw new NotFoundError("No such skill");

  const train = await trainingPairs(job.skillId);
  const shots = closestPairs(job.input, train, 3);
  // Draft, check every statement against the input, redraft what isn't supported.
  const { draft, completion, grounding } = await draftGrounded(
    client,
    version.sheet,
    shots,
    job.input,
  );
  const flags = mergeFlags(
    groundingFlags(grounding),
    await selfCheck(
      client,
      version.sheet,
      job.input,
      draft,
      train.map((p) => p.input.length),
    ),
  );

  const review = needsOwnerReview({
    level: skill.trustLevel,
    flagged: flags.length > 0,
    ownerReviewRequired: job.ownerReviewRequired,
    spotCheckEvery: trustThresholds().spotCheckEvery,
    random,
  });
  const [row] = await db()
    .update(jobs)
    .set({
      draft,
      flags,
      grounding,
      shotExampleIds: shots.map((s) => s.id),
      model: completion.model,
      promptTokens: completion.promptTokens,
      completionTokens: completion.completionTokens,
      trustLevel: skill.trustLevel,
      ...(review
        ? { status: "review" as const }
        : {
            status: "approved" as const,
            finalOutput: draft,
            editSize: "none" as const,
            approvedBy: "auto" as const,
            reviewedAt: new Date(),
          }),
    })
    .where(eq(jobs.id, jobId))
    .returning();
  await audit({
    actor: "system",
    action: review ? "job.drafted" : "job.auto_approved",
    entityType: "job",
    entityId: jobId,
    skillId: job.skillId,
    details: {
      flags: flags.map((f) => f.kind),
      trustLevel: skill.trustLevel,
      statementsChecked: grounding.checked,
      unsupported: grounding.unsupported.length,
      redrafts: grounding.redrafts,
    },
  });
  return row;
}

/** Open and draft in one step: owner jobs, and renter jobs paid with mock payments. */
export async function createJob(client: ModelClient, job: NewJob) {
  const row = await openJob(job);
  return draftJob(client, row.id);
}

/** The owner's decision. Approving with changes records how big the edit was. */
export async function reviewJob(
  jobId: string,
  decision: "approve" | "reject",
  finalOutput?: string,
) {
  const job = await getJob(jobId);
  if (job.status !== "review") throw new Error("This job isn't waiting for review");

  if (decision === "reject") {
    await db()
      .update(jobs)
      .set({
        status: "rejected",
        editSize: "rejected",
        approvedBy: "owner",
        reviewedAt: new Date(),
      })
      .where(eq(jobs.id, jobId));
    await audit({
      actor: "owner",
      action: "job.rejected",
      entityType: "job",
      entityId: jobId,
      skillId: job.skillId,
    });
    await refundForJob(jobId, "Declined by the skill owner", "owner");
    return;
  }

  const final = normalizeText(finalOutput ?? job.draft);
  if (!final) throw new Error("The approved output is empty");
  const editSize = classifyEdit(job.draft, final);
  await db()
    .update(jobs)
    .set({
      status: "approved",
      finalOutput: final,
      editSize,
      approvedBy: "owner",
      reviewedAt: new Date(),
    })
    .where(eq(jobs.id, jobId));
  await audit({
    actor: "owner",
    action: "job.approved",
    entityType: "job",
    entityId: jobId,
    skillId: job.skillId,
    details: { editSize },
  });
}

/**
 * A renter reports a problem with a delivered result. The payment is refunded
 * and the skill drops back to level 0: every result is reviewed again.
 */
export async function complainAboutJob(jobId: string, complaint: string) {
  const job = await getJob(jobId);
  if (job.origin !== "renter" || job.status !== "approved") {
    throw new Error("Only delivered orders can be reported");
  }
  if (job.complainedAt) throw new Error("A problem was already reported for this order");
  const text = complaint.trim();
  if (text.length < 5) throw new Error("Say briefly what went wrong");

  const actor: Actor = `renter:${job.requesterName}`;
  await db()
    .update(jobs)
    .set({ complaint: text.slice(0, 1000), complainedAt: new Date() })
    .where(eq(jobs.id, jobId));
  await setTrustLevelUnchecked(job.skillId, 0, actor, "complaint");
  await audit({
    actor,
    action: "job.complaint",
    entityType: "job",
    entityId: jobId,
    skillId: job.skillId,
  });
  await refundForJob(jobId, "Renter reported a problem", actor);
}

export async function getJob(jobId: string) {
  const job = await db().query.jobs.findFirst({ where: eq(jobs.id, jobId) });
  if (!job) throw new NotFoundError(`No job ${jobId}`);
  return job;
}

export async function getJobWithSkill(jobId: string) {
  const [row] = await db()
    .select({ job: jobs, skill: skills, version: skillVersions })
    .from(jobs)
    .innerJoin(skills, eq(jobs.skillId, skills.id))
    .innerJoin(skillVersions, eq(jobs.skillVersionId, skillVersions.id))
    .where(eq(jobs.id, jobId));
  if (!row) throw new NotFoundError(`No job ${jobId}`);
  return row;
}

/** Jobs on the given skills, or on every skill when null (admins). */
export async function listJobs(skillIds: string[] | null) {
  await purgeExpiredJobs();
  if (skillIds && skillIds.length === 0) return [];
  return db()
    .select({ job: jobs, skill: skills, version: skillVersions })
    .from(jobs)
    .innerJoin(skills, eq(jobs.skillId, skills.id))
    .innerJoin(skillVersions, eq(jobs.skillVersionId, skillVersions.id))
    .where(skillIds ? inArray(jobs.skillId, skillIds) : undefined)
    .orderBy(desc(jobs.createdAt));
}

/** Orders this renter placed, newest first. */
export async function listOrdersFor(userId: string) {
  return db()
    .select({ job: jobs, skill: skills })
    .from(jobs)
    .innerJoin(skills, eq(jobs.skillId, skills.id))
    .where(and(eq(jobs.requesterUserId, userId), eq(jobs.origin, "renter")))
    .orderBy(desc(jobs.createdAt));
}

/** Deletes jobs past their retention date. Transactions survive with job_id cleared. */
export async function purgeExpiredJobs(now = new Date()) {
  const removed = await db().delete(jobs).where(lt(jobs.expiresAt, now)).returning({ id: jobs.id });
  if (removed.length) {
    await audit({
      actor: "system",
      action: "jobs.purged",
      entityType: "job",
      details: { count: removed.length },
    });
  }
  return removed.length;
}

/** Approval stats: the share of owner-reviewed jobs approved unchanged or with minor edits. */
export function approvalStats(rows: { status: string; editSize: string | null }[]) {
  const reviewed = rows.filter((r) => r.status === "approved" || r.status === "rejected");
  const good = reviewed.filter((r) => r.editSize === "none" || r.editSize === "minor").length;
  return {
    reviewed: reviewed.length,
    approvedClean: good,
    rate: reviewed.length ? Math.round((good / reviewed.length) * 1000) / 10 : null,
  };
}

/** The record the trust ladder is judged on: jobs on the currently published version. */
export async function trustRecord(skillId: string): Promise<TrustRecord> {
  const skill = await db().query.skills.findFirst({ where: eq(skills.id, skillId) });
  if (!skill?.publishedVersionId) {
    return {
      reviewed: 0,
      clean: 0,
      rejected: 0,
      jobsAtLevel1: 0,
      rejectedAtLevel1: 0,
      complaints: 0,
    };
  }
  const rows = await db()
    .select({
      status: jobs.status,
      editSize: jobs.editSize,
      approvedBy: jobs.approvedBy,
      trustLevel: jobs.trustLevel,
      complainedAt: jobs.complainedAt,
    })
    .from(jobs)
    .where(eq(jobs.skillVersionId, skill.publishedVersionId));
  const ownerReviewed = rows.filter(
    (r) => r.approvedBy === "owner" && (r.status === "approved" || r.status === "rejected"),
  );
  const atLevel1 = rows.filter(
    (r) => r.trustLevel >= 1 && (r.status === "approved" || r.status === "rejected"),
  );
  return {
    reviewed: ownerReviewed.length,
    clean: ownerReviewed.filter((r) => r.editSize === "none" || r.editSize === "minor").length,
    rejected: ownerReviewed.filter((r) => r.status === "rejected").length,
    jobsAtLevel1: atLevel1.length,
    rejectedAtLevel1: atLevel1.filter((r) => r.status === "rejected").length,
    complaints: rows.filter((r) => r.complainedAt).length,
  };
}

export async function trustStatus(skillId: string) {
  const record = await trustRecord(skillId);
  return { record, levels: eligibility(record, trustThresholds()) };
}

/** The owner climbs or steps down the ladder. Climbing needs the record; stepping down never does. */
export async function setTrustLevel(skillId: string, level: TrustLevel) {
  const skill = await db().query.skills.findFirst({ where: eq(skills.id, skillId) });
  if (!skill) throw new NotFoundError("No such skill");
  if (
    level > skill.trustLevel &&
    !canSetLevel(level, await trustRecord(skillId), trustThresholds())
  ) {
    throw new Error(`This skill hasn't earned level ${level} yet`);
  }
  await setTrustLevelUnchecked(skillId, level, "owner", "owner decision");
}

async function setTrustLevelUnchecked(
  skillId: string,
  level: TrustLevel,
  actor: Actor,
  reason: string,
) {
  const [before] = await db()
    .select({ level: skills.trustLevel })
    .from(skills)
    .where(eq(skills.id, skillId));
  if (before?.level === level) return;
  await db().update(skills).set({ trustLevel: level }).where(eq(skills.id, skillId));
  await audit({
    actor,
    action: "trust.changed",
    entityType: "skill",
    entityId: skillId,
    skillId,
    details: { from: before?.level, to: level, reason },
  });
}

/** Jobs from the last `days` days that the owner hasn't had to look at. */
export async function autoApprovedCount(skillId: string, days = 7) {
  const since = new Date(Date.now() - days * 86_400_000);
  const rows = await db()
    .select({ id: jobs.id })
    .from(jobs)
    .where(and(eq(jobs.skillId, skillId), eq(jobs.approvedBy, "auto"), gte(jobs.createdAt, since)));
  return rows.length;
}
