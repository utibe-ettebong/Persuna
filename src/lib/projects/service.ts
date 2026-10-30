/**
 * Projects: someone posts a piece of work, sellers propose, the poster picks
 * one, and the work is delivered and paid milestone by milestone through
 * escrow. Persuna takes part at every stage and posts each check to the
 * timeline: it turns the brief into scope, criteria and milestones (and flags
 * vague or unfair terms), writes a fit report on each proposal, checks every
 * delivery against its criteria, assesses disputes, and wraps up.
 *
 * Briefs, deliveries and messages are material: they stay in these tables and
 * are blanked after the retention period. They never go into a skill.
 */
import { peopleFor } from "@/lib/profile/service";
import { randomBytes } from "node:crypto";
import { and, asc, desc, eq, inArray, isNull, lt, ne, or } from "drizzle-orm";
import { db, schema } from "@/db/client";
import type { Project, ProjectMilestone } from "@/db/schema";
import { env, paystackConfig } from "@/env";
import { audit, type Actor } from "@/lib/audit";
import { isVerified, splitPayment } from "@/lib/market/rules";
import { verificationFor } from "@/lib/market/verification";
import type { ModelClient } from "@/lib/models/gateway";
import { formatUsd } from "@/lib/money";
import { createPaystack, paymentMatches } from "@/lib/payments/paystack";
import { refundProviderPayment } from "@/lib/payments/service";
import { sayToUser } from "@/lib/persuna/service";
import { NotFoundError } from "@/lib/skill/service";
import { normalizeText } from "@/lib/text";
import {
  assessDispute,
  checkDelivery,
  checkLine,
  planProject,
  proposalFit,
  wrapUp,
} from "./checks";
import {
  allocate,
  allSettled,
  cancelAllowed,
  changesAllowed,
  HELD,
  MAX_BUDGET_CENTS,
  MIN_BUDGET_CENTS,
  milestoneProblem,
  nextMilestoneStatus,
  nextProjectStatus,
  ProjectRuleError,
  type MilestoneEvent,
} from "./rules";
import type { PlanMilestone, ProjectPlan } from "./types";

const {
  projects,
  projectMilestones,
  projectProposals,
  projectUpdates,
  listings,
  skills,
  authUsers,
} = schema;

/** Who is looking: a signed-in person, or nobody. */
export type Viewer = { id: string; email: string; name: string; isAdmin: boolean } | null;
export type Role = "poster" | "seller" | "proposer" | "admin" | "visitor" | "public";

const actorOf = (user: { email: string }): Actor => `user:${user.email}`;
const firstName = (name: string | null | undefined) => name?.split(/\s+/)[0] || "Someone";

type Tx = Parameters<Parameters<ReturnType<typeof db>["transaction"]>[0]>[0];

async function post(values: typeof projectUpdates.$inferInsert, tx: Pick<Tx, "insert"> = db()) {
  await tx.insert(projectUpdates).values({ ...values, body: values.body.slice(0, 4000) });
}

async function loadProject(projectId: string) {
  const project = await db().query.projects.findFirst({ where: eq(projects.id, projectId) });
  if (!project) throw new NotFoundError("No such project");
  return project;
}

async function milestonesOf(projectId: string) {
  return db()
    .select()
    .from(projectMilestones)
    .where(eq(projectMilestones.projectId, projectId))
    .orderBy(asc(projectMilestones.position));
}

async function chosenSellerId(project: Project) {
  if (!project.chosenProposalId) return null;
  const p = await db().query.projectProposals.findFirst({
    where: eq(projectProposals.id, project.chosenProposalId),
  });
  return p?.sellerId ?? null;
}

/** A milestone with its project, checked to belong to a project this person may act on. */
async function milestoneFor(milestoneId: string) {
  const [row] = await db()
    .select({ milestone: projectMilestones, project: projects })
    .from(projectMilestones)
    .innerJoin(projects, eq(projectMilestones.projectId, projects.id))
    .where(eq(projectMilestones.id, milestoneId));
  if (!row) throw new NotFoundError("No such milestone");
  return row;
}

function requirePoster(project: Project, user: { id: string }) {
  if (project.posterId !== user.id) throw new NotFoundError("No such project");
}

/** Moves a milestone only if it is still in the state we read (no double payouts). */
async function moveMilestone(
  m: ProjectMilestone,
  event: MilestoneEvent,
  set: Partial<typeof projectMilestones.$inferInsert> = {},
  tx: Tx | ReturnType<typeof db> = db(),
) {
  const status = nextMilestoneStatus(m.status, event);
  const [row] = await tx
    .update(projectMilestones)
    .set({ ...set, status })
    .where(and(eq(projectMilestones.id, m.id), eq(projectMilestones.status, m.status)))
    .returning();
  if (!row) throw new ProjectRuleError("This milestone just changed; reload and try again");
  return row;
}

/* ---------- Posting ---------- */

export interface NewProject {
  title: string;
  brief: string;
  budgetCents: number;
  deadline: Date;
}

/** The poster describes the work; Persuna drafts the plan. It stays a draft until they confirm. */
export async function createProject(
  client: ModelClient,
  user: NonNullable<Viewer>,
  input: NewProject,
) {
  const title = normalizeText(input.title).slice(0, 120);
  const brief = normalizeText(input.brief).slice(0, 10_000);
  if (input.budgetCents < MIN_BUDGET_CENTS || input.budgetCents > MAX_BUDGET_CENTS) {
    throw new ProjectRuleError(`Set a budget of at least ${formatUsd(MIN_BUDGET_CENTS)}`);
  }
  const now = new Date();
  const plan = await planProject(client, {
    title,
    brief,
    budgetCents: input.budgetCents,
    deadline: input.deadline,
    now,
  });
  const project = await db().transaction(async (tx) => {
    const [row] = await tx
      .insert(projects)
      .values({
        posterId: user.id,
        title,
        brief,
        budgetCents: input.budgetCents,
        deadline: input.deadline,
        plan,
      })
      .returning();
    await post(
      {
        projectId: row.id,
        author: "persuna",
        kind: "plan",
        body: `I read the brief and drafted a scope, ${plan.criteria.length} acceptance criteria and ${plan.milestones.length} milestone(s) adding up to ${formatUsd(input.budgetCents)}. ${
          plan.flags.length
            ? `Before it opens, check: ${plan.flags.map((f) => f.message).join(" ")}`
            : "Nothing vague or one-sided stood out."
        } Edit anything you like, then open it.`,
      },
      tx,
    );
    await audit(
      {
        actor: actorOf(user),
        action: "project.created",
        entityType: "project",
        entityId: row.id,
        details: {
          budgetCents: input.budgetCents,
          milestones: plan.milestones.length,
          flags: plan.flags.map((f) => f.kind),
        },
      },
      tx,
    );
    return row;
  });
  return project;
}

/**
 * The poster edits Persuna's plan (scope, criteria, milestones, budget) and,
 * with `open`, publishes the project: milestones are created and sellers can propose.
 */
export async function savePlan(
  user: NonNullable<Viewer>,
  projectId: string,
  input: {
    scope: string;
    criteria: string[];
    milestones: PlanMilestone[];
    budgetCents: number;
    open: boolean;
  },
) {
  const project = await loadProject(projectId);
  requirePoster(project, user);
  if (project.status !== "draft") throw new ProjectRuleError("Only a draft can be edited");
  if (input.budgetCents < MIN_BUDGET_CENTS || input.budgetCents > MAX_BUDGET_CENTS) {
    throw new ProjectRuleError(`Set a budget of at least ${formatUsd(MIN_BUDGET_CENTS)}`);
  }
  const milestones = input.milestones.map((m) => ({
    title: m.title.trim().slice(0, 120),
    criteria: m.criteria.map((c) => c.trim().slice(0, 600)).filter(Boolean),
    amountCents: m.amountCents,
  }));
  const problem = milestoneProblem(milestones, input.budgetCents);
  if (problem) throw new ProjectRuleError(problem);
  const plan: ProjectPlan = {
    scope: normalizeText(input.scope).slice(0, 3000),
    criteria: input.criteria
      .map((c) => c.trim())
      .filter(Boolean)
      .slice(0, 12),
    milestones,
    flags: project.plan?.flags ?? [],
  };
  if (!plan.scope) throw new ProjectRuleError("Describe the scope");

  await db().transaction(async (tx) => {
    await tx
      .update(projects)
      .set({
        plan,
        budgetCents: input.budgetCents,
        updatedAt: new Date(),
        ...(input.open ? { status: nextProjectStatus("draft", "open") } : {}),
      })
      .where(and(eq(projects.id, projectId), eq(projects.status, "draft")));
    if (input.open) {
      await tx.insert(projectMilestones).values(
        milestones.map((m, i) => ({
          projectId,
          position: i + 1,
          title: m.title,
          criteria: m.criteria,
          amountCents: m.amountCents,
        })),
      );
      await post(
        {
          projectId,
          author: "persuna",
          kind: "opened",
          body: `Open for proposals: ${milestones.length} milestone(s), ${formatUsd(input.budgetCents)} in total. Each milestone is paid into escrow before work on it starts and released only when it's approved. I'll check every delivery against its criteria.`,
        },
        tx,
      );
    }
    await audit(
      {
        actor: actorOf(user),
        action: input.open ? "project.opened" : "project.plan_saved",
        entityType: "project",
        entityId: projectId,
        details: { milestones: milestones.length, budgetCents: input.budgetCents },
      },
      tx,
    );
  });
}

/* ---------- Browsing ---------- */

/** Open projects, newest first, with how many proposals each has. */
export async function listOpenProjects() {
  await purgeExpiredProjects();
  const rows = await db()
    .select()
    .from(projects)
    .where(eq(projects.status, "open"))
    .orderBy(desc(projects.createdAt))
    .limit(100);
  const counts = await proposalCounts(rows.map((r) => r.id));
  return rows.map((p) => ({ project: p, proposals: counts.get(p.id) ?? 0 }));
}

async function proposalCounts(projectIds: string[]) {
  if (!projectIds.length) return new Map<string, number>();
  const rows = await db()
    .select({ projectId: projectProposals.projectId })
    .from(projectProposals)
    .where(inArray(projectProposals.projectId, projectIds));
  const counts = new Map<string, number>();
  for (const r of rows) counts.set(r.projectId, (counts.get(r.projectId) ?? 0) + 1);
  return counts;
}

/** Every disputed project with its milestones, newest first. Admins only. */
export interface DisputedProject {
  project: Project;
  posterEmail: string | null;
  milestones: ProjectMilestone[];
}

export async function listDisputedProjects(): Promise<DisputedProject[]> {
  const rows = await db()
    .select({ project: projects, posterEmail: authUsers.email })
    .from(projects)
    .leftJoin(authUsers, eq(projects.posterId, authUsers.id))
    .where(eq(projects.status, "disputed"))
    .orderBy(desc(projects.updatedAt));
  if (!rows.length) return [];
  const milestones = await db()
    .select()
    .from(projectMilestones)
    .where(
      inArray(
        projectMilestones.projectId,
        rows.map((r) => r.project.id),
      ),
    )
    .orderBy(asc(projectMilestones.position));
  return rows.map(({ project, posterEmail }) => ({
    project,
    posterEmail,
    milestones: milestones.filter((m) => m.projectId === project.id),
  }));
}

/** Projects this person posted, and ones they proposed on. */
export async function projectsFor(userId: string) {
  const posted = await db()
    .select()
    .from(projects)
    .where(eq(projects.posterId, userId))
    .orderBy(desc(projects.updatedAt));
  const proposed = await db()
    .select({ project: projects, proposal: projectProposals })
    .from(projectProposals)
    .innerJoin(projects, eq(projectProposals.projectId, projects.id))
    .where(eq(projectProposals.sellerId, userId))
    .orderBy(desc(projects.updatedAt));
  return { posted, proposed };
}

/**
 * One project as this viewer may see it. Anyone sees the title, scope,
 * budget and milestones of a posted project; signed-in people also see the
 * brief; proposals, deliveries, checks and the timeline are only for the
 * people on it (each seller sees their own proposal and its fit report).
 */
export async function getProject(projectId: string, viewer: Viewer) {
  const project = await loadProject(projectId);
  const proposals = await db()
    .select({ proposal: projectProposals, seller: schema.authUsers.name })
    .from(projectProposals)
    .innerJoin(schema.authUsers, eq(projectProposals.sellerId, schema.authUsers.id))
    .where(eq(projectProposals.projectId, projectId))
    .orderBy(asc(projectProposals.createdAt));
  const chosen = proposals.find((p) => p.proposal.id === project.chosenProposalId) ?? null;
  const mine = viewer ? proposals.find((p) => p.proposal.sellerId === viewer.id) : undefined;

  const role: Role = !viewer
    ? "public"
    : viewer.id === project.posterId
      ? "poster"
      : chosen && chosen.proposal.sellerId === viewer.id
        ? "seller"
        : mine
          ? "proposer"
          : viewer.isAdmin
            ? "admin"
            : "visitor";
  const party = role === "poster" || role === "seller" || role === "admin";
  if (project.status === "draft" && role !== "poster" && role !== "admin") {
    throw new NotFoundError("No such project");
  }

  const milestones = await milestonesOf(projectId);
  const updates =
    role === "public" || role === "visitor"
      ? []
      : (
          await db()
            .select()
            .from(projectUpdates)
            .where(eq(projectUpdates.projectId, projectId))
            .orderBy(asc(projectUpdates.createdAt))
        ).filter((u) =>
          role === "poster" || role === "admin"
            ? true
            : role === "seller"
              ? u.proposalId === null || u.proposalId === chosen?.proposal.id
              : u.proposalId === mine?.proposal.id,
        );
  const shown = (role === "poster" || role === "admin" ? proposals : mine ? [mine] : []).map(
    (p) => p.proposal.sellerId,
  );
  // Names as each person chose to show them, and links to their profiles.
  const people = await peopleFor([
    project.posterId,
    ...shown,
    ...(chosen ? [chosen.proposal.sellerId] : []),
  ]);
  const person = (id: string, fallback: string | null | undefined) =>
    people.get(id) ?? { name: firstName(fallback), handle: null };

  return {
    project: { ...project, brief: role === "public" ? null : project.brief },
    role,
    poster: person(project.posterId, null),
    seller: chosen ? person(chosen.proposal.sellerId, chosen.seller) : null,
    posterName: person(project.posterId, null).name,
    sellerName: chosen ? person(chosen.proposal.sellerId, chosen.seller).name : null,
    milestones: milestones.map((m) => ({
      ...m,
      delivery: party ? m.delivery : null,
      check: party ? m.check : null,
    })),
    proposals: (role === "poster" || role === "admin" ? proposals : mine ? [mine] : []).map(
      (p) => ({
        ...p.proposal,
        sellerName: person(p.proposal.sellerId, p.seller).name,
        sellerHandle: person(p.proposal.sellerId, p.seller).handle,
      }),
    ),
    proposalCount: proposals.length,
    updates,
  };
}

/* ---------- Proposals ---------- */

/** The seller's live listings that Persuna has verified, with scores. */
async function verifiedSkillsOf(userId: string) {
  const rows = await db()
    .select({ title: listings.title, publishedVersionId: skills.publishedVersionId })
    .from(listings)
    .innerJoin(skills, eq(listings.skillId, skills.id))
    .where(and(eq(skills.ownerId, userId), eq(listings.active, true)));
  const minScore = env().LISTING_MIN_SCORE;
  const out: { title: string; score: number }[] = [];
  for (const r of rows) {
    const v = await verificationFor(r.publishedVersionId);
    if (isVerified(v, minScore)) out.push({ title: r.title, score: v.score });
  }
  return out;
}

export async function listingsOf(userId: string) {
  return db()
    .select({ id: listings.id, title: listings.title })
    .from(listings)
    .innerJoin(skills, eq(listings.skillId, skills.id))
    .where(and(eq(skills.ownerId, userId), eq(listings.active, true)));
}

/** A seller proposes; Persuna writes the poster a fit report. */
export async function propose(
  client: ModelClient,
  user: NonNullable<Viewer>,
  projectId: string,
  input: { message: string; priceCents: number; days: number; listingId?: string | null },
) {
  const project = await loadProject(projectId);
  if (project.status !== "open") throw new ProjectRuleError("This project isn't taking proposals");
  if (project.posterId === user.id)
    throw new ProjectRuleError("You can't propose on your own project");
  if (!project.plan) throw new ProjectRuleError("This project has no plan yet");
  const existing = await db().query.projectProposals.findFirst({
    where: and(eq(projectProposals.projectId, projectId), eq(projectProposals.sellerId, user.id)),
  });
  if (existing) throw new ProjectRuleError("You've already proposed on this project");
  if (input.listingId) {
    const own = (await listingsOf(user.id)).some((l) => l.id === input.listingId);
    if (!own) throw new NotFoundError("No such listing");
  }
  const message = normalizeText(input.message).slice(0, 4000);
  const fit = await proposalFit(client, {
    plan: project.plan,
    budgetCents: project.budgetCents,
    deadline: project.deadline,
    priceCents: input.priceCents,
    days: input.days,
    message,
    skills: await verifiedSkillsOf(user.id),
  });

  const proposal = await db().transaction(async (tx) => {
    const [row] = await tx
      .insert(projectProposals)
      .values({
        projectId,
        sellerId: user.id,
        listingId: input.listingId ?? null,
        message,
        priceCents: input.priceCents,
        days: input.days,
        fit,
      })
      .returning();
    await post(
      {
        projectId,
        proposalId: row.id,
        author: "seller",
        kind: "proposal",
        body: `${firstName(user.name)} proposed ${formatUsd(input.priceCents)} over ${input.days} day(s).`,
      },
      tx,
    );
    await post(
      {
        projectId,
        proposalId: row.id,
        author: "persuna",
        kind: "fit",
        body: `Fit for ${firstName(user.name)}: ${fit.recommendation}. ${fit.summary} Price ${fit.priceNote}.`,
      },
      tx,
    );
    await audit(
      {
        actor: actorOf(user),
        action: "proposal.created",
        entityType: "proposal",
        entityId: row.id,
        details: {
          projectId,
          priceCents: input.priceCents,
          days: input.days,
          recommendation: fit.recommendation,
        },
      },
      tx,
    );
    return row;
  });
  await sayToUser(
    project.posterId,
    `New proposal on "${project.title}": ${formatUsd(input.priceCents)} over ${input.days} day(s). My read: ${fit.recommendation} fit. It's on the project page.`,
  );
  return proposal;
}

/**
 * The poster picks a proposal. The milestone amounts are rescaled to the
 * agreed price (in proportion, to the cent) and the other proposals are declined.
 */
export async function acceptProposal(
  user: NonNullable<Viewer>,
  projectId: string,
  proposalId: string,
) {
  const project = await loadProject(projectId);
  requirePoster(project, user);
  const proposal = await db().query.projectProposals.findFirst({
    where: and(eq(projectProposals.id, proposalId), eq(projectProposals.projectId, projectId)),
  });
  if (!proposal || proposal.status !== "pending") throw new NotFoundError("No such proposal");
  const status = nextProjectStatus(project.status, "accept");
  const milestones = await milestonesOf(projectId);
  const amounts = allocate(
    proposal.priceCents,
    milestones.map((m) => m.amountCents),
  );

  await db().transaction(async (tx) => {
    const [moved] = await tx
      .update(projects)
      .set({ status, chosenProposalId: proposal.id, updatedAt: new Date() })
      .where(and(eq(projects.id, projectId), eq(projects.status, "open")))
      .returning();
    if (!moved) throw new ProjectRuleError("This project just changed; reload and try again");
    for (const [i, m] of milestones.entries()) {
      await tx
        .update(projectMilestones)
        .set({ amountCents: amounts[i] })
        .where(eq(projectMilestones.id, m.id));
    }
    await tx
      .update(projectProposals)
      .set({ status: "accepted" })
      .where(eq(projectProposals.id, proposal.id));
    await tx
      .update(projectProposals)
      .set({ status: "declined" })
      .where(
        and(
          eq(projectProposals.projectId, projectId),
          ne(projectProposals.id, proposal.id),
          eq(projectProposals.status, "pending"),
        ),
      );
    await post(
      {
        projectId,
        author: "persuna",
        kind: "accepted",
        body: `The poster accepted a proposal at ${formatUsd(proposal.priceCents)}; the milestones now add up to that. Fund the first milestone to start: the money is held until its work is approved.`,
      },
      tx,
    );
    await audit(
      {
        actor: actorOf(user),
        action: "proposal.accepted",
        entityType: "proposal",
        entityId: proposal.id,
        details: { projectId, priceCents: proposal.priceCents },
      },
      tx,
    );
  });
  await sayToUser(
    proposal.sellerId,
    `Your proposal on "${project.title}" was accepted at ${formatUsd(proposal.priceCents)}. Work starts on each milestone once it's funded.`,
  );
}

/* ---------- Escrow per milestone ---------- */

/**
 * The poster pays a milestone into escrow. Mock payments are held at once;
 * with Paystack the poster is sent to checkout (in USD) and the milestone is
 * funded only after the payment is verified server-side.
 */
export async function fundMilestone(user: NonNullable<Viewer>, milestoneId: string) {
  const { milestone, project } = await milestoneFor(milestoneId);
  requirePoster(project, user);
  if (project.status !== "in_progress") {
    throw new ProjectRuleError("Milestones are funded once a proposal is accepted");
  }
  nextMilestoneStatus(milestone.status, "fund");

  const paystack = paystackConfig();
  if (!paystack) {
    await moveMilestone(milestone, "fund", { provider: "mock", fundedAt: new Date() });
    await afterFunded(milestone, project, "mock");
    return { redirectUrl: null };
  }
  const reference = `persuna-ms-${milestone.id}-${randomBytes(3).toString("hex")}`;
  await db()
    .update(projectMilestones)
    .set({ provider: "paystack", paymentReference: reference })
    .where(and(eq(projectMilestones.id, milestone.id), eq(projectMilestones.status, "pending")));
  const { authorizationUrl } = await createPaystack(paystack.secretKey).initialize({
    email: user.email,
    amountCents: milestone.amountCents,
    reference,
    callbackUrl: `${paystack.appUrl}/projects/milestones/${milestone.id}/paid`,
    metadata: { projectId: project.id, milestoneId: milestone.id },
  });
  await audit({
    actor: actorOf(user),
    action: "payment.started",
    entityType: "milestone",
    entityId: milestone.id,
    details: { projectId: project.id, amountCents: milestone.amountCents, provider: "paystack" },
  });
  return { redirectUrl: authorizationUrl };
}

async function afterFunded(milestone: ProjectMilestone, project: Project, provider: string) {
  await audit({
    actor: "system",
    action: "payment.held",
    entityType: "milestone",
    entityId: milestone.id,
    details: {
      projectId: project.id,
      amountCents: milestone.amountCents,
      currency: "USD",
      provider,
    },
  });
  await post({
    projectId: project.id,
    milestoneId: milestone.id,
    author: "persuna",
    kind: "funded",
    body: `Milestone ${milestone.position} (${formatUsd(milestone.amountCents)}) is funded and held in escrow. The seller can start.`,
  });
  const sellerId = await chosenSellerId(project);
  if (sellerId) {
    await sayToUser(
      sellerId,
      `Milestone ${milestone.position} of "${project.title}" is funded (${formatUsd(milestone.amountCents)} held). You can start.`,
    );
  }
}

/**
 * Confirms a milestone payment with Paystack (from the checkout redirect or
 * the webhook): paid, in USD, for exactly the milestone's cents. Safe to call
 * more than once.
 */
export async function confirmMilestonePayment(reference: string) {
  const paystack = paystackConfig();
  if (!paystack) throw new Error("Paystack is not configured");
  const milestone = await db().query.projectMilestones.findFirst({
    where: eq(projectMilestones.paymentReference, reference),
  });
  if (!milestone) throw new NotFoundError("Unknown payment reference");
  if (milestone.status !== "pending") return milestone;
  const result = await createPaystack(paystack.secretKey).verify(reference);
  if (!result.paid) throw new Error("The payment hasn't completed");
  if (!paymentMatches(result, milestone.amountCents)) {
    throw new Error("The amount paid doesn't match the milestone");
  }
  const [funded] = await db()
    .update(projectMilestones)
    .set({ status: "funded", fundedAt: new Date() })
    .where(
      and(
        eq(projectMilestones.id, milestone.id),
        eq(projectMilestones.status, "pending"),
        eq(projectMilestones.paymentReference, reference),
      ),
    )
    .returning();
  if (!funded) return milestone; // confirmed by another request first
  await afterFunded(funded, await loadProject(funded.projectId), "paystack");
  return funded;
}

/* ---------- Delivery, checks and approval ---------- */

/** The seller hands in a milestone; Persuna checks it against the criteria for both sides. */
export async function submitDelivery(
  client: ModelClient,
  user: NonNullable<Viewer>,
  milestoneId: string,
  delivery: string,
) {
  const { milestone, project } = await milestoneFor(milestoneId);
  if ((await chosenSellerId(project)) !== user.id) throw new NotFoundError("No such milestone");
  if (project.status !== "in_progress")
    throw new ProjectRuleError("This project isn't in progress");
  nextMilestoneStatus(milestone.status, "submit");
  const text = normalizeText(delivery).slice(0, 20_000);
  if (text.length < 10) throw new ProjectRuleError("Describe or paste the delivery");

  const earlierRequests = (
    await db()
      .select({ body: projectUpdates.body })
      .from(projectUpdates)
      .where(and(eq(projectUpdates.milestoneId, milestone.id), eq(projectUpdates.kind, "changes")))
      .orderBy(asc(projectUpdates.createdAt))
  ).map((u) => u.body);
  const check = await checkDelivery(client, {
    milestone: milestone.title,
    criteria: milestone.criteria,
    delivery: text,
    round: milestone.rounds + 1,
    earlierRequests,
  });
  await moveMilestone(milestone, "submit", { delivery: text, check, submittedAt: new Date() });
  await post({
    projectId: project.id,
    milestoneId: milestone.id,
    author: "seller",
    kind: "delivery",
    body: `Delivered milestone ${milestone.position}${milestone.rounds ? ` (round ${milestone.rounds + 1})` : ""}.`,
  });
  await post({
    projectId: project.id,
    milestoneId: milestone.id,
    author: "persuna",
    kind: "check",
    body: `Checked "${milestone.title}" against its criteria: ${checkLine(check)} ${check.summary} For the poster: ${check.fairness.poster} For the seller: ${check.fairness.seller}`,
  });
  await audit({
    actor: actorOf(user),
    action: "milestone.submitted",
    entityType: "milestone",
    entityId: milestone.id,
    details: {
      projectId: project.id,
      round: milestone.rounds + 1,
      met: check.results.filter((r) => r.verdict === "met").length,
      notMet: check.results.filter((r) => r.verdict === "not_met").length,
      unclear: check.results.filter((r) => r.verdict === "unclear").length,
    },
  });
  await sayToUser(
    project.posterId,
    `Milestone ${milestone.position} of "${project.title}" was delivered. I checked it: ${checkLine(check)} Approve it or ask for changes on the project page.`,
  );
  return check;
}

/** The poster asks for changes, within the allowed rounds. The money stays held. */
export async function requestMilestoneChanges(
  user: NonNullable<Viewer>,
  milestoneId: string,
  note: string,
) {
  const { milestone, project } = await milestoneFor(milestoneId);
  requirePoster(project, user);
  const allowed = changesAllowed(milestone.rounds);
  if (!allowed.ok) throw new ProjectRuleError(allowed.reason);
  const text = normalizeText(note).slice(0, 2000);
  if (text.length < 5) throw new ProjectRuleError("Say what should change");
  await moveMilestone(milestone, "request_changes", { rounds: milestone.rounds + 1 });
  await post({
    projectId: project.id,
    milestoneId: milestone.id,
    author: "poster",
    kind: "changes",
    body: text,
  });
  await audit({
    actor: actorOf(user),
    action: "milestone.changes_requested",
    entityType: "milestone",
    entityId: milestone.id,
    details: { projectId: project.id, round: milestone.rounds + 1 },
  });
  const sellerId = await chosenSellerId(project);
  if (sellerId) {
    await sayToUser(
      sellerId,
      `The poster asked for changes to milestone ${milestone.position} of "${project.title}". Details are on the project page.`,
    );
  }
}

/** Pays a milestone out of escrow to the seller, minus the platform fee. */
async function release(
  milestone: ProjectMilestone,
  project: Project,
  event: "approve" | "settle",
  actor: Actor,
) {
  const split = splitPayment(milestone.amountCents, env().PLATFORM_FEE_PERCENT);
  await db().transaction(async (tx) => {
    const set = {
      platformFeeCents: split.platformFeeCents,
      sellerShareCents: split.ownerShareCents,
      settledAt: new Date(),
    };
    if (event === "approve") {
      const approved = await moveMilestone(milestone, "approve", {}, tx);
      await moveMilestone(approved, "release", set, tx);
    } else {
      await moveMilestone(milestone, "settle", set, tx);
    }
    await audit(
      {
        actor,
        action: "payment.released",
        entityType: "milestone",
        entityId: milestone.id,
        details: {
          projectId: project.id,
          amountCents: milestone.amountCents,
          sellerShareCents: split.ownerShareCents,
          platformFeeCents: split.platformFeeCents,
          via: event,
        },
      },
      tx,
    );
    await post(
      {
        projectId: project.id,
        milestoneId: milestone.id,
        author: "persuna",
        kind: event === "approve" ? "approved" : "resolved",
        body: `${event === "approve" ? "Approved." : "Settled by a Persuna reviewer."} Released ${formatUsd(split.ownerShareCents)} to the seller (${formatUsd(milestone.amountCents)} minus the ${env().PLATFORM_FEE_PERCENT}% platform fee).`,
      },
      tx,
    );
  });
}

/** The poster approves a delivery: escrow is released to the seller minus the platform fee. */
export async function approveMilestone(
  client: ModelClient,
  user: NonNullable<Viewer>,
  milestoneId: string,
) {
  const { milestone, project } = await milestoneFor(milestoneId);
  requirePoster(project, user);
  if (project.status !== "in_progress")
    throw new ProjectRuleError("This project isn't in progress");
  await release(milestone, project, "approve", actorOf(user));
  const sellerId = await chosenSellerId(project);
  if (sellerId) {
    await sayToUser(
      sellerId,
      `Milestone ${milestone.position} of "${project.title}" was approved and paid out.`,
    );
  }
  await finishIfSettled(client, project.id);
}

/** Completes the project once every milestone is paid out (or refunded, with one paid). */
async function finishIfSettled(client: ModelClient, projectId: string) {
  const project = await loadProject(projectId);
  const milestones = await milestonesOf(projectId);
  if (!allSettled(milestones.map((m) => m.status))) return;
  const anyPaid = milestones.some((m) => m.status === "released");
  const status = nextProjectStatus(
    project.status,
    anyPaid ? "complete" : project.status === "disputed" ? "close" : "cancel",
  );
  const now = new Date();
  const [done] = await db()
    .update(projects)
    .set({
      status,
      completedAt: now,
      updatedAt: now,
      expiresAt: new Date(now.getTime() + env().JOB_RETENTION_DAYS * 86_400_000),
    })
    .where(and(eq(projects.id, projectId), eq(projects.status, project.status)))
    .returning();
  if (!done) return;
  await audit({
    actor: "system",
    action: status === "completed" ? "project.completed" : "project.closed",
    entityType: "project",
    entityId: projectId,
    details: {
      milestones: milestones.length,
      released: milestones.filter((m) => m.status === "released").length,
    },
  });
  if (status !== "completed") return;
  const wrap = await wrapUp(client, {
    title: project.title,
    milestones: milestones.map((m) => ({
      title: m.title,
      rounds: m.rounds,
      summary: m.check?.summary ?? null,
    })),
    onTime: now <= project.deadline,
  }).catch(() => null);
  await post({
    projectId,
    author: "persuna",
    kind: "wrapup",
    body: wrap
      ? [
          wrap.summary,
          wrap.wentWell.length ? `Went well: ${wrap.wentWell.join(" ")}` : "",
          wrap.toImprove.length ? `Next time: ${wrap.toImprove.join(" ")}` : "",
          "Both of you can now rate the other.",
        ]
          .filter(Boolean)
          .join(" ")
      : "Every milestone is paid. Both of you can now rate the other.",
  });
  const sellerId = await chosenSellerId(project);
  for (const id of [project.posterId, sellerId]) {
    if (id)
      await sayToUser(id, `"${project.title}" is complete. Rate how it went on the project page.`);
  }
}

/** After completion, each side rates the other once. */
export async function rateProject(
  user: NonNullable<Viewer>,
  projectId: string,
  rating: number,
  review: string,
) {
  if (!Number.isInteger(rating) || rating < 1 || rating > 5)
    throw new ProjectRuleError("Rate from 1 to 5");
  const project = await loadProject(projectId);
  if (project.status !== "completed")
    throw new ProjectRuleError("Rate once the project is complete");
  const asPoster = project.posterId === user.id;
  const asSeller = !asPoster && (await chosenSellerId(project)) === user.id;
  if (!asPoster && !asSeller) throw new NotFoundError("No such project");
  if (asPoster ? project.posterRating : project.sellerRating) {
    throw new ProjectRuleError("You've already rated this project");
  }
  const text = review.trim().slice(0, 1000) || null;
  await db()
    .update(projects)
    .set(
      asPoster
        ? { posterRating: rating, posterReview: text }
        : { sellerRating: rating, sellerReview: text },
    )
    .where(eq(projects.id, projectId));
  await post({
    projectId,
    author: asPoster ? "poster" : "seller",
    kind: "rating",
    body: `Rated the ${asPoster ? "seller" : "poster"} ${rating}/5.${text ? ` “${text}”` : ""}`,
  });
  await audit({
    actor: actorOf(user),
    action: "project.rated",
    entityType: "project",
    entityId: projectId,
    details: { rating, by: asPoster ? "poster" : "seller" },
  });
}

/* ---------- Disputes and cancellation ---------- */

/**
 * Either side raises a dispute. Persuna records a neutral assessment; held
 * money stays held and a person decides (resolveMilestone).
 */
export async function raiseDispute(
  client: ModelClient,
  user: NonNullable<Viewer>,
  projectId: string,
  reason: string,
) {
  const project = await loadProject(projectId);
  const sellerId = await chosenSellerId(project);
  const raisedBy = project.posterId === user.id ? "poster" : sellerId === user.id ? "seller" : null;
  if (!raisedBy) throw new NotFoundError("No such project");
  const status = nextProjectStatus(project.status, "dispute");
  const text = normalizeText(reason).slice(0, 2000);
  if (text.length < 10) throw new ProjectRuleError("Explain what's wrong (10+ characters)");
  const milestones = await milestonesOf(projectId);
  const assessment = await assessDispute(client, {
    scope: project.plan?.scope ?? project.title,
    raisedBy,
    reason: text,
    milestones: milestones.map((m) => ({
      title: m.title,
      status: m.status,
      criteria: m.criteria,
      check: m.check ? `${checkLine(m.check)} ${m.check.summary}` : null,
    })),
  });
  await db().transaction(async (tx) => {
    const [moved] = await tx
      .update(projects)
      .set({ status, updatedAt: new Date() })
      .where(and(eq(projects.id, projectId), eq(projects.status, project.status)))
      .returning();
    if (!moved) throw new ProjectRuleError("This project just changed; reload and try again");
    await post({ projectId, author: raisedBy, kind: "dispute", body: text }, tx);
    await post(
      {
        projectId,
        author: "persuna",
        kind: "assessment",
        body: `Neutral assessment: ${assessment.assessment} The poster's strongest point: ${assessment.posterView} The seller's: ${assessment.sellerView} Suggestion: ${assessment.suggestion} Held money stays in escrow until a Persuna reviewer decides.`,
      },
      tx,
    );
    await audit(
      {
        actor: actorOf(user),
        action: "project.disputed",
        entityType: "project",
        entityId: projectId,
        details: { raisedBy },
      },
      tx,
    );
  });
  const other = raisedBy === "poster" ? sellerId : project.posterId;
  if (other) {
    await sayToUser(
      other,
      `A dispute was raised on "${project.title}". I've written a neutral assessment on the project page; a person will decide.`,
    );
  }
}

/** A Persuna reviewer (admin) settles a disputed milestone: pay the seller or refund the poster. */
export async function resolveMilestone(
  client: ModelClient,
  admin: NonNullable<Viewer>,
  milestoneId: string,
  decision: "release" | "refund",
) {
  if (!admin.isAdmin) throw new NotFoundError("No such milestone");
  const { milestone, project } = await milestoneFor(milestoneId);
  if (project.status !== "disputed")
    throw new ProjectRuleError("Only disputed projects are resolved here");
  if (decision === "release") {
    await release(milestone, project, "settle", actorOf(admin));
  } else {
    await refundMilestone(milestone, project, actorOf(admin), "Dispute decided for the poster");
  }
  await finishIfSettled(client, project.id);
}

/** A reviewer ends the dispute and lets the work carry on. */
export async function resumeProject(admin: NonNullable<Viewer>, projectId: string) {
  if (!admin.isAdmin) throw new NotFoundError("No such project");
  const project = await loadProject(projectId);
  const status = nextProjectStatus(project.status, "resume");
  await db()
    .update(projects)
    .set({ status, updatedAt: new Date() })
    .where(eq(projects.id, projectId));
  await post({
    projectId,
    author: "persuna",
    kind: "resolved",
    body: "A Persuna reviewer closed the dispute; the project carries on.",
  });
  await audit({
    actor: actorOf(admin),
    action: "project.resumed",
    entityType: "project",
    entityId: projectId,
  });
}

async function refundMilestone(
  milestone: ProjectMilestone,
  project: Project,
  actor: Actor,
  note: string,
) {
  if (milestone.status === "pending") return;
  const moved = await moveMilestone(milestone, "refund", { settledAt: new Date() });
  await refundProviderPayment(milestone.provider, milestone.paymentReference, note);
  await audit({
    actor,
    action: "payment.refunded",
    entityType: "milestone",
    entityId: milestone.id,
    details: {
      projectId: project.id,
      amountCents: milestone.amountCents,
      provider: milestone.provider,
    },
  });
  await post({
    projectId: project.id,
    milestoneId: milestone.id,
    author: "persuna",
    kind: "refunded",
    body: `Refunded ${formatUsd(milestone.amountCents)} for milestone ${milestone.position} to the poster.`,
  });
  return moved;
}

/**
 * The poster cancels. Allowed until work is delivered; any funded milestones
 * are refunded through the payment provider.
 */
export async function cancelProject(user: NonNullable<Viewer>, projectId: string) {
  const project = await loadProject(projectId);
  requirePoster(project, user);
  const status = nextProjectStatus(project.status, "cancel");
  const milestones = await milestonesOf(projectId);
  const allowed = cancelAllowed(milestones.map((m) => m.status));
  if (!allowed.ok) throw new ProjectRuleError(allowed.reason);
  for (const m of milestones.filter((m) => HELD.includes(m.status))) {
    await refundMilestone(m, project, actorOf(user), "Project cancelled before work was delivered");
  }
  const now = new Date();
  await db()
    .update(projects)
    .set({
      status,
      updatedAt: now,
      expiresAt: new Date(now.getTime() + env().JOB_RETENTION_DAYS * 86_400_000),
    })
    .where(eq(projects.id, projectId));
  await db()
    .update(projectProposals)
    .set({ status: "declined" })
    .where(and(eq(projectProposals.projectId, projectId), eq(projectProposals.status, "pending")));
  await post({
    projectId,
    author: "poster",
    kind: "cancelled",
    body: "The poster cancelled the project.",
  });
  await audit({
    actor: actorOf(user),
    action: "project.cancelled",
    entityType: "project",
    entityId: projectId,
  });
}

/** The project a milestone belongs to, for redirects after payment. */
export async function projectIdOfMilestone(milestoneId: string) {
  return (await milestoneFor(milestoneId)).project.id;
}

/* ---------- Earnings and retention ---------- */

/** Milestones paid out to this seller, for the Earnings page. */
export async function projectEarnings(sellerId: string) {
  return db()
    .select({ milestone: projectMilestones, project: { id: projects.id, title: projects.title } })
    .from(projectMilestones)
    .innerJoin(projects, eq(projectMilestones.projectId, projects.id))
    .innerJoin(projectProposals, eq(projects.chosenProposalId, projectProposals.id))
    .where(
      and(
        eq(projectProposals.sellerId, sellerId),
        inArray(projectMilestones.status, [
          "funded",
          "submitted",
          "changes_requested",
          "approved",
          "released",
        ]),
      ),
    )
    .orderBy(desc(projectMilestones.createdAt));
}

const REMOVED = "(removed after the retention period)";

/**
 * Blanks the material of projects past their retention date: the brief,
 * plan, deliveries, checks, proposal messages and timeline text. Titles,
 * amounts and statuses stay, as the payment record.
 */
export async function purgeExpiredProjects(now = new Date()) {
  const expired = await db()
    .select({ id: projects.id })
    .from(projects)
    .where(and(lt(projects.expiresAt, now), isNull(projects.purgedAt)));
  if (!expired.length) return 0;
  const ids = expired.map((p) => p.id);
  await db().transaction(async (tx) => {
    await tx
      .update(projects)
      .set({ brief: REMOVED, plan: null, posterReview: null, sellerReview: null, purgedAt: now })
      .where(inArray(projects.id, ids));
    await tx
      .update(projectMilestones)
      .set({ delivery: null, check: null })
      .where(inArray(projectMilestones.projectId, ids));
    await tx
      .update(projectProposals)
      .set({ message: REMOVED, fit: null })
      .where(inArray(projectProposals.projectId, ids));
    await tx
      .update(projectUpdates)
      .set({ body: REMOVED })
      .where(
        and(
          inArray(projectUpdates.projectId, ids),
          or(
            inArray(projectUpdates.kind, [
              "delivery",
              "check",
              "changes",
              "dispute",
              "assessment",
              "plan",
              "fit",
              "wrapup",
              "rating",
            ]),
            eq(projectUpdates.author, "poster"),
          ),
        ),
      );
    await audit(
      {
        actor: "system",
        action: "projects.purged",
        entityType: "project",
        details: { count: ids.length },
      },
      tx,
    );
  });
  return ids.length;
}
