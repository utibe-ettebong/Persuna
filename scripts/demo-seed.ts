/**
 * Sets up a ready-to-show demo: the sample meeting-minutes skill with rules,
 * a test run, a published version and a live marketplace listing — plus, with
 * --counterpart, a rented job on that listing and a project halfway through
 * (first milestone paid out, second funded and held in escrow for you to drive).
 * Safe to run more than once: each stage resumes from the current state.
 * Uses whatever models are configured (the mock when no key is set), and mock
 * payments when Paystack isn't configured, so no real money moves. The listing
 * bar for rule confirmation is relaxed for the sample skill only (see
 * scripts/demo-seed.env); real listings still need it.
 *
 *   npm run demo:seed -- --owner you@example.com --counterpart friend@example.com
 *
 * Both accounts must have signed up already; the skill and listing are the
 * owner's, the counterpart rents the job and freelances the project.
 */
import path from "node:path";
import { parseArgs } from "node:util";
import { and, asc, eq } from "drizzle-orm";
import { db } from "@/db/client";
import { jobs, projectMilestones, projectProposals, projects } from "@/db/schema";
import { userById, userIdByEmail } from "@/lib/auth/users";
import { createModelClient } from "@/lib/models";
import type { ModelClient } from "@/lib/models/gateway";
import {
  getListingForSkill,
  readiness,
  rentSkill,
  saveListing,
  setListingActive,
} from "@/lib/market/service";
import {
  acceptProposal,
  approveMilestone,
  createProject,
  fundMilestone,
  propose,
  savePlan,
  submitDelivery,
} from "@/lib/projects/service";
import { loadSkillFolder } from "@/lib/skill/pairs-fs";
import {
  extractVersion,
  getSkillOverview,
  importPairs,
  publishVersion,
  runEval,
  upsertSkill,
} from "@/lib/skill/service";

const JOB_INPUT = `Raw notes, Tue sync. Ada: launch moved to the 21st, needs the checklist by Friday. Sam: two open bugs on checkout, both his. Priya: pricing page copy approved, ship it. Decision: freeze scope Thursday noon.`;

const PROJECT_TITLE = "Demo: customer launch checklist";
const PROJECT_BRIEF =
  "A one-page launch checklist our whole team can follow: pre-launch, launch day, and post-launch, each item with an owner role, in plain language.";
const PROJECT_SCOPE =
  "Write and polish a one-page customer launch checklist: pre-launch, launch day and post-launch sections, every item with an owner role.";
const PROJECT_CRITERIA = ["Covers all three launch phases", "Plain language throughout"];
const PROJECT_MILESTONES = [
  {
    title: "Draft checklist",
    criteria: [
      "Covers pre-launch, launch day and post-launch",
      "Each item names an owner role",
      "Fits on one page",
    ],
    amountCents: 12000,
  },
  {
    title: "Final polished checklist",
    criteria: ["Incorporates the draft feedback", "Plain language, no jargon"],
    amountCents: 8000,
  },
];
const PROPOSAL_MESSAGE =
  "I've written launch checklists for three SaaS releases. I'll draft yours this week, fold in your feedback, and deliver a one-pager the whole team can follow.";
const MILESTONE_1_DELIVERY = `Launch checklist (draft)

Pre-launch — Owner: PM
- Freeze scope and confirm the launch date
- Finish the pricing page and checkout bugs
- Brief support on the new flow

Launch day — Owner: Engineering
- Deploy behind the flag, then roll out
- Watch errors and checkouts for two hours
- Post the launch note

Post-launch — Owner: PM
- Collect first-day feedback and file fixes
- Review numbers after one week`;

async function main() {
  const { values } = parseArgs({
    options: { owner: { type: "string" }, counterpart: { type: "string" } },
  });
  const ownerEmail = values.owner ?? process.env.DEMO_OWNER_EMAIL;
  if (!ownerEmail) throw new Error("Pass --owner you@example.com (an account that has signed up)");
  const ownerId = await userIdByEmail(ownerEmail);
  const client = createModelClient();
  const { definition, pairs } = await loadSkillFolder(path.resolve("data/skills/meeting-minutes"));
  const skill = await upsertSkill(definition, ownerId);
  const { upserted } = await importPairs(skill.id, pairs);
  console.log(`Skill "${skill.name}": ${upserted} sample pairs`);

  let overview = await getSkillOverview(skill.slug);
  if (!overview.skill.currentVersionId) {
    const version = await extractVersion(client, skill.slug);
    console.log(`Extracted v${version.version} (${version.sheet.rules.length} rules)`);
    overview = await getSkillOverview(skill.slug);
  }
  const current = overview.versions.find((v) => v.id === overview.skill.currentVersionId)!;
  if (!current.latestRun || current.latestRun.status !== "complete") {
    const run = await runEval(client, current.id);
    console.log(`Tested v${current.version}: replication score ${run.meanScore}`);
  }
  if (!overview.skill.publishedVersionId) {
    await publishVersion(skill.id, current.id, false);
    console.log(`Published v${current.version}`);
  }

  const sample = pairs.find((p) => p.split === "train")!.output;
  await saveListing(skill.id, {
    title: "Meeting notes into polished minutes",
    description:
      "Send raw meeting notes and get finished minutes in a consistent house format: header block, decisions in bold, and an action table with owners and due dates.",
    priceCents: 1200,
    turnaroundHours: 24,
    sampleOutput: sample,
    ownerType: "freelancer",
    declareOwnership: true,
    premiumReviewCents: 500,
  });
  const ready = await readiness(skill.id);
  if (ready.ready) {
    await setListingActive(skill.id, true);
    console.log("Listing is live in the marketplace");
  } else {
    console.log(
      "Listing saved but not live yet:",
      ready.requirements
        .filter((r) => !r.met)
        .map((r) => r.label)
        .join("; "),
    );
  }

  const counterpartEmail = values.counterpart ?? process.env.DEMO_COUNTERPART_EMAIL;
  if (!counterpartEmail) {
    console.log("Pass --counterpart friend@example.com to also seed a rented job and a project.");
    return;
  }
  const counterpartId = await userIdByEmail(counterpartEmail);
  if (counterpartId === ownerId) {
    throw new Error("The counterpart must be a different account than the owner");
  }
  const owner = await userById(ownerId);
  const counterpart = await userById(counterpartId);
  if (!owner || !counterpart) throw new Error("Both accounts must exist and be unsuspended");
  await seedJob(client, skill.id, counterpart);
  await seedProject(client, owner, counterpart);
}

/** The counterpart rents the listing: mock payment held, job drafted for review. */
async function seedJob(
  client: ModelClient,
  skillId: string,
  renter: NonNullable<Awaited<ReturnType<typeof userById>>>,
) {
  const existing = await db().query.jobs.findFirst({
    where: and(
      eq(jobs.skillId, skillId),
      eq(jobs.requesterUserId, renter.id),
      eq(jobs.origin, "renter"),
    ),
  });
  if (existing) {
    console.log(`Job ${existing.id} already rented (${existing.status})`);
    return;
  }
  const listing = await getListingForSkill(skillId);
  if (!listing?.active) {
    console.log("Listing isn't live; skipping the rented job");
    return;
  }
  const { jobId } = await rentSkill(client, listing.id, {
    renterUserId: renter.id,
    renterName: renter.name,
    renterEmail: renter.email,
    input: JOB_INPUT,
    premiumReview: false,
  });
  console.log(`Job ${jobId} rented and drafted; review it at /market/orders/${jobId}`);
}

/** The owner posts a project, the counterpart freelances it: milestone 1 paid out, 2 funded. */
async function seedProject(
  client: ModelClient,
  owner: NonNullable<Awaited<ReturnType<typeof userById>>>,
  seller: NonNullable<Awaited<ReturnType<typeof userById>>>,
) {
  const load = () =>
    db().query.projects.findFirst({
      where: and(eq(projects.posterId, owner.id), eq(projects.title, PROJECT_TITLE)),
    });
  let project = await load();
  if (!project) {
    project = await createProject(client, owner, {
      title: PROJECT_TITLE,
      brief: PROJECT_BRIEF,
      budgetCents: 20000,
      deadline: new Date(Date.now() + 30 * 86_400_000),
    });
    console.log(`Project ${project.id} drafted`);
  }
  if (project.status === "draft") {
    await savePlan(owner, project.id, {
      scope: PROJECT_SCOPE,
      criteria: PROJECT_CRITERIA,
      milestones: PROJECT_MILESTONES,
      budgetCents: 20000,
      open: true,
    });
    project = (await load())!;
    console.log("Project opened for proposals");
  }
  if (project.status === "open") {
    let proposal = await db().query.projectProposals.findFirst({
      where: and(
        eq(projectProposals.projectId, project.id),
        eq(projectProposals.sellerId, seller.id),
      ),
    });
    if (!proposal) {
      proposal = await propose(client, seller, project.id, {
        message: PROPOSAL_MESSAGE,
        priceCents: 20000,
        days: 7,
      });
      console.log("Proposal submitted");
    }
    if (proposal.status === "pending") {
      await acceptProposal(owner, project.id, proposal.id);
      console.log("Proposal accepted; project in progress");
    }
    project = (await load())!;
  }
  if (project.status === "in_progress") {
    const milestones = await db().query.projectMilestones.findMany({
      where: eq(projectMilestones.projectId, project.id),
      orderBy: asc(projectMilestones.position),
    });
    const [first, second] = milestones;
    if (!first || !second) throw new Error("Expected two milestones on the demo project");
    let status = first.status;
    if (status === "pending") {
      await fundMilestone(owner, first.id);
      status = "funded";
    }
    if (status === "funded" || status === "changes_requested") {
      await submitDelivery(client, seller, first.id, MILESTONE_1_DELIVERY);
      status = "submitted";
    }
    if (status === "submitted") {
      await approveMilestone(client, owner, first.id);
      status = "released";
    }
    console.log(`Milestone 1: ${status}`);
    if (second.status === "pending") {
      await fundMilestone(owner, second.id);
      console.log("Milestone 2 funded and held in escrow");
    }
    console.log(
      `Drive milestone 2 yourself: submit its delivery as ${seller.email}, then approve as ${owner.email}. Project: /projects/${project.id}`,
    );
    return;
  }
  console.log(`Project ${project.id} is ${project.status}; leaving it alone`);
}

main()
  .then(() => process.exit(0))
  .catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  });
