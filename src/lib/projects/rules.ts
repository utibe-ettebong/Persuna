/**
 * Business rules for projects: milestone amounts, rounds of changes, status
 * transitions and the fairness checks that don't need a model. Pure.
 */
import { formatUsd } from "@/lib/money";
import type { PlanFlag, PlanMilestone } from "./types";

export const MAX_MILESTONES = 5;
export const MIN_MILESTONE_CENTS = 100;
export const MIN_BUDGET_CENTS = 500;
export const MAX_BUDGET_CENTS = 1_000_000_00;
/** How many times the poster may ask for changes to one milestone. */
export const MAX_CHANGE_ROUNDS = 3;

export class ProjectRuleError extends Error {
  override name = "ProjectRuleError";
}

/**
 * Splits `totalCents` in proportion to `weights`, as whole cents that add up
 * exactly, each at least MIN_MILESTONE_CENTS (largest remainder method).
 */
export function allocate(totalCents: number, weights: number[]): number[] {
  const n = weights.length;
  if (!n) throw new ProjectRuleError("Add at least one milestone");
  if (!Number.isInteger(totalCents) || totalCents < n * MIN_MILESTONE_CENTS) {
    throw new ProjectRuleError(
      `The budget must give each milestone at least ${formatUsd(MIN_MILESTONE_CENTS)}`,
    );
  }
  const safe = weights.map((w) => (Number.isFinite(w) && w > 0 ? w : 0));
  const sum = safe.reduce((a, b) => a + b, 0);
  const shares = sum > 0 ? safe.map((w) => w / sum) : safe.map(() => 1 / n);
  const raw = shares.map((s) => s * totalCents);
  const out = raw.map((r) => Math.floor(r));
  // The cents lost to rounding go to the largest remainders.
  let left = totalCents - out.reduce((a, b) => a + b, 0);
  const order = raw
    .map((r, i) => ({ i, frac: r - Math.floor(r) }))
    .sort((a, b) => b.frac - a.frac || a.i - b.i);
  for (let k = 0; left > 0; k = (k + 1) % n, left--) out[order[k].i] += 1;
  // Lift any milestone under the minimum, taking the difference from the largest.
  for (let i = 0; i < n; i++) {
    while (out[i] < MIN_MILESTONE_CENTS) {
      const largest = out.indexOf(Math.max(...out));
      const take = Math.min(MIN_MILESTONE_CENTS - out[i], out[largest] - MIN_MILESTONE_CENTS);
      out[largest] -= take;
      out[i] += take;
    }
  }
  return out;
}

/** What's wrong with a set of milestones for this budget, or null when they're fine. */
export function milestoneProblem(milestones: PlanMilestone[], budgetCents: number): string | null {
  if (milestones.length < 1) return "Add at least one milestone";
  if (milestones.length > MAX_MILESTONES) return `At most ${MAX_MILESTONES} milestones`;
  for (const [i, m] of milestones.entries()) {
    if (!m.title.trim()) return `Milestone ${i + 1} needs a title`;
    if (!m.criteria.some((c) => c.trim())) {
      return `Milestone ${i + 1} needs at least one acceptance criterion`;
    }
    if (!Number.isInteger(m.amountCents) || m.amountCents < MIN_MILESTONE_CENTS) {
      return `Milestone ${i + 1} must be at least ${formatUsd(MIN_MILESTONE_CENTS)}`;
    }
  }
  const sum = milestones.reduce((n, m) => n + m.amountCents, 0);
  if (sum !== budgetCents) {
    return `Milestones add up to ${formatUsd(sum)}, but the budget is ${formatUsd(budgetCents)}`;
  }
  return null;
}

/**
 * Fairness checks that need no model: a deadline in the past or too close for
 * the work, and a budget too thin per milestone.
 */
export function termFlags(input: {
  budgetCents: number;
  deadline: Date;
  milestones: number;
  now: Date;
}): PlanFlag[] {
  const flags: PlanFlag[] = [];
  const days = (input.deadline.getTime() - input.now.getTime()) / 86_400_000;
  if (days < 1) {
    flags.push({
      kind: "impossible_deadline",
      message: "The deadline is less than a day away. Give the work time to be done well.",
    });
  } else if (days < input.milestones * 2) {
    flags.push({
      kind: "impossible_deadline",
      message: `About ${Math.floor(days)} day(s) for ${input.milestones} milestone(s) is tight; consider a later deadline or fewer milestones.`,
    });
  }
  if (input.budgetCents / Math.max(1, input.milestones) < 2500) {
    flags.push({
      kind: "unfair_budget",
      message: `${formatUsd(input.budgetCents)} across ${input.milestones} milestone(s) is under $25 each; check it pays fairly for the work.`,
    });
  }
  return flags;
}

/** How a proposal's price compares with the budget, in words. */
export function priceVsBudget(priceCents: number, budgetCents: number): string {
  if (priceCents === budgetCents) return "matches the budget";
  const pct = Math.round((Math.abs(priceCents - budgetCents) / budgetCents) * 100);
  if (pct === 0) return "matches the budget";
  return priceCents < budgetCents ? `${pct}% under budget` : `${pct}% over budget`;
}

/* ---------- Status transitions ---------- */

export type ProjectStatus =
  "draft" | "open" | "in_progress" | "completed" | "cancelled" | "disputed";
export type ProjectEvent =
  "open" | "accept" | "complete" | "cancel" | "dispute" | "resume" | "close";

const PROJECT: Record<ProjectStatus, Partial<Record<ProjectEvent, ProjectStatus>>> = {
  draft: { open: "open", cancel: "cancelled" },
  open: { accept: "in_progress", cancel: "cancelled" },
  in_progress: { complete: "completed", cancel: "cancelled", dispute: "disputed" },
  disputed: { resume: "in_progress", complete: "completed", close: "cancelled" },
  completed: {},
  cancelled: {},
};

export function nextProjectStatus(from: ProjectStatus, event: ProjectEvent): ProjectStatus {
  const to = PROJECT[from][event];
  if (!to) throw new ProjectRuleError(`A ${from.replace("_", " ")} project can't ${event}`);
  return to;
}

export type MilestoneStatus =
  "pending" | "funded" | "submitted" | "changes_requested" | "approved" | "released" | "refunded";
export type MilestoneEvent =
  | "fund"
  | "submit"
  | "request_changes"
  | "approve"
  | "release"
  | "refund"
  /** A dispute decided for the seller: pay out whatever was delivered. */
  | "settle";

const MILESTONE: Record<MilestoneStatus, Partial<Record<MilestoneEvent, MilestoneStatus>>> = {
  pending: { fund: "funded" },
  funded: { submit: "submitted", refund: "refunded", settle: "released" },
  submitted: {
    request_changes: "changes_requested",
    approve: "approved",
    refund: "refunded",
    settle: "released",
  },
  changes_requested: { submit: "submitted", refund: "refunded", settle: "released" },
  approved: { release: "released" },
  released: {},
  refunded: {},
};

export function nextMilestoneStatus(from: MilestoneStatus, event: MilestoneEvent): MilestoneStatus {
  const to = MILESTONE[from][event];
  if (!to)
    throw new ProjectRuleError(
      `A ${from.replace("_", " ")} milestone can't ${event.replace("_", " ")}`,
    );
  return to;
}

/** Whether the poster may ask for changes again, after `rounds` requests. */
export function changesAllowed(rounds: number): { ok: true } | { ok: false; reason: string } {
  return rounds < MAX_CHANGE_ROUNDS
    ? { ok: true }
    : {
        ok: false,
        reason: `You've asked for changes ${MAX_CHANGE_ROUNDS} times on this milestone. Approve it, or raise a dispute.`,
      };
}

/** Money is held for a milestone in these states. */
export const HELD: MilestoneStatus[] = ["funded", "submitted", "changes_requested", "approved"];

/** A project is done when every milestone is paid out (or refunded, with at least one paid). */
export function allSettled(statuses: MilestoneStatus[]) {
  return statuses.length > 0 && statuses.every((s) => s === "released" || s === "refunded");
}

/**
 * The poster may cancel while no work has been handed in: funded milestones
 * are refunded. Once something is delivered, a disagreement is a dispute.
 */
export function cancelAllowed(
  statuses: MilestoneStatus[],
): { ok: true } | { ok: false; reason: string } {
  const delivered = statuses.some(
    (s) => s === "submitted" || s === "changes_requested" || s === "approved" || s === "released",
  );
  return delivered
    ? { ok: false, reason: "Work has been delivered on this project; raise a dispute instead" }
    : { ok: true };
}

/** Rounds a project's stored dates into how many days are left (negative when past). */
export function daysLeft(deadline: Date, now: Date) {
  return Math.ceil((deadline.getTime() - now.getTime()) / 86_400_000);
}
