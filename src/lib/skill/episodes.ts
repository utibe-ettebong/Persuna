import type { SkillStep } from "@/db/schema";

/** One step observed in an episode, derived from its events. */
export interface ObservedStep {
  app: string;
  action: string;
  targetRole: string;
  targetLabel: string;
}

/** A recorded event, as the desktop stream sends it (role, action, time; no values). */
export interface EpisodeEventInput {
  app: string;
  window: string;
  action: string;
  role: string;
  label: string;
  at: Date;
}

/** Labels match at this token overlap: "Invoice from Ada" is "Invoice from Bo", "Inbox" isn't "Sent". */
const LABEL_OVERLAP = 0.5;

/** Lowercase, single-spaced, numbers folded: procedures don't depend on positions or counts. */
function normalize(value: string): string {
  return value
    .toLowerCase()
    .replace(/[0-9]+/g, "#")
    .replace(/\s+/g, " ")
    .trim();
}

function tokens(label: string): string[] {
  const words = normalize(label).split(" ").filter(Boolean);
  return [...new Set(words)];
}

/** Overlap coefficient of two labels' tokens (1 when both are empty). */
function labelScore(a: string, b: string): number {
  const left = tokens(a);
  const right = tokens(b);
  if (left.length === 0 && right.length === 0) return 1;
  if (left.length === 0 || right.length === 0) return 0;
  const shared = left.filter((word) => right.includes(word)).length;
  return shared / Math.min(left.length, right.length);
}

function sameStep(a: ObservedStep, b: ObservedStep): boolean {
  return (
    normalize(a.app) === normalize(b.app) &&
    normalize(a.action) === normalize(b.action) &&
    normalize(a.targetRole) === normalize(b.targetRole) &&
    labelScore(a.targetLabel, b.targetLabel) >= LABEL_OVERLAP
  );
}

const asObserved = (s: Pick<SkillStep, "app" | "action" | "targetRole" | "targetLabel">) => ({
  app: s.app,
  action: s.action,
  targetRole: s.targetRole,
  targetLabel: s.targetLabel,
});

/**
 * Observed steps from an episode's events: one step per step-change event,
 * consecutive repeats dropped. Windows are left out of step identity — the
 * document changes, the procedure doesn't.
 */
export function stepsFromEvents(events: EpisodeEventInput[]): ObservedStep[] {
  const steps: ObservedStep[] = [];
  for (const event of events) {
    const step = {
      app: event.app,
      action: event.action,
      targetRole: event.role,
      targetLabel: event.label,
    };
    const prev = steps[steps.length - 1];
    if (
      prev &&
      prev.app === step.app &&
      prev.action === step.action &&
      prev.targetRole === step.targetRole &&
      prev.targetLabel === step.targetLabel
    ) {
      continue;
    }
    steps.push(step);
  }
  return steps;
}

export interface StepUpdate {
  id: string;
  seq: number;
  evidenceCount: number;
  episodeIds: string[];
  decisionKey?: string;
  branchLabel?: string;
}

export interface StepInsert extends ObservedStep {
  seq: number;
  decisionKey?: string;
  branchLabel?: string;
}

/** Short human label for a branch, from its first step. */
function branchLabelOf(step: ObservedStep): string {
  return [step.app, step.action, step.targetLabel || step.targetRole]
    .filter(Boolean)
    .join(" ")
    .slice(0, 80);
}

/**
 * Folds one episode's observed steps into the skill's procedure. Matches bump
 * evidence (never twice for one episode); new steps insert where they were
 * seen, between their matched neighbours, and everything is renumbered.
 */
export function mergeSteps(
  existing: SkillStep[],
  observed: ObservedStep[],
  episodeId: string,
): { updates: StepUpdate[]; inserts: StepInsert[] } {
  const order: {
    id: string | null;
    step: ObservedStep;
    evidenceCount: number;
    episodeIds: string[];
    decisionKey: string | null;
    branchLabel: string | null;
  }[] = [...existing]
    .sort((a, b) => a.seq - b.seq)
    .map((s) => ({
      id: s.id,
      step: asObserved(s),
      evidenceCount: s.evidenceCount,
      episodeIds: [...s.episodeIds],
      decisionKey: s.decisionKey,
      branchLabel: s.branchLabel,
    }));
  let pointer = 0;
  for (const step of observed) {
    const at = order.findIndex((entry) => sameStep(entry.step, step));
    if (at >= 0) {
      const entry = order[at]!;
      if (!entry.episodeIds.includes(episodeId)) {
        entry.episodeIds.push(episodeId);
        entry.evidenceCount += 1;
      }
      pointer = at + 1;
      continue;
    }
    // New step: where it was seen, between its matched neighbours — the
    // order is the procedure, and fitness replays it in order.
    order.splice(Math.min(pointer, order.length), 0, {
      id: null,
      step,
      evidenceCount: 1,
      episodeIds: [episodeId],
      decisionKey: null,
      branchLabel: null,
    });
    pointer += 1;
  }
  assignDecisions(order, observed, episodeId);
  const updates: StepUpdate[] = [];
  const inserts: StepInsert[] = [];
  order.forEach((entry, index) => {
    const seq = index + 1;
    if (entry.id) {
      const before = existing.find((s) => s.id === entry.id)!;
      const rekeyed =
        entry.decisionKey !== before.decisionKey || entry.branchLabel !== before.branchLabel;
      if (
        seq !== before.seq ||
        entry.evidenceCount !== before.evidenceCount ||
        entry.episodeIds.length !== before.episodeIds.length ||
        rekeyed
      ) {
        updates.push({
          id: entry.id,
          seq,
          evidenceCount: entry.evidenceCount,
          episodeIds: entry.episodeIds,
          ...(rekeyed
            ? {
                decisionKey: entry.decisionKey ?? undefined,
                branchLabel: entry.branchLabel ?? undefined,
              }
            : {}),
        });
      }
    } else {
      inserts.push({
        ...entry.step,
        seq,
        ...(entry.decisionKey
          ? { decisionKey: entry.decisionKey, branchLabel: entry.branchLabel ?? undefined }
          : {}),
      });
    }
  });
  return { updates, inserts };
}

type OrderEntry = {
  id: string | null;
  step: ObservedStep;
  evidenceCount: number;
  episodeIds: string[];
  decisionKey: string | null;
  branchLabel: string | null;
};

/**
 * Marks middle divergences as decisions: when the episode ran new steps
 * between two matched anchors past existing steps, both paths become branches
 * sharing a key. Beginnings, endings and straight runs stay unbranched, and a
 * span that's already decided never nests a second decision.
 */
function assignDecisions(order: OrderEntry[], observed: ObservedStep[], episodeId: string) {
  const taken = new Set(order.map((entry) => entry.decisionKey).filter((key) => key !== null));
  let next = 1;
  const freshKey = () => {
    while (taken.has(`d${next}`)) next += 1;
    const key = `d${next}`;
    taken.add(key);
    next += 1;
    return key;
  };
  // Realign the episode to existing steps only (inserts are the runs to place).
  const matched: (number | null)[] = [];
  let cursor = 0;
  for (const step of observed) {
    const at = order.findIndex(
      (entry, index) => index >= cursor && entry.id !== null && sameStep(entry.step, step),
    );
    matched.push(at >= 0 ? at : null);
    if (at >= 0) cursor = at + 1;
  }
  let run: number[] = [];
  const flush = (before: number, after: number) => {
    if (run.length === 0 || before < 0 || after >= order.length) {
      run = [];
      return;
    }
    const between = order.slice(before + 1, after);
    const fresh = between.filter(
      (entry) =>
        entry.id === null && entry.episodeIds.length === 1 && entry.episodeIds[0] === episodeId,
    );
    const skipped = between.filter((entry) => entry.id !== null);
    run = [];
    if (fresh.length === 0 || skipped.length === 0) return;
    if (between.some((entry) => entry.decisionKey !== null)) return;
    const key = freshKey();
    for (const entry of fresh) {
      entry.decisionKey = key;
      entry.branchLabel = branchLabelOf(fresh[0]!.step);
    }
    for (const entry of skipped) {
      entry.decisionKey = key;
      entry.branchLabel = branchLabelOf(skipped[0]!.step);
    }
  };
  let anchor = -1;
  for (const [index, at] of matched.entries()) {
    if (at === null) {
      run.push(index);
      continue;
    }
    flush(anchor, at);
    anchor = at;
  }
}

export interface Fitness {
  /** Share of observed steps that map to a skill step, in order. */
  fitness: number;
  mapped: number;
  total: number;
  /** Observed steps the skill doesn't explain. */
  unmapped: ObservedStep[];
  /** Skill steps the episode never touched. */
  skipped: SkillStep[];
}

/**
 * Replays the skill against one episode: each observed step maps to the next
 * matching skill step in order. Plan §4.4: at least 90% of observed steps map.
 * An empty episode maps vacuously.
 */
export function fitnessOf(skill: SkillStep[], observed: ObservedStep[]): Fitness {
  if (observed.length === 0) {
    return { fitness: 1, mapped: 0, total: 0, unmapped: [], skipped: [...skill] };
  }
  const ordered = [...skill].sort((a, b) => a.seq - b.seq);
  const used = new Set<string>();
  const unmapped: ObservedStep[] = [];
  let cursor = 0;
  for (const step of observed) {
    const at = ordered.findIndex(
      (s, i) => i >= cursor && !used.has(s.id) && sameStep(asObserved(s), step),
    );
    if (at >= 0) {
      used.add(ordered[at]!.id);
      cursor = at + 1;
    } else {
      unmapped.push(step);
    }
  }
  const mapped = observed.length - unmapped.length;
  return {
    fitness: Math.round((mapped / observed.length) * 100) / 100,
    mapped,
    total: observed.length,
    unmapped,
    skipped: ordered.filter((s) => !used.has(s.id)),
  };
}
