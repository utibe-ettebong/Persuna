/**
 * Your data, in one place (plan §7): everything Persuna keeps about you —
 * profile and memory, messages and notes, skills and episodes, jobs and
 * listings — exported as one file, or deleted as one act. Money records keep
 * their amounts (the other side's history) with your words and name removed;
 * the audit trail keeps what happened, as the platform's own record.
 */
import { and, eq, inArray, or } from "drizzle-orm";
import { db, schema } from "@/db/client";
import { audit } from "@/lib/audit";

const {
  agentKeys,
  appConnections,
  authUsers,
  corrections,
  episodeEvents,
  episodeFrames,
  episodes,
  evalRuns,
  examples,
  jobRounds,
  jobs,
  listings,
  mcpServers,
  modelUsage,
  orgMembers,
  persunaMessages,
  persunaNotes,
  persunaProfiles,
  persunaReminders,
  portfolioItems,
  projectMilestones,
  projectProposals,
  projects,
  ruleEvidence,
  skills,
  skillSteps,
  skillVersions,
  testResults,
  transactions,
  voiceTurns,
} = schema;

/** Typed into the delete form: deleting everything takes saying so. */
export const DELETE_CONFIRMATION = "delete everything";

export function isDeleteConfirmation(value: string): boolean {
  return value.trim().toLowerCase() === DELETE_CONFIRMATION;
}

/** A sold listing's row stays (its transactions point at it) without your words. */
export function scrubListing() {
  return {
    active: false,
    title: "Removed listing",
    description: "The owner deleted their data.",
    sampleOutput: "",
    employerName: null,
    employerEmail: null,
    employerToken: null,
  };
}

/** A rented job's record stays (the owner's history) without your words. */
export function scrubJobInput() {
  return {
    input: "[removed]",
    draft: "[removed]",
    finalOutput: null,
    complaint: null,
    ratingComment: null,
    requesterName: "Deleted user",
  };
}

/** A sold skill's row stays for its payments, with nothing of its owner's method in it. */
export function scrubSkill(id: string) {
  return {
    ownerId: null,
    slug: `removed-${id}`,
    name: "Removed skill",
    taskDescription: "The owner deleted their data.",
    inputType: "removed",
    outputType: "removed",
    interview: null,
    teamVisible: false,
    importSource: null,
  };
}

/** Money still moving, which deleting would strand: the words to refuse with, or null. */
export function deleteBlocker(open: { payments: number; milestones: number }): string | null {
  if (open.payments > 0) {
    return "You have a payment in progress. Finish or refund it, then delete your data.";
  }
  if (open.milestones > 0) {
    return "You have a project milestone in progress. Finish or refund it, then delete your data.";
  }
  return null;
}

const OPEN_PAYMENTS = ["pending", "held"] as const;
const OPEN_MILESTONES = ["funded", "submitted", "changes_requested", "approved"] as const;

/** A payment's amounts stay (both sides' history) without your identity. */
export function scrubTransaction() {
  return { renterName: "Deleted user", renterEmail: null, ratingComment: null };
}

/**
 * Everything about a user, as one object. Connection tokens are never
 * included (their providers and addresses are); neither are key hashes.
 */
export async function exportUserData(userId: string) {
  const owned = await db().select().from(skills).where(eq(skills.ownerId, userId));
  const skillIds = owned.map((skill) => skill.id);
  const [profile, messages, notes, reminders, portfolio, connections, mcp, usage, turns, userJobs] =
    await Promise.all([
      db().query.persunaProfiles.findFirst({ where: eq(persunaProfiles.userId, userId) }),
      db().select().from(persunaMessages).where(eq(persunaMessages.userId, userId)),
      db().select().from(persunaNotes).where(eq(persunaNotes.userId, userId)),
      db().select().from(persunaReminders).where(eq(persunaReminders.userId, userId)),
      db().select().from(portfolioItems).where(eq(portfolioItems.userId, userId)),
      db()
        .select({
          provider: appConnections.provider,
          account: appConnections.account,
          createdAt: appConnections.createdAt,
        })
        .from(appConnections)
        .where(eq(appConnections.userId, userId)),
      db()
        .select({ name: mcpServers.name, url: mcpServers.url, tools: mcpServers.tools })
        .from(mcpServers)
        .where(eq(mcpServers.userId, userId)),
      db().select().from(modelUsage).where(eq(modelUsage.userId, userId)),
      db().select().from(voiceTurns).where(eq(voiceTurns.userId, userId)),
      db().select().from(jobs).where(eq(jobs.requesterUserId, userId)),
    ]);
  const [versions, pairRows, steps, evidence, userEpisodes, userListings, memberships, keys] =
    await Promise.all([
      skillIds.length
        ? db().select().from(skillVersions).where(inArray(skillVersions.skillId, skillIds))
        : [],
      skillIds.length
        ? db().select().from(examples).where(inArray(examples.skillId, skillIds))
        : [],
      skillIds.length
        ? db().select().from(skillSteps).where(inArray(skillSteps.skillId, skillIds))
        : [],
      skillIds.length
        ? db().select().from(ruleEvidence).where(inArray(ruleEvidence.skillId, skillIds))
        : [],
      db().select().from(episodes).where(eq(episodes.userId, userId)),
      skillIds.length
        ? db().select().from(listings).where(inArray(listings.skillId, skillIds))
        : [],
      db().select().from(orgMembers).where(eq(orgMembers.userId, userId)),
      db()
        .select({ agentName: agentKeys.agentName, tokenHint: agentKeys.tokenHint })
        .from(agentKeys)
        .where(eq(agentKeys.userId, userId)),
    ]);
  const versionIds = versions.map((version) => version.id);
  const episodeIds = userEpisodes.map((episode) => episode.id);
  const pairIds = pairRows.map((pair) => pair.id);
  const [runs, results, events, frames, posted, proposals] = await Promise.all([
    versionIds.length
      ? db().select().from(evalRuns).where(inArray(evalRuns.skillVersionId, versionIds))
      : [],
    pairIds.length
      ? db().select().from(testResults).where(inArray(testResults.exampleId, pairIds))
      : [],
    episodeIds.length
      ? db().select().from(episodeEvents).where(inArray(episodeEvents.episodeId, episodeIds))
      : [],
    episodeIds.length
      ? db()
          .select({
            id: episodeFrames.id,
            episodeId: episodeFrames.episodeId,
            at: episodeFrames.at,
          })
          .from(episodeFrames)
          .where(inArray(episodeFrames.episodeId, episodeIds))
      : [],
    db().select().from(projects).where(eq(projects.posterId, userId)),
    db().select().from(projectProposals).where(eq(projectProposals.sellerId, userId)),
  ]);
  return {
    exportedAt: new Date().toISOString(),
    profile,
    memory: profile?.memory ?? [],
    messages,
    notes,
    reminders,
    portfolio,
    connections,
    mcpServers: mcp,
    usage,
    voiceTurns: turns,
    skills: owned,
    skillVersions: versions,
    examples: pairRows,
    evalRuns: runs,
    testResults: results,
    skillSteps: steps,
    ruleEvidence: evidence,
    episodes: userEpisodes,
    episodeEvents: events,
    episodeFrames: frames,
    listings: userListings,
    jobsRequested: userJobs,
    projectsPosted: posted,
    proposalsSent: proposals,
    teamMemberships: memberships,
    agentKeys: keys,
  };
}

/**
 * Deletes everything about a user, unless money is still moving. Owned skills
 * go with their versions, examples, steps, jobs and unsold listings. A sold
 * listing and its skill are emptied and kept, ownerless, because payments point
 * at them. Rented jobs and payments keep their records without the user's words
 * or name. The account row goes last, cascading the profile, messages,
 * episodes, projects and the rest.
 */
export async function deleteUserData(userId: string, confirmation: string) {
  if (!isDeleteConfirmation(confirmation)) throw new Error("Type “delete everything” to confirm.");
  const owned = await db().select({ id: skills.id }).from(skills).where(eq(skills.ownerId, userId));
  const skillIds = owned.map((skill) => skill.id);
  const ownListings = skillIds.length
    ? await db().select().from(listings).where(inArray(listings.skillId, skillIds))
    : [];
  const listingIds = ownListings.map((listing) => listing.id);
  const sold = listingIds.length
    ? await db()
        .selectDistinct({ listingId: transactions.listingId })
        .from(transactions)
        .where(inArray(transactions.listingId, listingIds))
    : [];
  const soldIds = new Set(sold.map((row) => row.listingId));

  const openPayments = await db()
    .select({ id: transactions.id })
    .from(transactions)
    .where(
      and(
        inArray(transactions.status, [...OPEN_PAYMENTS]),
        listingIds.length
          ? or(eq(transactions.renterUserId, userId), inArray(transactions.listingId, listingIds))
          : eq(transactions.renterUserId, userId),
      ),
    );
  const openMilestones = await db()
    .select({ id: projectMilestones.id })
    .from(projectMilestones)
    .innerJoin(projects, eq(projects.id, projectMilestones.projectId))
    .leftJoin(projectProposals, eq(projectProposals.id, projects.chosenProposalId))
    .where(
      and(
        inArray(projectMilestones.status, [...OPEN_MILESTONES]),
        or(eq(projects.posterId, userId), eq(projectProposals.sellerId, userId)),
      ),
    );
  const blocker = deleteBlocker({
    payments: openPayments.length,
    milestones: openMilestones.length,
  });
  if (blocker) throw new Error(blocker);

  const kept = ownListings.filter((row) => soldIds.has(row.id));
  const keptSkillIds = kept.map((row) => row.skillId);
  const goneSkillIds = skillIds.filter((id) => !keptSkillIds.includes(id));
  const ownJobs = await db()
    .select({ id: jobs.id })
    .from(jobs)
    .where(eq(jobs.requesterUserId, userId));
  await db().transaction(async (tx) => {
    for (const listing of kept) {
      await tx.update(listings).set(scrubListing()).where(eq(listings.id, listing.id));
    }
    if (keptSkillIds.length) {
      for (const id of keptSkillIds) {
        await tx.update(skills).set(scrubSkill(id)).where(eq(skills.id, id));
      }
      await tx
        .update(skillVersions)
        .set({ sheet: { summary: "Removed", rules: [], template: "Removed" } })
        .where(inArray(skillVersions.skillId, keptSkillIds));
      await tx.delete(examples).where(inArray(examples.skillId, keptSkillIds));
      await tx.delete(skillSteps).where(inArray(skillSteps.skillId, keptSkillIds));
      await tx.delete(ruleEvidence).where(inArray(ruleEvidence.skillId, keptSkillIds));
      await tx.delete(corrections).where(inArray(corrections.skillId, keptSkillIds));
    }
    if (ownJobs.length) {
      await tx.delete(jobRounds).where(
        inArray(
          jobRounds.jobId,
          ownJobs.map((job) => job.id),
        ),
      );
    }
    await tx.update(jobs).set(scrubJobInput()).where(eq(jobs.requesterUserId, userId));
    await tx
      .update(transactions)
      .set(scrubTransaction())
      .where(eq(transactions.renterUserId, userId));
    if (goneSkillIds.length) {
      await tx.delete(skills).where(inArray(skills.id, goneSkillIds));
    }
    await tx.delete(authUsers).where(eq(authUsers.id, userId));
    await audit(
      {
        actor: `user:${userId}`,
        action: "account.deleted",
        entityType: "user",
        entityId: userId,
      },
      tx,
    );
  });
}
