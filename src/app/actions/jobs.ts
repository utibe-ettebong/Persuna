"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { attempt, uuidField, type ActionState } from "@/lib/action-state";
import { assertJobOwner, ownedSkillById, ownedSkillBySlug } from "@/lib/auth/access";
import { actorOf, requireUser } from "@/lib/auth/session";
import { readTaskInput } from "@/lib/docs/read-input";
import { createFileStore } from "@/lib/models/files";
import {
  decideJobApproval,
  draftJob,
  jobNeedsSetup,
  openJob,
  reviewJob,
  setTrustLevel,
  startJob,
} from "@/lib/jobs/service";
import { linkJobConnection, setJobToolPolicy, unlinkJobConnection } from "@/lib/jobs/tools";
import { createModelClient, createTranscriber } from "@/lib/models";
import { readAudio } from "@/lib/models/transcribe";
import { proposeCorrectionFromJob } from "@/lib/skill/service";

export async function createJobAction(_: ActionState, form: FormData): Promise<ActionState> {
  return attempt(async () => {
    const skillId = uuidField.parse(form.get("skillId"));
    const user = await requireUser();
    await ownedSkillById(user, skillId);
    // A voice note is transcribed and becomes the job's input.
    const audio = readAudio(form.get("audio"));
    const input = audio
      ? (await createTranscriber(await requireUser()).transcribe(audio, audio.name)).text
      : ((await readTaskInput(form.get("inputFile"), createModelClient(user), createFileStore())) ??
        String(form.get("inputText") ?? ""));
    if (!input.trim()) throw new Error("Paste the notes, upload a file or record a voice note.");
    const job = await openJob({
      skillId,
      origin: "owner",
      requesterName: user.name,
      requesterUserId: user.id,
      input,
    });
    // Tool skills wait for you to link your apps on the job page.
    if (!(await jobNeedsSetup(job.id))) {
      await draftJob(createModelClient(user), job.id);
    }
    revalidatePath("/jobs");
    return `/jobs/${job.id}`;
  });
}

const reviewForm = z.object({
  jobId: uuidField,
  intent: z.enum(["approve", "reject"]),
  finalOutput: z.string().max(200_000).optional(),
});

export async function reviewJobAction(_: ActionState, form: FormData): Promise<ActionState> {
  return attempt(async () => {
    const { jobId, intent, finalOutput } = reviewForm.parse(Object.fromEntries(form));
    await assertJobOwner(await requireUser(), jobId);
    await reviewJob(jobId, intent, finalOutput);
    revalidatePath("/jobs");
    revalidatePath("/earnings");
    return `/jobs/${jobId}`;
  });
}

export async function teachFromJobAction(_: ActionState, form: FormData): Promise<ActionState> {
  return attempt(async () => {
    const jobId = uuidField.parse(form.get("jobId"));
    await assertJobOwner(await requireUser(), jobId);
    const reason = z
      .string()
      .max(500)
      .parse(form.get("reason") ?? "");
    const correction = await proposeCorrectionFromJob(
      createModelClient(await requireUser()),
      jobId,
      reason,
    );
    return `/corrections/${correction.id}`;
  });
}

const jobPageForm = z.object({
  jobId: uuidField,
  page: z.enum(["job", "order"]),
});
const jobPageOf = (jobId: string, page: "job" | "order") =>
  page === "order" ? `/market/orders/${jobId}` : `/jobs/${jobId}`;

const linkForm = jobPageForm.extend({
  kind: z.enum(["app", "mcp"]),
  ref: z.string().trim().min(1).max(100),
});

export async function linkJobConnectionAction(
  _: ActionState,
  form: FormData,
): Promise<ActionState> {
  return attempt(async () => {
    const { jobId, page, kind, ref } = linkForm.parse(Object.fromEntries(form));
    const user = await requireUser();
    await linkJobConnection(jobId, user.id, { kind, ref }, actorOf(user));
    return jobPageOf(jobId, page);
  });
}

export async function unlinkJobConnectionAction(
  _: ActionState,
  form: FormData,
): Promise<ActionState> {
  return attempt(async () => {
    const { jobId, page, kind, ref } = linkForm.parse(Object.fromEntries(form));
    const user = await requireUser();
    await unlinkJobConnection(jobId, user.id, { kind, ref }, actorOf(user));
    return jobPageOf(jobId, page);
  });
}

const policyForm = jobPageForm.extend({
  mode: z.enum(["approve_each", "preapproved"]),
  tools: z.string().max(2000).default(""),
});

export async function setJobToolPolicyAction(_: ActionState, form: FormData): Promise<ActionState> {
  return attempt(async () => {
    const { jobId, page, mode, tools } = policyForm.parse(Object.fromEntries(form));
    const user = await requireUser();
    await setJobToolPolicy(
      jobId,
      user.id,
      {
        mode,
        tools: tools
          .split(",")
          .map((t) => t.trim())
          .filter(Boolean),
      },
      actorOf(user),
    );
    return jobPageOf(jobId, page);
  });
}

export async function startJobAction(_: ActionState, form: FormData): Promise<ActionState> {
  return attempt(async () => {
    const { jobId, page } = jobPageForm.parse(Object.fromEntries(form));
    const user = await requireUser();
    await startJob(createModelClient(user), jobId, user.id);
    revalidatePath("/jobs");
    revalidatePath("/dashboard");
    return jobPageOf(jobId, page);
  });
}

const decideForm = jobPageForm.extend({
  approvalId: uuidField,
  intent: z.enum(["approve", "deny"]),
});

export async function decideJobApprovalAction(
  _: ActionState,
  form: FormData,
): Promise<ActionState> {
  return attempt(async () => {
    const { jobId, page, approvalId, intent } = decideForm.parse(Object.fromEntries(form));
    const user = await requireUser();
    await decideJobApproval(createModelClient(user), jobId, {
      approvalId,
      approve: intent === "approve",
      userId: user.id,
      actor: actorOf(user),
    });
    revalidatePath("/jobs");
    revalidatePath("/dashboard");
    return jobPageOf(jobId, page);
  });
}

export async function setTrustLevelAction(_: ActionState, form: FormData): Promise<ActionState> {
  return attempt(async () => {
    const slug = z
      .string()
      .regex(/^[a-z0-9-]+$/)
      .parse(form.get("slug"));
    const level = z.coerce.number().int().min(0).max(2).parse(form.get("intent")) as 0 | 1 | 2;
    const skill = await ownedSkillBySlug(await requireUser(), slug);
    await setTrustLevel(skill.id, level);
    revalidatePath(`/skills/${slug}/trust`);
    return `/skills/${slug}/trust`;
  });
}
