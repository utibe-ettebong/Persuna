/**
 * Onboarding rules: a plan's shape, how answers are marked, how far a recruit
 * has got, and how a playbook becomes text for prompts and starter skills.
 * Pure.
 */
import type { z } from "zod";
import type { RuleCategory, SkillSheet } from "@/lib/skill/types";
import type {
  Grade,
  ModuleProgress,
  OnboardingNote,
  OnboardingPlan,
  OnboardingProgress,
  PlanModule,
  Playbook,
  PlaybookWorkflow,
  planReply,
  Verdict,
} from "./types";

export const MAX_MODULES = 10;
/** Share of the marks needed to pass a check or a practice task. */
export const PASS_SCORE = 70;

/* ---------- Plans ---------- */

/**
 * The model's plan with ids set (m1, m2…), the company module first, and at
 * most MAX_MODULES modules.
 */
export function normalisePlan(reply: z.infer<typeof planReply>): OnboardingPlan {
  const company = reply.modules.filter((m) => m.kind === "company").slice(0, 1);
  const rest = reply.modules.filter((m) => !company.includes(m));
  return {
    welcome: reply.welcome,
    modules: [...company, ...rest].slice(0, MAX_MODULES).map((m, i) => ({ ...m, id: `m${i + 1}` })),
  };
}

/** What's wrong with a plan, or null when it can be given to a recruit. */
export function planProblem(plan: OnboardingPlan): string | null {
  const { modules } = plan;
  if (!modules.length) return "The plan has no modules";
  if (modules.length > MAX_MODULES) return `At most ${MAX_MODULES} modules`;
  if (modules[0].kind !== "company") return "The plan must start with the company and handbook";
  if (!modules.some((m) => m.kind === "workflow")) {
    return "The plan needs at least one module on the role's workflows";
  }
  const ids = new Set(modules.map((m) => m.id));
  if (ids.size !== modules.length) return "Module ids must be unique";
  for (const [i, m] of modules.entries()) {
    const n = `Module ${i + 1}`;
    if (!m.title.trim()) return `${n} needs a title`;
    if (!m.lessons.length) return `${n} needs at least one lesson`;
    if (!m.practice.task.trim() || !m.practice.rubric.length) {
      return `${n} needs a practice task with what a good answer covers`;
    }
    if (!m.check.length || m.check.some((q) => !q.question.trim() || !q.rubric.length)) {
      return `${n} needs check questions, each with what a good answer covers`;
    }
  }
  return null;
}

/* ---------- Marking ---------- */

const POINTS: Record<Verdict, number> = { met: 1, partly: 0.5, not_met: 0 };

/** A score out of 100 from the verdicts, and whether it passes. */
export function gradeOutcome(verdicts: Verdict[]): { score: number; passed: boolean } {
  if (!verdicts.length) return { score: 0, passed: false };
  const score = Math.round((verdicts.reduce((n, v) => n + POINTS[v], 0) / verdicts.length) * 100);
  return { score, passed: score >= PASS_SCORE };
}

/**
 * Lines the model's results up with the items marked (it may return too few
 * or too many), filling gaps as not met.
 */
export function finishGrade(
  items: string[],
  reply: { results: { verdict: Verdict; feedback: string }[]; summary: string },
  now: Date,
): Grade {
  const results = items.map((item, i) => ({
    item,
    verdict: reply.results[i]?.verdict ?? ("not_met" as const),
    feedback: reply.results[i]?.feedback ?? "Persuna couldn't mark this answer.",
  }));
  return {
    results,
    summary: reply.summary,
    ...gradeOutcome(results.map((r) => r.verdict)),
    at: now.toISOString(),
  };
}

/* ---------- Progress ---------- */

export type ModuleState = "not_started" | "in_progress" | "ready" | "done";

export function moduleState(p: ModuleProgress | undefined): ModuleState {
  if (!p) return "not_started";
  if (p.doneAt) return "done";
  if (p.practice && p.check?.grade.passed) return "ready";
  return p.practice || p.check ? "in_progress" : "not_started";
}

/** A module is done once its practice task is handed in and its check is passed. */
export function canCompleteModule(
  p: ModuleProgress | undefined,
): { ok: true } | { ok: false; reason: string } {
  if (p?.doneAt) return { ok: false, reason: "This module is already done" };
  if (!p?.practice) return { ok: false, reason: "Hand in the practice task first" };
  if (!p.check) return { ok: false, reason: "Answer the check questions first" };
  if (!p.check.grade.passed) {
    return { ok: false, reason: `Pass the check (${PASS_SCORE}% or more) first` };
  }
  return { ok: true };
}

export function onboardingProgress(plan: OnboardingPlan, progress: OnboardingProgress) {
  const total = plan.modules.length;
  const doneIds = plan.modules.filter((m) => progress[m.id]?.doneAt).map((m) => m.id);
  const next = plan.modules.find((m) => !progress[m.id]?.doneAt) ?? null;
  return {
    done: doneIds.length,
    total,
    percent: total ? Math.round((doneIds.length / total) * 100) : 0,
    next,
    nextNumber: next ? plan.modules.indexOf(next) + 1 : null,
    finished: total > 0 && doneIds.length === total,
  };
}

/** The short note Persuna's chat gets about an onboarding in progress. */
export function onboardingNote(input: {
  org: string;
  role: string;
  plan: OnboardingPlan;
  progress: OnboardingProgress;
}): OnboardingNote {
  const p = onboardingProgress(input.plan, input.progress);
  return {
    org: input.org,
    role: input.role,
    next: p.next ? `Module ${p.nextNumber}: ${p.next.title}`.slice(0, 160) : null,
    done: p.done,
    total: p.total,
  };
}

/* ---------- Playbooks ---------- */

/** What's wrong with an edited playbook, or null. */
export function playbookProblem(playbook: Playbook): string | null {
  if (!playbook.summary.trim()) return "Write a short summary of the role";
  if (!playbook.workflows.length) return "Add at least one workflow";
  if (playbook.workflows.length > 8) return "At most 8 workflows";
  for (const [i, w] of playbook.workflows.entries()) {
    if (!w.title.trim()) return `Workflow ${i + 1} needs a title`;
    if (!w.steps.some((s) => s.trim())) return `Workflow ${i + 1} needs at least one step`;
  }
  return null;
}

const bullets = (items: string[]) => items.map((i) => `- ${i}`).join("\n");

function renderWorkflow(w: PlaybookWorkflow): string {
  return [
    `### Workflow: ${w.title}`,
    w.when ? `When: ${w.when}` : "",
    `Steps:\n${w.steps.map((s, i) => `${i + 1}. ${s}`).join("\n")}`,
    w.tools.length ? `Tools: ${w.tools.join("; ")}` : "",
    w.qualityBar.length ? `Quality bar:\n${bullets(w.qualityBar)}` : "",
    w.mistakes.length ? `Common mistakes:\n${bullets(w.mistakes)}` : "",
  ]
    .filter(Boolean)
    .join("\n");
}

/** The playbook as plain text, for prompts and for reading. */
export function renderPlaybook(p: Playbook): string {
  return [
    `## Summary\n${p.summary}`,
    p.tools.length ? `## Tools\n${bullets(p.tools)}` : "",
    p.qualityBar.length ? `## Quality bar\n${bullets(p.qualityBar)}` : "",
    p.mistakes.length ? `## Common mistakes\n${bullets(p.mistakes)}` : "",
    ...p.workflows.map(renderWorkflow),
  ]
    .filter(Boolean)
    .join("\n\n");
}

/** The handbook notes as plain text. */
export function renderHandbook(notes: { kind: string; title: string; body: string }[]): string {
  return notes.map((n) => `### ${n.title} (${n.kind})\n${n.body}`).join("\n\n");
}

/** What a module draws on: the handbook for the company module, else the matching workflow. */
export function moduleMaterial(
  module: Pick<PlanModule, "kind" | "title">,
  playbook: Playbook,
  handbook: string,
): string {
  if (module.kind === "company") return handbook || renderPlaybook(playbook);
  const title = module.title.toLowerCase();
  const match = playbook.workflows.find(
    (w) => title.includes(w.title.toLowerCase()) || w.title.toLowerCase().includes(title),
  );
  return match ? renderWorkflow(match) : renderPlaybook(playbook);
}

/**
 * A starter skill's rule sheet from one workflow: its steps, quality bar,
 * mistakes to avoid and tools, as rules. Method only, by construction: the
 * playbook holds no job text.
 */
export function starterSheet(w: PlaybookWorkflow, playbook: Playbook): SkillSheet {
  const rules: { category: RuleCategory; text: string }[] = [
    ...w.steps.map((s, i) => ({ category: "structure" as const, text: `Step ${i + 1}: ${s}` })),
    ...[...w.qualityBar, ...playbook.qualityBar.slice(0, 3)].map((text) => ({
      category: "content" as const,
      text,
    })),
    ...[...w.mistakes, ...playbook.mistakes.slice(0, 3)].map((text) => ({
      category: "cut" as const,
      text: `Avoid: ${text}`,
    })),
    ...(w.tools.length
      ? [{ category: "formatting" as const, text: `Work in: ${w.tools.join(", ")}` }]
      : []),
  ];
  const seen = new Set<string>();
  const unique = rules.filter((r) => !seen.has(r.text) && seen.add(r.text));
  return {
    summary: `${w.title}, the way the team does it.${w.when ? ` When: ${w.when}` : ""}`.slice(
      0,
      600,
    ),
    rules: unique.slice(0, 30).map((r, i) => ({ id: `R${i + 1}`, ...r })),
    template: w.steps.map((s, i) => `${i + 1}. ${s}`).join("\n"),
  };
}
