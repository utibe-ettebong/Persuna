/**
 * Persuna's work for teams, with no storage: build a role's playbook, plan an
 * onboarding, mark answers, answer a recruit's question. Each takes a
 * ModelClient, asks with a prompt from prompts.ts and parses the reply with
 * Zod; the teams service stores the results.
 */
import type { ModelClient } from "@/lib/models/gateway";
import { completeJson } from "@/lib/models/json";
import {
  onboardingAskMessages,
  onboardingGradeMessages,
  onboardingPlanMessages,
  rolePlaybookMessages,
} from "@/lib/skill/prompts";
import { finishGrade, normalisePlan, planProblem, renderPlaybook } from "./onboarding";
import {
  askReply,
  gradeReply,
  planReply,
  playbookSchema,
  type AskAnswer,
  type Grade,
  type OnboardingPlan,
  type Playbook,
} from "./types";

/** The role's playbook from its skills' rule sheets (method only) and the handbook. */
export async function buildPlaybook(
  client: ModelClient,
  input: {
    org: string;
    role: string;
    description: string;
    handbook: string;
    skills: { name: string; task: string; sheet: string }[];
  },
): Promise<{ playbook: Playbook; model: string }> {
  const { value, completion } = await completeJson(
    client,
    "extract",
    rolePlaybookMessages(input),
    playbookSchema,
  );
  return { playbook: value, model: completion.model };
}

/** The onboarding plan for a recruit, from the published playbook and the handbook. */
export async function buildOnboardingPlan(
  client: ModelClient,
  input: { org: string; role: string; playbook: Playbook; handbook: string },
): Promise<OnboardingPlan> {
  const { value } = await completeJson(
    client,
    "extract",
    onboardingPlanMessages({
      org: input.org,
      role: input.role,
      playbook: renderPlaybook(input.playbook),
      handbook: input.handbook,
    }),
    planReply,
  );
  const plan = normalisePlan(value);
  const problem = planProblem(plan);
  if (problem) throw new Error(`Persuna's onboarding plan wasn't usable (${problem}). Try again.`);
  return plan;
}

/** Marks answers against their rubrics, grounded in the module's material. */
export async function gradeAnswers(
  client: ModelClient,
  input: {
    module: string;
    material: string;
    items: { prompt: string; rubric: string[]; answer: string }[];
    now: Date;
  },
): Promise<Grade> {
  const { value } = await completeJson(
    client,
    "evaluate",
    onboardingGradeMessages(input),
    gradeReply,
  );
  return finishGrade(
    input.items.map((i) => i.prompt),
    value,
    input.now,
  );
}

/** A recruit's question, answered only from the playbook and handbook. */
export async function answerQuestion(
  client: ModelClient,
  input: { org: string; role: string; material: string; question: string },
): Promise<AskAnswer> {
  const { value } = await completeJson(client, "draft", onboardingAskMessages(input), askReply);
  return value;
}
