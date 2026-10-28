"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { attempt, uuidField, type ActionState } from "@/lib/action-state";
import { assertJobOwner, ownedSkillById, ownedSkillBySlug } from "@/lib/auth/access";
import { requireUser } from "@/lib/auth/session";
import { readTaskInput } from "@/lib/docs/read-input";
import { createFileStore } from "@/lib/models/files";
import { createJob, reviewJob, setTrustLevel } from "@/lib/jobs/service";
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
    const job = await createJob(createModelClient(await requireUser()), {
      skillId,
      origin: "owner",
      requesterName: user.name,
      requesterUserId: user.id,
      input,
    });
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
