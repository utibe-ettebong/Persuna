/**
 * Persuna's checks on a project, with no storage: each takes a ModelClient,
 * asks with a prompt from prompts.ts, parses the reply with Zod, then applies
 * the deterministic rules (amounts that add up, rule-based flags). The
 * projects service stores the results and posts them to the timeline.
 */
import { completeJson } from "@/lib/models/json";
import type { ModelClient } from "@/lib/models/gateway";
import { formatUsd } from "@/lib/money";
import {
  disputeMessages,
  milestoneCheckMessages,
  projectPlanMessages,
  projectWrapupMessages,
  proposalFitMessages,
} from "@/lib/skill/prompts";
import { allocate, MAX_MILESTONES, priceVsBudget, termFlags } from "./rules";
import {
  checkReply,
  disputeReply,
  fitReply,
  planReply,
  wrapupReply,
  type FitReport,
  type MilestoneCheck,
  type ProjectPlan,
} from "./types";

const day = (d: Date) => d.toISOString().slice(0, 10);

/** The brief as scope, criteria and 1–5 milestones whose amounts add up to the budget. */
export async function planProject(
  client: ModelClient,
  input: { title: string; brief: string; budgetCents: number; deadline: Date; now: Date },
): Promise<ProjectPlan> {
  const { value } = await completeJson(
    client,
    "extract",
    projectPlanMessages({
      title: input.title,
      brief: input.brief,
      budget: `${formatUsd(input.budgetCents)} (US dollars)`,
      deadline: day(input.deadline),
      today: day(input.now),
    }),
    planReply,
  );
  // Never more milestones than the budget can pay at the minimum, nor more than the cap.
  const room = Math.max(1, Math.min(MAX_MILESTONES, Math.floor(input.budgetCents / 100)));
  const milestones = value.milestones.slice(0, room);
  const amounts = allocate(
    input.budgetCents,
    milestones.map((m) => m.share),
  );
  const flags = [
    ...value.flags,
    ...termFlags({
      budgetCents: input.budgetCents,
      deadline: input.deadline,
      milestones: milestones.length,
      now: input.now,
    }),
  ];
  return {
    scope: value.scope,
    criteria: value.criteria,
    milestones: milestones.map((m, i) => ({
      title: m.title,
      criteria: m.criteria,
      amountCents: amounts[i],
    })),
    // One flag per message, model and rules together.
    flags: flags.filter((f, i) => flags.findIndex((g) => g.message === f.message) === i),
  };
}

/** For the poster: how well one proposal fits, with the seller's verified skills. */
export async function proposalFit(
  client: ModelClient,
  input: {
    plan: ProjectPlan;
    budgetCents: number;
    deadline: Date;
    priceCents: number;
    days: number;
    message: string;
    skills: { title: string; score: number }[];
  },
): Promise<FitReport> {
  const priceNote = priceVsBudget(input.priceCents, input.budgetCents);
  const { value } = await completeJson(
    client,
    "evaluate",
    proposalFitMessages({
      scope: input.plan.scope,
      criteria: input.plan.criteria,
      budget: formatUsd(input.budgetCents),
      deadline: day(input.deadline),
      price: formatUsd(input.priceCents),
      priceNote,
      days: input.days,
      message: input.message,
      skills: input.skills,
    }),
    fitReply,
  );
  return { ...value, priceNote, verifiedSkills: input.skills };
}

/** A delivery against its milestone's criteria: one verdict per criterion, in order. */
export async function checkDelivery(
  client: ModelClient,
  input: {
    milestone: string;
    criteria: string[];
    delivery: string;
    round: number;
    earlierRequests: string[];
  },
): Promise<MilestoneCheck> {
  const { value } = await completeJson(
    client,
    "evaluate",
    milestoneCheckMessages(input),
    checkReply,
  );
  // Line the verdicts up with the agreed criteria: a missing one is "can't tell".
  const results = input.criteria.map(
    (criterion, i) =>
      value.results[i] ?? {
        criterion,
        verdict: "unclear" as const,
        reason: "Persuna couldn't check this one.",
      },
  );
  return {
    results: results.map((r, i) => ({ ...r, criterion: input.criteria[i] })),
    summary: value.summary,
    fairness: value.fairness,
    round: input.round,
    checkedAt: new Date().toISOString(),
  };
}

export async function assessDispute(
  client: ModelClient,
  input: Parameters<typeof disputeMessages>[0],
) {
  return (await completeJson(client, "evaluate", disputeMessages(input), disputeReply)).value;
}

export async function wrapUp(
  client: ModelClient,
  input: Parameters<typeof projectWrapupMessages>[0],
) {
  return (await completeJson(client, "extract", projectWrapupMessages(input), wrapupReply)).value;
}

/** A check as one line for the timeline: "2 of 3 criteria met, 1 can't tell." */
export function checkLine(check: MilestoneCheck): string {
  const n = (v: string) => check.results.filter((r) => r.verdict === v).length;
  const parts = [`${n("met")} of ${check.results.length} criteria met`];
  if (n("not_met")) parts.push(`${n("not_met")} not met`);
  if (n("unclear")) parts.push(`${n("unclear")} can't tell`);
  return `${parts.join(", ")}.`;
}
