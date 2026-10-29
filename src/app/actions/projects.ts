"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { attempt, uuidField, type ActionState } from "@/lib/action-state";
import { requireUser } from "@/lib/auth/session";
import { createModelClient } from "@/lib/models";
import { dollarsField } from "@/lib/money";
import { MAX_BUDGET_CENTS, MAX_MILESTONES, MIN_BUDGET_CENTS } from "@/lib/projects/rules";
import {
  acceptProposal,
  approveMilestone,
  cancelProject,
  createProject,
  fundMilestone,
  propose,
  raiseDispute,
  rateProject,
  requestMilestoneChanges,
  resolveMilestone,
  resumeProject,
  savePlan,
  submitDelivery,
} from "@/lib/projects/service";

const page = (id: string) => `/projects/${id}`;
const lines = (text: string) =>
  text
    .split(/\r?\n/)
    .map((l) => l.replace(/^\s*(?:[-*•]|\d+[.)])\s*/, "").trim())
    .filter(Boolean);

const budget = dollarsField("Budget", MIN_BUDGET_CENTS, MAX_BUDGET_CENTS);

const newProject = z.object({
  title: z.string().trim().min(5, "Give the project a title (5+ characters)").max(120),
  brief: z.string().trim().min(40, "Describe the work (40+ characters)").max(10_000),
  budget,
  deadline: z.iso.date("Pick a deadline"),
});

export async function createProjectAction(_: ActionState, form: FormData): Promise<ActionState> {
  return attempt(async () => {
    const user = await requireUser("/projects/new");
    const input = newProject.parse(Object.fromEntries(form));
    const project = await createProject(createModelClient(user), user, {
      title: input.title,
      brief: input.brief,
      budgetCents: input.budget,
      // The end of the chosen day, UTC.
      deadline: new Date(`${input.deadline}T23:59:59Z`),
    });
    return page(project.id);
  });
}

export async function savePlanAction(_: ActionState, form: FormData): Promise<ActionState> {
  return attempt(async () => {
    const user = await requireUser();
    const projectId = uuidField.parse(form.get("projectId"));
    const total = budget.parse(form.get("budget") ?? "");
    const milestones = Array.from({ length: MAX_MILESTONES }, (_, i) => ({
      title: String(form.get(`m${i}_title`) ?? "").trim(),
      criteria: lines(String(form.get(`m${i}_criteria`) ?? "")),
      amount: String(form.get(`m${i}_amount`) ?? "").trim(),
    }))
      .filter((m) => m.title || m.criteria.length || m.amount)
      .map((m, i) => ({
        title: m.title,
        criteria: m.criteria,
        amountCents: dollarsField(`Milestone ${i + 1} amount`, 0, MAX_BUDGET_CENTS).parse(m.amount),
      }));
    await savePlan(user, projectId, {
      scope: String(form.get("scope") ?? ""),
      criteria: lines(String(form.get("criteria") ?? "")),
      milestones,
      budgetCents: total,
      open: form.get("intent") === "open",
    });
    revalidatePath("/projects");
    return page(projectId);
  });
}

const proposalForm = z.object({
  projectId: uuidField,
  message: z.string().trim().min(20, "Say how you'd do it (20+ characters)").max(4000),
  price: dollarsField("Price", MIN_BUDGET_CENTS, MAX_BUDGET_CENTS),
  days: z.coerce.number().int().min(1, "At least 1 day").max(365),
  listingId: z.union([z.literal(""), uuidField]).optional(),
});

export async function proposeAction(_: ActionState, form: FormData): Promise<ActionState> {
  return attempt(async () => {
    const user = await requireUser();
    const input = proposalForm.parse(Object.fromEntries(form));
    await propose(createModelClient(user), user, input.projectId, {
      message: input.message,
      priceCents: input.price,
      days: input.days,
      listingId: input.listingId || null,
    });
    return page(input.projectId);
  });
}

export async function acceptProposalAction(_: ActionState, form: FormData): Promise<ActionState> {
  return attempt(async () => {
    const user = await requireUser();
    const projectId = uuidField.parse(form.get("projectId"));
    await acceptProposal(user, projectId, uuidField.parse(form.get("proposalId")));
    revalidatePath("/projects");
    return page(projectId);
  });
}

export async function fundMilestoneAction(_: ActionState, form: FormData): Promise<ActionState> {
  return attempt(async () => {
    const user = await requireUser();
    const projectId = uuidField.parse(form.get("projectId"));
    const { redirectUrl } = await fundMilestone(user, uuidField.parse(form.get("milestoneId")));
    // With Paystack the poster pays on Paystack's checkout, which returns them here.
    return redirectUrl ?? page(projectId);
  });
}

export async function submitDeliveryAction(_: ActionState, form: FormData): Promise<ActionState> {
  return attempt(async () => {
    const user = await requireUser();
    const projectId = uuidField.parse(form.get("projectId"));
    const delivery = z
      .string()
      .trim()
      .min(10, "Describe or paste the delivery")
      .max(20_000)
      .parse(form.get("delivery") ?? "");
    await submitDelivery(
      createModelClient(user),
      user,
      uuidField.parse(form.get("milestoneId")),
      delivery,
    );
    return page(projectId);
  });
}

export async function requestMilestoneChangesAction(
  _: ActionState,
  form: FormData,
): Promise<ActionState> {
  return attempt(async () => {
    const user = await requireUser();
    const projectId = uuidField.parse(form.get("projectId"));
    const note = z
      .string()
      .trim()
      .min(5, "Say what should change")
      .max(2000)
      .parse(form.get("note") ?? "");
    await requestMilestoneChanges(user, uuidField.parse(form.get("milestoneId")), note);
    return page(projectId);
  });
}

export async function approveMilestoneAction(_: ActionState, form: FormData): Promise<ActionState> {
  return attempt(async () => {
    const user = await requireUser();
    const projectId = uuidField.parse(form.get("projectId"));
    await approveMilestone(createModelClient(user), user, uuidField.parse(form.get("milestoneId")));
    revalidatePath("/earnings");
    return page(projectId);
  });
}

const rateForm = z.object({
  projectId: uuidField,
  rating: z.coerce.number().int().min(1, "Choose a rating").max(5),
  review: z.string().max(1000).default(""),
});

export async function rateProjectAction(_: ActionState, form: FormData): Promise<ActionState> {
  return attempt(async () => {
    const user = await requireUser();
    const { projectId, rating, review } = rateForm.parse(Object.fromEntries(form));
    await rateProject(user, projectId, rating, review);
    return page(projectId);
  });
}

export async function disputeAction(_: ActionState, form: FormData): Promise<ActionState> {
  return attempt(async () => {
    const user = await requireUser();
    const projectId = uuidField.parse(form.get("projectId"));
    const reason = z
      .string()
      .trim()
      .min(10, "Explain what's wrong (10+ characters)")
      .max(2000)
      .parse(form.get("reason") ?? "");
    await raiseDispute(createModelClient(user), user, projectId, reason);
    return page(projectId);
  });
}

export async function resolveMilestoneAction(_: ActionState, form: FormData): Promise<ActionState> {
  return attempt(async () => {
    const user = await requireUser();
    const projectId = uuidField.parse(form.get("projectId"));
    const decision = z.enum(["release", "refund"]).parse(form.get("intent"));
    await resolveMilestone(
      createModelClient(user),
      user,
      uuidField.parse(form.get("milestoneId")),
      decision,
    );
    return page(projectId);
  });
}

export async function resumeProjectAction(_: ActionState, form: FormData): Promise<ActionState> {
  return attempt(async () => {
    const user = await requireUser();
    const projectId = uuidField.parse(form.get("projectId"));
    await resumeProject(user, projectId);
    return page(projectId);
  });
}

export async function cancelProjectAction(_: ActionState, form: FormData): Promise<ActionState> {
  return attempt(async () => {
    const user = await requireUser();
    const projectId = uuidField.parse(form.get("projectId"));
    await cancelProject(user, projectId);
    revalidatePath("/projects");
    return page(projectId);
  });
}
