import { CRITERIA, type Criterion, type ScoreBreakdown } from "./types";

/**
 * Weights for the replication score. Structure and content matter most for
 * minutes: a draft with the right decisions in the wrong shape still needs work.
 */
export const CRITERION_WEIGHTS: Record<Criterion, number> = {
  structure: 0.25,
  content: 0.3,
  cuts: 0.2,
  tone: 0.1,
  naming: 0.15,
};

/** 0–100 replication score from the evaluator's 0–10 criterion scores. */
export function replicationScore(breakdown: ScoreBreakdown): number {
  const total = CRITERIA.reduce((sum, c) => sum + breakdown.criteria[c] * CRITERION_WEIGHTS[c], 0);
  return Math.round(total * 10 * 10) / 10;
}

export function mean(values: number[]): number | null {
  if (values.length === 0) return null;
  return Math.round((values.reduce((a, b) => a + b, 0) / values.length) * 10) / 10;
}
