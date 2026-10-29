/**
 * Shapes of Persuna's checks on a project. The model's raw replies are parsed
 * with the *Reply schemas; what's stored is the finished shape after
 * deterministic post-processing (amounts in cents, rule-based flags).
 */
import { z } from "zod";

const line = z.string().trim().min(1).max(600);

export const FLAG_KINDS = [
  "vague",
  "unfair_budget",
  "impossible_deadline",
  "unfair_terms",
  "other",
] as const;
export const planFlag = z.object({
  kind: z.enum(FLAG_KINDS).catch("other"),
  message: line,
});
export type PlanFlag = z.infer<typeof planFlag>;

export const planReply = z.object({
  scope: z.string().trim().min(1).max(3000),
  criteria: z.array(line).max(12).default([]),
  milestones: z
    .array(
      z.object({
        title: z.string().trim().min(1).max(120),
        criteria: z.array(line).min(1).max(8),
        /** Share of the budget, any positive numbers (normalised in code). */
        share: z.coerce.number().positive().catch(1),
      }),
    )
    .min(1)
    .max(8),
  flags: z.array(planFlag).max(10).default([]),
});

export interface PlanMilestone {
  title: string;
  criteria: string[];
  amountCents: number;
}

/** Persuna's reading of a brief: scope, acceptance criteria, milestones and fairness flags. */
export interface ProjectPlan {
  scope: string;
  criteria: string[];
  milestones: PlanMilestone[];
  flags: PlanFlag[];
}

export const fitReply = z.object({
  summary: line,
  strengths: z.array(line).max(6).default([]),
  risks: z.array(line).max(6).default([]),
  recommendation: z.enum(["strong", "possible", "weak"]).catch("possible"),
});

/** Persuna's note to the poster about one proposal. */
export interface FitReport extends z.infer<typeof fitReply> {
  /** The seller's Persuna Verified skills, with their scores. */
  verifiedSkills: { title: string; score: number }[];
  /** e.g. "20% under budget". */
  priceNote: string;
}

export const VERDICTS = ["met", "not_met", "unclear"] as const;
export type Verdict = (typeof VERDICTS)[number];

export const checkReply = z.object({
  results: z
    .array(
      z.object({
        criterion: z.string().trim().max(600).default(""),
        verdict: z.enum(VERDICTS).catch("unclear"),
        reason: line,
      }),
    )
    .min(1)
    .max(12),
  summary: line,
  fairness: z.object({ poster: line, seller: line }),
});

/** A delivery checked against its milestone's acceptance criteria. */
export interface MilestoneCheck {
  results: { criterion: string; verdict: Verdict; reason: string }[];
  summary: string;
  fairness: { poster: string; seller: string };
  round: number;
  checkedAt: string;
}

export const disputeReply = z.object({
  assessment: line,
  posterView: line,
  sellerView: line,
  suggestion: line,
});
export type DisputeAssessment = z.infer<typeof disputeReply>;

export const wrapupReply = z.object({
  summary: line,
  wentWell: z.array(line).max(5).default([]),
  toImprove: z.array(line).max(5).default([]),
});
export type ProjectWrapup = z.infer<typeof wrapupReply>;
