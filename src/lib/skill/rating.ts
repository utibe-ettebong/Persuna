import type { SkillStep } from "@/db/schema";

/**
 * The composite rating (plan §4.5): six parts, each 0–100 or null when not yet
 * measurable. Shown as the parts, never collapsed to one number — and the
 * listing gate reads coverage and confidence off it.
 */
export interface Composite {
  /** Today's 0–100 replication score, kept. */
  replication: number | null;
  /** Fitness and branch coverage: the weaker of the two. */
  coverage: number | null;
  /** Share of rules with two or more independent sources. */
  confidence: number | null;
  /** Share of rules traceable to an observation, answer or correction. */
  groundedness: number | null;
  /** Recent episodes still fit; the method hasn't drifted. */
  freshness: number | null;
  /** Share of jobs delivered without correction. */
  reliability: number | null;
}

/**
 * Share of branches confirmed by repetition (every step seen twice or more).
 * Full without decisions; a lone surviving branch isn't a decision.
 */
export function branchCoverage(steps: SkillStep[]): number {
  const keyed = steps.filter((step) => step.decisionKey !== null);
  const byKey = new Map<string, Map<string, number[]>>();
  for (const step of keyed) {
    const branches = byKey.get(step.decisionKey!) ?? new Map<string, number[]>();
    const evidence = branches.get(step.branchLabel ?? "") ?? [];
    evidence.push(step.evidenceCount);
    branches.set(step.branchLabel ?? "", evidence);
    byKey.set(step.decisionKey!, branches);
  }
  let total = 0;
  let observed = 0;
  for (const branches of byKey.values()) {
    if (branches.size < 2) continue;
    for (const evidence of branches.values()) {
      total += 1;
      if (Math.min(...evidence) >= 2) observed += 1;
    }
  }
  return total === 0 ? 1 : Math.round((observed / total) * 100) / 100;
}

/** Coverage: fitness pulled down to branch coverage (null without episodes). */
export function coverageOf(fitness: number | null, steps: SkillStep[]): number | null {
  if (fitness === null) return null;
  return Math.round(Math.min(fitness, branchCoverage(steps)) * 100);
}

/** Share of rules with two or more independent sources (null without rules). */
export function confidenceOf(ruleIds: string[], counts: Record<string, number>): number | null {
  if (ruleIds.length === 0) return null;
  const confirmed = ruleIds.filter((id) => (counts[id] ?? 0) >= 2).length;
  return Math.round((confirmed / ruleIds.length) * 100);
}

/** Share of rules with at least one source (null without rules). */
export function groundednessOf(ruleIds: string[], counts: Record<string, number>): number | null {
  if (ruleIds.length === 0) return null;
  const grounded = ruleIds.filter((id) => (counts[id] ?? 0) >= 1).length;
  return Math.round((grounded / ruleIds.length) * 100);
}

/** Mean fitness over recent episodes (null when none learned yet). */
export function freshnessOf(fitnesses: (number | null)[]): number | null {
  const measured = fitnesses.filter((fitness): fitness is number => fitness !== null);
  if (measured.length === 0) return null;
  return Math.round((measured.reduce((a, b) => a + b, 0) / measured.length) * 100);
}

/** Share of delivered jobs that never drew a correction (null without jobs). */
export function reliabilityOf(delivered: number, corrected: number): number | null {
  if (delivered === 0) return null;
  return Math.round(((delivered - corrected) / delivered) * 100);
}
