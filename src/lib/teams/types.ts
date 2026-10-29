/**
 * Shapes for Persuna for teams: a role's playbook, a new hire's onboarding
 * plan, their progress, and Persuna's grading and answers. Model replies are
 * parsed with these schemas; ids and pass marks are set in code.
 */
import { z } from "zod";

const line = z.string().trim().min(1).max(500);
const list = (max: number) => z.array(line).max(max).default([]);

export const playbookWorkflow = z.object({
  title: z.string().trim().min(1).max(120),
  /** When the workflow runs ("A client sends a new brief"). */
  when: z.string().trim().max(300).default(""),
  steps: z.array(line).min(1).max(15),
  tools: list(10),
  qualityBar: list(10),
  mistakes: list(10),
});
export type PlaybookWorkflow = z.infer<typeof playbookWorkflow>;

/** How a role works at the company: method only, built from its skills and the handbook. */
export const playbookSchema = z.object({
  summary: z.string().trim().min(1).max(1500),
  workflows: z.array(playbookWorkflow).min(1).max(8),
  tools: list(15),
  qualityBar: list(12),
  mistakes: list(12),
});
export type Playbook = z.infer<typeof playbookSchema>;

export const MODULE_KINDS = ["company", "workflow"] as const;

const lesson = z.object({
  title: z.string().trim().min(1).max(120),
  body: z.string().trim().min(1).max(3000),
});

const checkQuestion = z.object({
  question: line,
  /** What a good answer covers, one point per line. */
  rubric: z.array(line).min(1).max(6),
});

export const planModuleReply = z.object({
  kind: z.enum(MODULE_KINDS).catch("workflow"),
  title: z.string().trim().min(1).max(120),
  lessons: z.array(lesson).min(1).max(6),
  practice: z.object({
    task: z.string().trim().min(1).max(1500),
    rubric: z.array(line).min(1).max(6),
  }),
  check: z.array(checkQuestion).min(1).max(5),
});

export const planReply = z.object({
  welcome: z.string().trim().max(1000).default(""),
  modules: z.array(planModuleReply).min(1).max(10),
});

export interface PlanModule extends z.infer<typeof planModuleReply> {
  /** m1, m2… set in code, so progress can refer to modules. */
  id: string;
}

/** A new hire's course through the role: the company, then each workflow. */
export interface OnboardingPlan {
  welcome: string;
  modules: PlanModule[];
}

export const VERDICTS = ["met", "partly", "not_met"] as const;
export type Verdict = (typeof VERDICTS)[number];

export const gradeReply = z.object({
  results: z
    .array(
      z.object({
        verdict: z.enum(VERDICTS).catch("not_met"),
        feedback: line,
      }),
    )
    .min(1)
    .max(6),
  summary: line,
});

/** Persuna's marking of a practice task or a module check. */
export interface Grade {
  results: { item: string; verdict: Verdict; feedback: string }[];
  summary: string;
  /** 0–100, from the verdicts (met 1, partly ½). */
  score: number;
  passed: boolean;
  at: string;
}

export interface ModuleProgress {
  practice?: { answer: string; grade: Grade };
  check?: { answers: string[]; grade: Grade };
  doneAt?: string;
}

/** Per module id. */
export type OnboardingProgress = Record<string, ModuleProgress>;

export const askReply = z.object({
  answer: z.string().trim().min(1).max(2000),
  /** False when the playbook and handbook don't say. */
  known: z.boolean().catch(false),
  /** Which parts it drew on (workflow or note titles). */
  from: z.array(z.string().trim().max(120)).max(6).default([]),
});
export type AskAnswer = z.infer<typeof askReply>;

/** What Persuna's chat knows about an onboarding in progress. Small on purpose. */
export interface OnboardingNote {
  org: string;
  role: string;
  /** "Module 2: Running a design review", or null when every module is done. */
  next: string | null;
  done: number;
  total: number;
}
