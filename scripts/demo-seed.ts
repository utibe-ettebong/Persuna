/**
 * Sets up a ready-to-show demo: the sample meeting-minutes skill with rules,
 * a test run, a published version and a live marketplace listing — plus, with
 * peers, volume across every reachable status: 10+ rented jobs each in review,
 * approved and rejected (half the approved ones accepted and paid out), and
 * 10+ projects each drafted, open, in progress (funded / submitted / changes
 * requested), completed, cancelled and disputed.
 * Safe to run more than once: each stage tops up to its quota and leaves the
 * rest alone. Uses whatever models are configured (the mock when no key is
 * set), and mock payments when Paystack isn't configured, so no real money
 * moves. The listing bar for rule confirmation is relaxed for the sample skill
 * only (see scripts/demo-seed.env); real listings still need it.
 *
 *   npm run demo:seed -- --owner you@example.com --peer friend@example.com [--peer another@example.com]
 *
 * Every account must have signed up already. The owner holds the skill and
 * posts the projects; the first peer rents the jobs and wins the freelance
 * work, and a second peer's proposals are the declined ones. (--counterpart
 * still works as the first peer.)
 *
 *   npm run demo:seed -- --owner you@example.com --clear [--yes]
 *
 * removes everything the seed planted for that owner (dry-runs without --yes).
 * Accounts are never touched.
 */
import path from "node:path";
import { parseArgs } from "node:util";
import { and, asc, eq, inArray, like, or } from "drizzle-orm";
import { db } from "@/db/client";
import {
  auditEvents,
  jobRounds,
  jobs,
  listings,
  persunaMessages,
  projectMilestones,
  projectProposals,
  projects,
  skills,
  skillVersions,
  transactions,
} from "@/db/schema";
import { userById, userIdByEmail } from "@/lib/auth/users";
import type { SessionUser } from "@/lib/auth/session";
import { createModelClient } from "@/lib/models";
import type { ModelClient } from "@/lib/models/gateway";
import { reviewJob } from "@/lib/jobs/service";
import {
  acceptOrder,
  getListingForSkill,
  readiness,
  rentSkill,
  saveListing,
  setListingActive,
} from "@/lib/market/service";
import {
  acceptProposal,
  approveMilestone,
  cancelProject,
  createProject,
  fundMilestone,
  propose,
  raiseDispute,
  requestMilestoneChanges,
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

/** How many seeded records rest in each reachable status. */
const PER_STATUS = 10;

const JOB_INPUTS = [
  `Raw notes, Tue sync. Ada: launch moved to the 21st, needs the checklist by Friday. Sam: two open bugs on checkout, both his. Priya: pricing page copy approved, ship it. Decision: freeze scope Thursday noon.`,
  `Standup notes. Ada: checkout bug fixed, in review. Sam: started the refund flow, no blockers. Priya: user interviews Thursday, needs the prototype link. Omar: deploys paused until the migration lands.`,
  `Client call with Brightline. They want weekly reports on Fridays, invoice on the 1st, and a Slack channel for urgent bugs. Agreed: pilot starts Monday, review in three weeks. Owner: Ada.`,
  `Incident review, checkout outage. Cause: expired cert on the payments proxy. Fixed by rotating and redeploying. Follow-ups: Sam adds expiry alerts, Priya writes the status post, Ada schedules the game-day.`,
  `Planning notes. Next sprint: refunds, invoice PDFs, and the new onboarding checklist. Dropped: dark mode, CSV export. Capacity: two engineers full-time, one half. Decision: ship refunds first.`,
  `1:1 Ada and Sam. Sam wants deeper backend work and a mentor. Agreed: he takes the migration, Ada reviews weekly, revisit in a month. No comp changes discussed.`,
  `Workshop notes, pricing. Options: per-seat, usage-based, hybrid. Priya: enterprise buyers expect annual. Sam: usage is easier to build. Decision: hybrid with an annual plan, Omar models it.`,
  `Retro notes. Good: shipped the launch, on-call was quiet. Bad: specs arrived late twice. Try next time: spec review Wednesdays, smaller tickets. Owner: Priya to schedule.`,
  `Sales call, Northwind. Needs: SSO, audit log, EU data residency. Timeline: decision this quarter. Agreed: trial with five seats, security review next week. Owner: Omar.`,
  `Support triage. Top issues: password resets, invoice downloads, slow search. Fixes: reset link copy, invoice retry button, search index rebuild. Owners: Sam, Sam, Ada.`,
  `Board prep notes. Revenue up 12%, churn flat, hiring two engineers. Risks: single frontend owner, support load. Asks: approve the pricing pilot and the security audit.`,
  `Design crit. Feedback: simplify the nav to three items, make the primary button one per screen, cut the onboarding from five steps to three. Owner: Priya to revise by Friday.`,
];

const ACCEPT_COMMENTS = [
  "Clean minutes, exactly our format. No changes needed.",
  "Great turnaround. Two tiny tweaks I made myself.",
  "Spot on — decisions and owners all captured.",
  "Very good. One date fix, otherwise perfect.",
];

const CHANGE_NOTES = [
  "Tighten the owner roles: each item should name exactly one role, no shared ownership.",
  "Add a concrete example under each acceptance criterion so the team knows what good looks like.",
  "Cut anything over one page. If it doesn't fit, it's two checklists, not one.",
];

const DISPUTE_REASONS = [
  "This delivery misses half the acceptance criteria and reads like a first draft, not finished work. I want it redone properly.",
  "The milestone was approved in spirit on our call, but the poster is now asking for a different deliverable. The original criteria are all met.",
];

interface ProjectTemplate {
  title: string;
  brief: string;
  m1Criteria: string[];
  m2Criteria: string[];
  delivery: string;
}

const PROJECTS: ProjectTemplate[] = [
  {
    title: "Demo: customer launch checklist",
    brief:
      "A one-page launch checklist our whole team can follow: pre-launch, launch day, and post-launch, each item with an owner role, in plain language.",
    m1Criteria: [
      "Covers pre-launch, launch day and post-launch",
      "Each item names an owner role",
      "Fits on one page",
    ],
    m2Criteria: ["Incorporates the draft feedback", "Plain language, no jargon"],
    delivery: `Launch checklist (draft)

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
- Review numbers after one week`,
  },
  {
    title: "Demo: onboarding email sequence",
    brief:
      "A five-email onboarding sequence for new trial accounts: welcome, setup nudge, first win, case study, and trial-end reminder. Friendly tone, short paragraphs.",
    m1Criteria: [
      "Five emails with subject lines",
      "Each email has one clear call to action",
      "Friendly tone throughout",
    ],
    m2Criteria: ["Incorporates the draft feedback", "No email over 150 words"],
    delivery: `Onboarding sequence (draft)

1. Welcome aboard — Subject: "Your trial is ready"
   One CTA: finish your profile. Warm, two short paragraphs.

2. Setup nudge — Subject: "One quick thing"
   One CTA: connect your first app. Names the payoff.

3. First win — Subject: "You did it — here's what's next"
   One CTA: run your first job. Celebrates, then guides.

4. Case study — Subject: "How Brightline saves 6 hours a week"
   One CTA: read the story. Proof, not promises.

5. Trial-end reminder — Subject: "3 days left"
   One CTA: pick a plan. Honest about what happens next.`,
  },
  {
    title: "Demo: investor update draft",
    brief:
      "A monthly investor update: numbers up top, three wins, two asks, and risks. Factual tone, no hype, fits on one screen.",
    m1Criteria: [
      "Numbers first, then wins, asks, risks",
      "Every claim has a number attached",
      "Fits on one screen",
    ],
    m2Criteria: ["Incorporates the draft feedback", "Factual tone, no hype words"],
    delivery: `Investor update (draft)

Numbers: revenue $48k (+12%), churn 3.1% (flat), burn $61k, runway 14 months.

Wins:
1. Shipped the launch with zero sev-1 incidents.
2. Closed Brightline ($18k ARR) and Northwind trial.
3. Support backlog cleared for the first time since June.

Asks:
1. Intro to two design partners in fintech.
2. Approval for the security audit ($9k).

Risks: single frontend owner; support load up 20%. Mitigation: hiring both roles now.`,
  },
  {
    title: "Demo: support macro refresh",
    brief:
      "Rewrite our ten most-used support macros: password resets, invoices, refunds, bug reports. Empathetic, plain words, each under 80 words with next steps.",
    m1Criteria: [
      "Covers all ten listed situations",
      "Each macro states the next step",
      "Under 80 words each",
    ],
    m2Criteria: ["Incorporates the draft feedback", "Empathetic tone, no blame"],
    delivery: `Support macros (draft)

Password reset: Sorry you're locked out — it happens. Use the reset link on the sign-in page; it arrives within a minute. Still stuck? Reply here and I'll reset it by hand.

Invoice download: Let's get that invoice. Open Billing, pick the month, and Download. If the button spins, reply with the month and I'll send the PDF directly.

Refund request: Happy to sort this. Tell me the charge date and amount and I'll refund it today; it lands in 3–5 days. Anything else I can fix while I'm here?

Bug report: Thanks for flagging this — details help. Send a screenshot and what you clicked, and I'll file it with engineering and chase it for you.

(Plus six more in the same shape: trial expiry, plan change, SSO setup, data export, downtime, feature request.)`,
  },
  {
    title: "Demo: product FAQ rewrite",
    brief:
      "Rewrite the product FAQ: twelve questions customers actually ask, grouped by setup, billing, and troubleshooting. Answers under 60 words with links.",
    m1Criteria: [
      "Twelve real customer questions",
      "Grouped into three sections",
      "Answers under 60 words with links",
    ],
    m2Criteria: ["Incorporates the draft feedback", "No internal jargon"],
    delivery: `Product FAQ (draft)

Setup: How do I connect an app? Open Persuna, Apps, Connect next to yours, approve at the provider. [Guide] Can I use two Google accounts? Yes — add both, pick per job. [Guide] …

Billing: When am I charged? At acceptance, never before. [Billing] How do refunds work? Automatic on rejection, 3–5 days. [Refunds] …

Troubleshooting: Why is my job waiting? The owner reviews first results. [Reviews] It says reconnect — why? The provider token expired; one click fixes it. [Connections] …

(Twelve questions total, four per section, each with a deep link.)`,
  },
  {
    title: "Demo: conference talk outline",
    brief:
      "A 25-minute talk outline on shipping with a tiny team: hook, three lessons with stories, one live demo beat, and a memorable close. Speaker notes included.",
    m1Criteria: [
      "Hook in the first 60 seconds",
      "Three lessons, each with a story",
      "Speaker notes for every beat",
    ],
    m2Criteria: ["Incorporates the draft feedback", "Fits 25 minutes with demo"],
    delivery: `Talk outline (draft)

Hook (0:00): "We ship every week with four people. Here's the checklist that makes it boring." [Note: pause, let it land.]

Lesson 1 — Freeze scope early (0:02): the Thursday-noon rule, the launch it saved. [Note: tell the checkout story.]
Lesson 2 — Review firsts, trust repeats (0:09): owner review ladder. [Note: show the trust screen.]
Lesson 3 — Demo beats status (0:15): live two-minute demo. [Note: have the backup video ready.]

Close (0:23): "Boring is a feature." One slide, three bullets, invite questions.`,
  },
  {
    title: "Demo: hiring rubric",
    brief:
      "A hiring rubric for support engineers: four competencies, what good looks like at three levels each, and two interview questions per competency.",
    m1Criteria: [
      "Four competencies defined",
      "Three levels each with examples",
      "Two interview questions each",
    ],
    m2Criteria: ["Incorporates the draft feedback", "Observable behaviors only"],
    delivery: `Hiring rubric (draft)

1. Debugging: L1 follows a runbook; L2 isolates with logs; L3 prevents recurrence. Q: "Walk me through your hardest outage." "What alert would you add here?"
2. Writing: L1 clear replies; L2 macros others reuse; L3 docs that cut tickets. Q: "Show me something you wrote for users." "Rewrite this reply live."
3. Empathy: L1 acknowledges feelings; L2 de-escalates; L3 turns critics into champions. Q: "Your worst ticket?" "When did you push back on a user?"
4. Ownership: L1 closes the loop; L2 chases across teams; L3 fixes the system. Q: "What did you own end to end?" "What broke that you saw coming?"`,
  },
  {
    title: "Demo: changelog entries",
    brief:
      "A month of changelog entries: eight releases, each with a one-line summary, who it helps, and a link. Present tense, no marketing fluff.",
    m1Criteria: ["Eight releases covered", "Each names who it helps", "Present tense throughout"],
    m2Criteria: ["Incorporates the draft feedback", "One line per summary"],
    delivery: `Changelog (draft)

- Faster drafts: jobs start in half the time. Helps: everyone renting. [Notes]
- Notion writes: skills create pages in your workspace. Helps: renters. [Guide]
- Word files: milestones arrive as .docx in Drive. Helps: posters. [Guide]
- Windows acts: the desktop app clicks and types on Windows. Helps: desktop users. [Notes]
- Setup honesty: Windows setup waits for working permissions. Helps: new users. [Notes]
- Escrow receipts: every hold and release explained. Helps: posters. [Billing]
- Fit notes: proposals arrive with a fit read. Helps: posters. [Guide]
- Search fixes: invoice search returns in a second. Helps: finance teams. [Notes]`,
  },
  {
    title: "Demo: team handbook page",
    brief:
      "A handbook page on incident response: who calls it, roles, the first fifteen minutes, and the blameless review. Calm tone, checklists over prose.",
    m1Criteria: [
      "Roles assigned by name pattern",
      "First fifteen minutes as a checklist",
      "Blameless review process included",
    ],
    m2Criteria: ["Incorporates the draft feedback", "Checklists over prose"],
    delivery: `Incident response (draft)

Who calls it: anyone who sees user impact. Say "incident" in #war-room with what broke.

Roles: Commander (decides), Comms (status page + users), Fixer (hands on keys), Scribe (timeline).

First fifteen minutes:
[ ] Commander declares severity and staffs roles
[ ] Comms posts the first status update
[ ] Fixer stops the bleeding (flag, rollback, scale)
[ ] Scribe starts the timeline doc

Review within 48 hours: timeline, five whys, action items with owners. No blame, ever.`,
  },
  {
    title: "Demo: pricing page copy",
    brief:
      "Pricing page copy: three tiers with names, one-line pitches, five bullets each, and an FAQ handling the four hardest objections.",
    m1Criteria: [
      "Three tiers with distinct pitches",
      "Five honest bullets per tier",
      "FAQ answers four objections",
    ],
    m2Criteria: ["Incorporates the draft feedback", "No dark patterns"],
    delivery: `Pricing copy (draft)

Starter — "For trying things out." 5 jobs/mo, 1 skill, community support, mock-friendly. $0.
Pro — "For getting work done." 100 jobs/mo, unlimited skills, priority drafting, escrow. $29/mo.
Team — "For companies." Everything in Pro, shared skills, roles, audit export. $99/mo.

FAQ: Can I cancel anytime? Yes, two clicks, keep your data. What if a job is bad? Rejected jobs refund automatically. Do you train on my data? Never — it's in the terms. Annual discount? Two months free.`,
  },
  {
    title: "Demo: quarterly retro report",
    brief:
      "A quarterly retro report: what shipped, numbers vs goals, three lessons, and next quarter's three bets. One page, honest about misses.",
    m1Criteria: [
      "Numbers compared against goals",
      "Three lessons with evidence",
      "Three named bets for next quarter",
    ],
    m2Criteria: ["Incorporates the draft feedback", "Misses named plainly"],
    delivery: `Quarterly retro (draft)

Shipped: Windows acts, plugin backend, file outputs, honest setup. Missed: mobile views (cut), public API (slipped).

Numbers: revenue $48k vs $45k goal. Churn 3.1% vs 3.0% goal. NPS 41 vs 45 goal.

Lessons: 1. Small slices ship (all four landed). 2. Review load grows with users — trust ladder next. 3. Docs cut support tickets 18%.

Bets: 1. Team plans. 2. Public API beta. 3. Marketplace search.`,
  },
  {
    title: "Demo: meeting-notes cleanup backlog",
    brief:
      "Turn a quarter of messy meeting notes into uniform minutes: same header, decisions in bold, action table with owners and dates. Twelve sets provided.",
    m1Criteria: [
      "Uniform header on every set",
      "Decisions in bold throughout",
      "Action tables with owners and dates",
    ],
    m2Criteria: ["Incorporates the draft feedback", "Nothing dropped silently"],
    delivery: `Cleaned minutes (draft, sets 1–3 of 12)

Set 1 — Tue sync, 12 Nov. Attendees: Ada, Sam, Priya.
**Decision: launch moves to the 21st; scope freezes Thursday noon.**
| Action | Owner | Date |
| Checklist by Friday | Ada | 15 Nov |
| Fix checkout bugs | Sam | 14 Nov |
| Ship pricing copy | Priya | 13 Nov |

Set 2 — Standup, 13 Nov. … (same header, bold decisions, full action table)
Set 3 — Client call, 13 Nov. … (same header, bold decisions, full action table)
(Remaining nine sets follow the identical format; nothing from the raws dropped.)`,
  },
];

const PROPOSAL_MESSAGE =
  "I've done this exact kind of work several times. I'll draft in the first half of the week, fold in your feedback, and deliver something your whole team can use as-is.";
const PROPOSAL_RUNNER_UP =
  "Strong fit here — recent similar deliveries I can share. Slightly higher price because I include two full revision rounds and a style pass.";

type Peer = SessionUser;

async function main() {
  const { values } = parseArgs({
    options: {
      owner: { type: "string" },
      counterpart: { type: "string" },
      peer: { type: "string", multiple: true },
      clear: { type: "boolean" },
      yes: { type: "boolean" },
    },
  });
  const ownerEmail = values.owner ?? process.env.DEMO_OWNER_EMAIL;
  if (!ownerEmail) throw new Error("Pass --owner you@example.com (an account that has signed up)");
  const ownerId = await userIdByEmail(ownerEmail);
  if (values.clear) {
    await clearDemo(ownerId, values.yes ?? false);
    return;
  }
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

  const peerEmails = [...(values.counterpart ? [values.counterpart] : []), ...(values.peer ?? [])]
    .map((email) => email.trim().toLowerCase())
    .filter((email, i, all) => email && all.indexOf(email) === i);
  if (peerEmails.length === 0) {
    console.log("Pass --peer friend@example.com (repeatable) to also seed jobs and projects.");
    return;
  }
  const owner = await userById(ownerId);
  if (!owner) throw new Error("The owner account must exist and be unsuspended");
  const peers: Peer[] = [];
  for (const email of peerEmails) {
    if (email === owner.email) throw new Error("Peers must be different accounts than the owner");
    const peer = await userById(await userIdByEmail(email));
    if (!peer) throw new Error(`Account ${email} must exist and be unsuspended`);
    peers.push(peer);
  }
  await seedJobs(client, skill.id, peers);
  await seedProjects(client, owner, peers);
  await printSummary(skill.id, owner);
}

/**
 * Renter jobs on the listing: PER_STATUS each resting in review, approved
 * (still open) and rejected, plus PER_STATUS approved and accepted. Renting
 * always lands in review at trust level 0, so decisions top up from that pool.
 * awaiting_payment needs a real Paystack checkout and awaiting_approval needs
 * a live connected app, so neither is seeded.
 */
async function seedJobs(client: ModelClient, skillId: string, peers: Peer[]) {
  const listing = await getListingForSkill(skillId);
  if (!listing?.active) {
    console.log("Listing isn't live; skipping the rented jobs");
    return;
  }
  const counts = await jobBuckets(skillId);
  const total =
    counts.review.length + counts.approvedOpen.length + counts.accepted + counts.rejected;
  const rents = Math.max(0, PER_STATUS * 4 - total);
  for (let i = 0; i < rents; i++) {
    const peer = peers[(total + i) % peers.length];
    await rentSkill(client, listing.id, {
      renterUserId: peer.id,
      renterName: peer.name,
      renterEmail: peer.email,
      input: JOB_INPUTS[(total + i) % JOB_INPUTS.length],
      premiumReview: false,
    });
  }
  if (rents > 0) console.log(`Rented ${rents} jobs (all land in review)`);
  await topUpDecisions(skillId);
  const done = await jobBuckets(skillId);
  console.log(
    `Jobs: in review ${done.review.length}, approved open ${done.approvedOpen.length}, accepted ${done.accepted}, rejected ${done.rejected}`,
  );
}

async function jobBuckets(skillId: string) {
  const rows = await db()
    .select({ id: jobs.id, status: jobs.status, rating: jobs.rating, createdAt: jobs.createdAt })
    .from(jobs)
    .where(and(eq(jobs.skillId, skillId), eq(jobs.origin, "renter")));
  const buckets = {
    review: [] as string[],
    approvedOpen: [] as string[],
    accepted: 0,
    rejected: 0,
  };
  for (const row of rows.sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime())) {
    if (row.status === "review") buckets.review.push(row.id);
    else if (row.status === "approved" && row.rating == null) buckets.approvedOpen.push(row.id);
    else if (row.status === "approved") buckets.accepted += 1;
    else if (row.status === "rejected") buckets.rejected += 1;
  }
  return buckets;
}

/** Tops up the decided buckets from the review pool, oldest first. */
async function topUpDecisions(skillId: string) {
  let buckets = await jobBuckets(skillId);
  for (const id of buckets.review.splice(
    0,
    Math.max(0, PER_STATUS - buckets.approvedOpen.length),
  )) {
    await reviewJob(id, "approve");
  }
  buckets = await jobBuckets(skillId);
  let n = buckets.accepted;
  for (const id of buckets.review.splice(0, Math.max(0, PER_STATUS - buckets.accepted))) {
    await reviewJob(id, "approve");
    await acceptOrder(id, n % 3 === 2 ? 4 : 5, ACCEPT_COMMENTS[n % ACCEPT_COMMENTS.length]);
    n += 1;
  }
  buckets = await jobBuckets(skillId);
  for (const id of buckets.review.splice(0, Math.max(0, PER_STATUS - buckets.rejected))) {
    await reviewJob(id, "reject");
  }
}

type Archetype =
  "draft" | "open" | "funded" | "submitted" | "changes" | "completed" | "cancelled" | "disputed";

const ARCHETYPES: Archetype[] = [
  "draft",
  "open",
  "funded",
  "submitted",
  "changes",
  "completed",
  "cancelled",
  "disputed",
];

/**
 * PER_STATUS projects per archetype: drafted, open for proposals, in progress
 * with milestone 1 funded / submitted / changes requested, completed, cancelled
 * (milestone 1 refunded), and disputed. Slots are deterministic, so re-runs
 * resume each project instead of duplicating it.
 */
async function seedProjects(client: ModelClient, owner: Peer, peers: Peer[]) {
  const seller = peers[0];
  const runnerUp = peers[1] ?? null;
  if (!runnerUp) console.log("One peer only: skipping the declined runner-up proposals");
  const slots: { archetype: Archetype; template: ProjectTemplate; title: string }[] = [];
  ARCHETYPES.forEach((archetype, a) => {
    for (let n = 0; n < PER_STATUS; n++) {
      const index = a * PER_STATUS + n;
      const template = PROJECTS[index % PROJECTS.length];
      const cycle = Math.floor(index / PROJECTS.length);
      slots.push({
        archetype,
        template,
        title: cycle === 0 ? template.title : `${template.title} #${cycle + 1}`,
      });
    }
  });
  let touched = 0;
  for (const [i, slot] of slots.entries()) {
    if (await driveSlot(client, owner, seller, runnerUp, slot, i)) touched += 1;
  }
  console.log(`Projects: ${slots.length} slots across 8 archetypes, ${touched} advanced this run`);
}

/** Builds the slot's project if missing, then walks it to its archetype. True when it moved. */
async function driveSlot(
  client: ModelClient,
  owner: Peer,
  seller: Peer,
  runnerUp: Peer | null,
  slot: { archetype: Archetype; template: ProjectTemplate; title: string },
  index: number,
): Promise<boolean> {
  let moved = false;
  const load = () =>
    db().query.projects.findFirst({
      where: and(eq(projects.posterId, owner.id), eq(projects.title, slot.title)),
    });
  let project = await load();
  if (!project) {
    project = await createProject(client, owner, {
      title: slot.title,
      brief: slot.template.brief,
      budgetCents: 20000,
      deadline: new Date(Date.now() + 30 * 86_400_000),
    });
    moved = true;
  }
  if (project.status === "draft" && slot.archetype !== "draft") {
    await savePlan(owner, project.id, {
      scope: slot.template.brief,
      criteria: ["Covers the whole brief", "Plain language throughout"],
      milestones: [
        { title: "First draft", criteria: slot.template.m1Criteria, amountCents: 12000 },
        { title: "Final polish", criteria: slot.template.m2Criteria, amountCents: 8000 },
      ],
      budgetCents: 20000,
      open: true,
    });
    project = (await load())!;
    moved = true;
  }
  const needsWork =
    slot.archetype === "funded" ||
    slot.archetype === "submitted" ||
    slot.archetype === "changes" ||
    slot.archetype === "completed" ||
    slot.archetype === "cancelled" ||
    slot.archetype === "disputed";
  if (project.status === "open" && slot.archetype !== "draft") {
    moved = (await ensureProposals(client, project.id, seller, runnerUp, index)) || moved;
    if (needsWork) {
      const [mine] = await db()
        .select()
        .from(projectProposals)
        .where(
          and(eq(projectProposals.projectId, project.id), eq(projectProposals.sellerId, seller.id)),
        )
        .limit(1);
      if (mine?.status === "pending") {
        await acceptProposal(owner, project.id, mine.id);
        moved = true;
      }
    }
    project = (await load())!;
  }
  if (project.status !== "in_progress") return moved;
  const milestones = await db().query.projectMilestones.findMany({
    where: eq(projectMilestones.projectId, project.id),
    orderBy: asc(projectMilestones.position),
  });
  const [first, second] = milestones;
  if (!first || !second) throw new Error(`Project ${project.id} has no milestones`);
  const fund = async (id: string) => {
    const [row] = await db()
      .select()
      .from(projectMilestones)
      .where(eq(projectMilestones.id, id))
      .limit(1);
    if (row?.status === "pending") {
      await fundMilestone(owner, id);
      moved = true;
    }
  };
  const submit = async (id: string, delivery: string) => {
    const [row] = await db()
      .select()
      .from(projectMilestones)
      .where(eq(projectMilestones.id, id))
      .limit(1);
    if (row?.status === "funded") {
      await submitDelivery(client, seller, id, delivery);
      moved = true;
    }
  };
  const approve = async (id: string) => {
    const [row] = await db()
      .select()
      .from(projectMilestones)
      .where(eq(projectMilestones.id, id))
      .limit(1);
    if (row?.status === "submitted") {
      await approveMilestone(client, owner, id);
      moved = true;
    }
  };
  const delivery = (which: 1 | 2) =>
    which === 1
      ? slot.template.delivery
      : `Final polish of "${slot.template.title.replace(/^Demo: /, "")}"\n\n${slot.template.m2Criteria.map((c) => `- ${c}: done.`).join("\n")}`;
  switch (slot.archetype) {
    case "funded":
      await fund(first.id);
      break;
    case "submitted":
      await fund(first.id);
      await submit(first.id, delivery(1));
      break;
    case "changes":
      await fund(first.id);
      await submit(first.id, delivery(1));
      {
        const [row] = await db()
          .select()
          .from(projectMilestones)
          .where(eq(projectMilestones.id, first.id))
          .limit(1);
        if (row?.status === "submitted") {
          await requestMilestoneChanges(owner, first.id, CHANGE_NOTES[index % CHANGE_NOTES.length]);
          moved = true;
        }
      }
      await fund(second.id);
      break;
    case "completed":
      await fund(first.id);
      await submit(first.id, delivery(1));
      await approve(first.id);
      await fund(second.id);
      await submit(second.id, delivery(2));
      await approve(second.id);
      break;
    case "cancelled": {
      await fund(first.id);
      const rows = await db()
        .select({ status: projectMilestones.status })
        .from(projectMilestones)
        .where(eq(projectMilestones.projectId, project.id));
      const delivered = rows.some((r) => r.status !== "pending" && r.status !== "funded");
      if (!delivered) {
        await cancelProject(owner, project.id);
        moved = true;
      }
      break;
    }
    case "disputed":
      await fund(first.id);
      await submit(first.id, delivery(1));
      {
        const fresh = await load();
        if (fresh?.status === "in_progress") {
          const byPoster = index % 2 === 0;
          await raiseDispute(
            client,
            byPoster ? owner : seller,
            project.id,
            DISPUTE_REASONS[index % DISPUTE_REASONS.length],
          );
          moved = true;
        }
      }
      break;
    case "draft":
    case "open":
      break;
  }
  return moved;
}

/** One proposal from the seller, plus the runner-up's when there are two peers. */
async function ensureProposals(
  client: ModelClient,
  projectId: string,
  seller: Peer,
  runnerUp: Peer | null,
  index: number,
): Promise<boolean> {
  let moved = false;
  const existing = await db()
    .select({ sellerId: projectProposals.sellerId })
    .from(projectProposals)
    .where(eq(projectProposals.projectId, projectId));
  const have = new Set(existing.map((row) => row.sellerId));
  if (!have.has(seller.id)) {
    await propose(client, seller, projectId, {
      message: PROPOSAL_MESSAGE,
      priceCents: 20000,
      days: 5 + (index % 5),
    });
    moved = true;
  }
  if (runnerUp && !have.has(runnerUp.id)) {
    await propose(client, runnerUp, projectId, {
      message: PROPOSAL_RUNNER_UP,
      priceCents: 22000,
      days: 6 + (index % 4),
    });
    moved = true;
  }
  return moved;
}

/** What the demo now holds, and where to look at it. */
async function printSummary(skillId: string, owner: Peer) {
  const mine = await db().select().from(projects).where(eq(projects.posterId, owner.id));
  const seeded = mine.filter((row) => row.title.startsWith("Demo: "));
  const counts = { draft: 0, open: 0, in_progress: 0, completed: 0, cancelled: 0, disputed: 0 };
  for (const row of seeded) counts[row.status as keyof typeof counts] += 1;
  const milestones: Record<string, number> = {};
  if (seeded.length > 0) {
    const rows = await db()
      .select({ status: projectMilestones.status })
      .from(projectMilestones)
      .where(
        inArray(
          projectMilestones.projectId,
          seeded.map((row) => row.id),
        ),
      );
    for (const row of rows) milestones[row.status] = (milestones[row.status] ?? 0) + 1;
  }
  const buckets = await jobBuckets(skillId);
  console.log(
    `Demo holds: jobs in review ${buckets.review.length}, approved open ${buckets.approvedOpen.length}, ` +
      `accepted ${buckets.accepted}, rejected ${buckets.rejected}; ` +
      `projects draft ${counts.draft}, open ${counts.open}, in progress ${counts.in_progress}, ` +
      `completed ${counts.completed}, cancelled ${counts.cancelled}, disputed ${counts.disputed}; ` +
      `milestones ${Object.entries(milestones)
        .map(([status, n]) => `${status} ${n}`)
        .join(", ")}. Browse /projects, /market, /jobs, and /admin/disputes.`,
  );
}

/**
 * Removes everything the seed planted for an owner: the sample skill (versions,
 * examples, evals, corrections, evidence, jobs and listing cascade off it),
 * the Demo: projects (milestones, proposals and updates cascade), the jobs'
 * payment rows and revision rounds (which would otherwise dangle), the demo
 * notices, and the audit rows pointing at all of it — in one transaction.
 * Accounts are never touched. Dry-runs unless told otherwise.
 */
async function clearDemo(ownerId: string, execute: boolean) {
  const [skill] = await db()
    .select({ id: skills.id })
    .from(skills)
    .where(and(eq(skills.slug, "meeting-minutes"), eq(skills.ownerId, ownerId)))
    .limit(1);
  const skillId = skill?.id ?? null;
  const jobIds = skillId
    ? (
        await db()
          .select({ id: jobs.id })
          .from(jobs)
          .where(and(eq(jobs.skillId, skillId), eq(jobs.origin, "renter")))
      ).map((row) => row.id)
    : [];
  const [listing] = skillId
    ? await db()
        .select({ id: listings.id })
        .from(listings)
        .where(eq(listings.skillId, skillId))
        .limit(1)
    : [];
  const projectRows = await db()
    .select({ id: projects.id, title: projects.title })
    .from(projects)
    .where(and(eq(projects.posterId, ownerId), like(projects.title, "Demo: %")));
  const projectIds = projectRows.map((row) => row.id);
  const versionIds = skillId
    ? (
        await db()
          .select({ id: skillVersions.id })
          .from(skillVersions)
          .where(eq(skillVersions.skillId, skillId))
      ).map((row) => row.id)
    : [];
  const milestoneIds = projectIds.length
    ? (
        await db()
          .select({ id: projectMilestones.id })
          .from(projectMilestones)
          .where(inArray(projectMilestones.projectId, projectIds))
      ).map((row) => row.id)
    : [];
  const proposalIds = projectIds.length
    ? (
        await db()
          .select({ id: projectProposals.id })
          .from(projectProposals)
          .where(inArray(projectProposals.projectId, projectIds))
      ).map((row) => row.id)
    : [];
  const txnConds = [
    ...(jobIds.length ? [inArray(transactions.jobId, jobIds)] : []),
    ...(listing ? [eq(transactions.listingId, listing.id)] : []),
  ];
  const txnIds = txnConds.length
    ? (
        await db()
          .select({ id: transactions.id })
          .from(transactions)
          .where(or(...txnConds))
      ).map((row) => row.id)
    : [];
  const roundIds = jobIds.length
    ? (
        await db()
          .select({ id: jobRounds.id })
          .from(jobRounds)
          .where(inArray(jobRounds.jobId, jobIds))
      ).map((row) => row.id)
    : [];
  const messageConds = [
    ...(skillId ? [eq(persunaMessages.skillId, skillId)] : []),
    ...(jobIds.length ? [inArray(persunaMessages.jobId, jobIds)] : []),
    ...projectRows.map((row) => like(persunaMessages.content, `%"${row.title}"%`)),
  ];
  const messageIds = messageConds.length
    ? (
        await db()
          .select({ id: persunaMessages.id })
          .from(persunaMessages)
          .where(and(eq(persunaMessages.kind, "notice"), or(...messageConds)))
      ).map((row) => row.id)
    : [];
  const entityIds = [
    ...jobIds,
    ...txnIds,
    ...projectIds,
    ...milestoneIds,
    ...proposalIds,
    ...(listing ? [listing.id] : []),
    ...versionIds,
  ];
  const auditConds = [
    ...(skillId ? [eq(auditEvents.skillId, skillId)] : []),
    ...(entityIds.length ? [inArray(auditEvents.entityId, entityIds)] : []),
  ];
  const auditIds = auditConds.length
    ? (
        await db()
          .select({ id: auditEvents.id })
          .from(auditEvents)
          .where(or(...auditConds))
      ).map((row) => row.id)
    : [];

  console.log(
    `Demo data for this owner: ${skillId ? 1 : 0} skill, ${jobIds.length} jobs, ` +
      `${txnIds.length} payments, ${projectIds.length} projects, ${milestoneIds.length} milestones, ` +
      `${proposalIds.length} proposals, ${messageIds.length} notices, ${auditIds.length} audit rows.`,
  );
  if (!execute) {
    console.log("Dry run — re-run with --yes to delete all of it. Accounts are never touched.");
    return;
  }
  await db().transaction(async (tx) => {
    if (messageIds.length) {
      await tx.delete(persunaMessages).where(inArray(persunaMessages.id, messageIds));
    }
    if (txnIds.length) await tx.delete(transactions).where(inArray(transactions.id, txnIds));
    if (roundIds.length) await tx.delete(jobRounds).where(inArray(jobRounds.id, roundIds));
    if (auditIds.length) await tx.delete(auditEvents).where(inArray(auditEvents.id, auditIds));
    if (projectIds.length) await tx.delete(projects).where(inArray(projects.id, projectIds));
    if (skillId) await tx.delete(skills).where(eq(skills.id, skillId));
  });
  console.log("Deleted.");
}

main()
  .then(() => process.exit(0))
  .catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  });
