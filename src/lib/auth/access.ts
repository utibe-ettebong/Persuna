/**
 * Ownership checks. Owners see and change their own skills and everything
 * under them; renters see their own orders; admins see everything. Failures
 * are reported as "not found", so other people's records aren't confirmed
 * to exist.
 */
import { eq } from "drizzle-orm";
import { db, schema } from "@/db/client";
import { NotFoundError, getSkillBySlug } from "@/lib/skill/service";
import type { SessionUser } from "./session";

const { skills, skillVersions, evalRuns, testResults, corrections, jobs } = schema;

export function ownsSkill(user: SessionUser, skill: { ownerId: string | null }): boolean {
  return user.isAdmin || (skill.ownerId !== null && skill.ownerId === user.id);
}

function check(user: SessionUser, skill: { ownerId: string | null } | undefined, what: string) {
  if (!skill || !ownsSkill(user, skill)) throw new NotFoundError(`No such ${what}`);
}

export async function ownedSkillBySlug(user: SessionUser, slug: string) {
  const skill = await getSkillBySlug(slug).catch(() => undefined);
  check(user, skill, "skill");
  return skill!;
}

export async function ownedSkillById(user: SessionUser, skillId: string) {
  const skill = await db().query.skills.findFirst({ where: eq(skills.id, skillId) });
  check(user, skill, "skill");
  return skill!;
}

async function skillOf(query: Promise<{ skill: typeof skills.$inferSelect }[]>) {
  const [row] = await query;
  return row?.skill;
}

export async function assertVersionOwner(user: SessionUser, versionId: string) {
  check(
    user,
    await skillOf(
      db()
        .select({ skill: skills })
        .from(skillVersions)
        .innerJoin(skills, eq(skillVersions.skillId, skills.id))
        .where(eq(skillVersions.id, versionId)),
    ),
    "version",
  );
}

export async function assertRunOwner(user: SessionUser, runId: string) {
  check(
    user,
    await skillOf(
      db()
        .select({ skill: skills })
        .from(evalRuns)
        .innerJoin(skillVersions, eq(evalRuns.skillVersionId, skillVersions.id))
        .innerJoin(skills, eq(skillVersions.skillId, skills.id))
        .where(eq(evalRuns.id, runId)),
    ),
    "test run",
  );
}

export async function assertTestResultOwner(user: SessionUser, resultId: string) {
  check(
    user,
    await skillOf(
      db()
        .select({ skill: skills })
        .from(testResults)
        .innerJoin(evalRuns, eq(testResults.evalRunId, evalRuns.id))
        .innerJoin(skillVersions, eq(evalRuns.skillVersionId, skillVersions.id))
        .innerJoin(skills, eq(skillVersions.skillId, skills.id))
        .where(eq(testResults.id, resultId)),
    ),
    "test result",
  );
}

export async function assertCorrectionOwner(user: SessionUser, correctionId: string) {
  check(
    user,
    await skillOf(
      db()
        .select({ skill: skills })
        .from(corrections)
        .innerJoin(skills, eq(corrections.skillId, skills.id))
        .where(eq(corrections.id, correctionId)),
    ),
    "proposal",
  );
}

/** The skill owner reviews jobs; the renter who ordered it can see it as an order. */
export async function jobAccess(user: SessionUser, jobId: string) {
  const [row] = await db()
    .select({ skill: skills, requesterUserId: jobs.requesterUserId })
    .from(jobs)
    .innerJoin(skills, eq(jobs.skillId, skills.id))
    .where(eq(jobs.id, jobId));
  if (!row) throw new NotFoundError("No such job");
  const owner = ownsSkill(user, row.skill);
  const requester = row.requesterUserId === user.id;
  return { owner, requester };
}

export async function assertJobOwner(user: SessionUser, jobId: string) {
  if (!(await jobAccess(user, jobId)).owner) throw new NotFoundError("No such job");
}

export async function assertOrderAccess(user: SessionUser, jobId: string) {
  const { owner, requester } = await jobAccess(user, jobId);
  if (!owner && !requester) throw new NotFoundError("No such order");
  return { owner, requester };
}

/** Skill ids this user may see in lists. Null means all (admin). */
export async function visibleSkillIds(user: SessionUser): Promise<string[] | null> {
  if (user.isAdmin) return null;
  const rows = await db().select({ id: skills.id }).from(skills).where(eq(skills.ownerId, user.id));
  return rows.map((r) => r.id);
}
