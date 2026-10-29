/**
 * The signed-in home page's numbers and lists, gathered from the services
 * that own them: what needs you now, money earned and held, your skills,
 * projects (as client and seller), orders you placed, and your to-dos.
 */
import { and, asc, desc, eq, inArray } from "drizzle-orm";
import { db, schema } from "@/db/client";
import { env } from "@/env";
import { earnings } from "@/lib/market/service";
import { splitPayment } from "@/lib/market/rules";
import { getProfile, openReminders } from "@/lib/persona/service";
import { projectEarnings, projectsFor } from "@/lib/projects/service";
import { listSkills, publishedScore } from "@/lib/skill/service";
import { projectNextStep, weeklyTotals, type NextStep, type ProjectRole } from "./rules";

const { jobs, listings, projectMilestones, projectProposals, agentImports, skills } = schema;

const HELD = new Set(["funded", "submitted", "changes_requested", "approved"]);

export interface AttentionItem {
  label: string;
  href: string;
  tone: "accent" | "warn" | "neutral";
}

export async function dashboard(userId: string, now = new Date()) {
  const profile = await getProfile(userId);
  const owned = await listSkills(userId);
  const skillIds = owned.map((s) => s.id);

  const [reviewJobs, listingRows, money, milestonePay, mine, orders, imports, todos] =
    await Promise.all([
      skillIds.length
        ? db()
            .select({
              id: jobs.id,
              skillId: jobs.skillId,
              origin: jobs.origin,
              createdAt: jobs.createdAt,
            })
            .from(jobs)
            .where(and(inArray(jobs.skillId, skillIds), eq(jobs.status, "review")))
            .orderBy(asc(jobs.createdAt))
        : Promise.resolve([]),
      skillIds.length
        ? db().select().from(listings).where(inArray(listings.skillId, skillIds))
        : Promise.resolve([]),
      earnings(skillIds),
      projectEarnings(userId),
      projectsFor(userId),
      db()
        .select({ id: jobs.id, status: jobs.status, createdAt: jobs.createdAt, skill: skills.name })
        .from(jobs)
        .innerJoin(skills, eq(jobs.skillId, skills.id))
        .where(and(eq(jobs.requesterUserId, userId), eq(jobs.origin, "renter")))
        .orderBy(desc(jobs.createdAt))
        .limit(5),
      db()
        .select()
        .from(agentImports)
        .where(eq(agentImports.userId, userId))
        .orderBy(desc(agentImports.createdAt))
        .limit(4),
      openReminders(userId),
    ]);

  /* ---------- Money (US dollars, in cents) ---------- */
  const fee = env().PLATFORM_FEE_PERCENT;
  const share = (cents: number) => splitPayment(cents, fee).ownerShareCents;
  const releasedMilestones = milestonePay.filter((m) => m.milestone.status === "released");
  const usdRentals = money.rows.filter((r) => r.transaction.currency === "USD");
  const payments = [
    ...usdRentals
      .filter((r) => r.transaction.status === "released" && r.transaction.settledAt)
      .map((r) => ({ at: r.transaction.settledAt!, cents: r.transaction.ownerShareCents })),
    ...releasedMilestones
      .filter((m) => m.milestone.settledAt)
      .map((m) => ({ at: m.milestone.settledAt!, cents: share(m.milestone.amountCents) })),
  ];
  const weeks = weeklyTotals(payments, now);
  const monthAgo = new Date(now.getTime() - 30 * 86_400_000);

  /* ---------- Skills ---------- */
  const skillRows = await Promise.all(
    owned.map(async (s) => {
      const listing = listingRows.find((l) => l.skillId === s.id) ?? null;
      return {
        slug: s.slug,
        name: s.name,
        published: Boolean(s.publishedVersionId),
        score: await publishedScore(s),
        waiting: reviewJobs.filter((j) => j.skillId === s.id).length,
        listing: listing && {
          active: listing.active,
          paused: Boolean(listing.pausedAt),
          priceCents: listing.priceCents,
          id: listing.id,
        },
      };
    }),
  );

  /* ---------- Projects ---------- */
  const projectIds = [...mine.posted.map((p) => p.id), ...mine.proposed.map((p) => p.project.id)];
  const [milestones, pendingProposals] = projectIds.length
    ? await Promise.all([
        db()
          .select({ projectId: projectMilestones.projectId, status: projectMilestones.status })
          .from(projectMilestones)
          .where(inArray(projectMilestones.projectId, projectIds)),
        db()
          .select({ projectId: projectProposals.projectId })
          .from(projectProposals)
          .where(
            and(
              inArray(projectProposals.projectId, projectIds),
              eq(projectProposals.status, "pending"),
            ),
          ),
      ])
    : [[], []];
  const projectRow = (
    p: (typeof mine.posted)[number],
    role: ProjectRole,
  ): {
    id: string;
    title: string;
    status: string;
    budgetCents: number;
    role: ProjectRole;
    next: NextStep;
  } => ({
    id: p.id,
    title: p.title,
    status: p.status,
    budgetCents: p.budgetCents,
    role,
    next: projectNextStep(
      {
        status: p.status,
        proposals: pendingProposals.filter((x) => x.projectId === p.id).length,
        rated: role === "poster" ? Boolean(p.posterRating) : Boolean(p.sellerRating),
      },
      milestones.filter((m) => m.projectId === p.id),
      role,
    ),
  });
  const projects = [
    ...mine.posted.map((p) => projectRow(p, "poster")),
    ...mine.proposed.map(({ project, proposal }) =>
      projectRow(project, project.chosenProposalId === proposal.id ? "seller" : "proposer"),
    ),
  ].filter((p) => !["cancelled"].includes(p.status));

  /* ---------- What needs you ---------- */
  const attention: AttentionItem[] = [];
  if (reviewJobs.length) {
    attention.push({
      label: `${reviewJobs.length} result${reviewJobs.length === 1 ? "" : "s"} waiting for your review`,
      href: "/jobs",
      tone: "accent",
    });
  }
  for (const p of projects.filter((p) => p.next.yours)) {
    attention.push({
      label: `${p.title}: ${p.next.label}`,
      href: `/projects/${p.id}`,
      tone: "accent",
    });
  }
  for (const s of skillRows.filter((s) => s.listing?.paused)) {
    attention.push({
      label: `${s.name} is paused on the marketplace: its score fell below the minimum`,
      href: `/skills/${s.slug}/listing`,
      tone: "warn",
    });
  }
  for (const i of imports.filter((i) => i.status === "verified" && i.skillId)) {
    const skill = skillRows.find((s) => owned.find((o) => o.id === i.skillId)?.slug === s.slug);
    if (skill && !skill.listing?.active) {
      attention.push({
        label: `${i.agentName}'s ${skill.name} passed Persuna's tests: list it`,
        href: "/skills/import",
        tone: "accent",
      });
    }
  }
  const due = todos.filter((t) => t.dueAt && t.dueAt <= new Date(now.getTime() + 86_400_000));
  for (const t of due.slice(0, 3)) {
    attention.push({ label: t.text, href: "/persona#todos", tone: "neutral" });
  }

  return {
    persona: {
      name: profile.name,
      avatar: profile.avatar,
      focus: profile.focus,
      setupDone: profile.setupDone,
    },
    attention,
    money: {
      earnedCents:
        money.totals.released +
        releasedMilestones.reduce((n, m) => n + share(m.milestone.amountCents), 0),
      heldCents:
        money.totals.held +
        milestonePay
          .filter((m) => HELD.has(m.milestone.status))
          .reduce((n, m) => n + share(m.milestone.amountCents), 0),
      last30Cents: payments.filter((p) => p.at >= monthAgo).reduce((n, p) => n + p.cents, 0),
      weeks,
    },
    skills: skillRows,
    jobsWaiting: reviewJobs.length,
    projects: projects.slice(0, 8),
    orders,
    imports: imports.map((i) => ({
      id: i.id,
      agentName: i.agentName,
      status: i.status,
      createdAt: i.createdAt,
    })),
    todos: todos.slice(0, 6).map((t) => ({ id: t.id, text: t.text, dueAt: t.dueAt })),
  };
}
