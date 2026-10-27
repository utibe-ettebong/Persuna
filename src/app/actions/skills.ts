"use server";

import { revalidatePath } from "next/cache";
import { unstable_rethrow } from "next/navigation";
import { z } from "zod";
import { attempt, slugField, slugify, uuidField, type ActionState } from "@/lib/action-state";
import {
  assertCorrectionOwner,
  assertTestResultOwner,
  assertVersionOwner,
  ownedSkillBySlug,
} from "@/lib/auth/access";
import { actorOf, requireAdmin, requireUser } from "@/lib/auth/session";
import { readUploadedText } from "@/lib/docs/read-file";
import { normalizeText } from "@/lib/text";
import { createModelClient, createTranscriber } from "@/lib/models";
import { readAudio, transcriptionCheck } from "@/lib/models/transcribe";
import { INTERVIEW_QUESTIONS, interviewText, type InterviewAnswers } from "@/lib/skill/interview";
import type { Finding } from "@/lib/skill/redact";
import {
  acceptCorrection,
  addPair,
  createSampleSkill,
  proposeFromMethodNotes,
  saveInterview,
  scanPair,
  createSkill,
  deletePair,
  extractVersion,
  getCorrection,
  proposeCorrectionFromTest,
  publishVersion,
  rejectCorrection,
  runEval,
  saveEditedSheet,
  setCurrentVersion,
  setPairSplit,
} from "@/lib/skill/service";
import { skillSheet } from "@/lib/skill/types";

const newSkillForm = z.object({
  name: z.string().trim().min(3, "Give the task a name").max(120),
  taskDescription: z.string().trim().min(10, "Describe the task in a sentence or two").max(1000),
  inputType: z.string().trim().min(2, "Say what goes in").max(120),
  outputType: z.string().trim().min(2, "Say what comes out").max(120),
});

export async function createSkillAction(_: ActionState, form: FormData): Promise<ActionState> {
  return attempt(async () => {
    const input = newSkillForm.parse(Object.fromEntries(form));
    const slug = slugify(input.name);
    if (!slug) throw new Error("Use some letters or numbers in the name");
    const user = await requireUser();
    const skill = await createSkill({ ...input, slug }, user.id, actorOf(user));
    revalidatePath("/skills");
    return `/skills/${skill.slug}/examples`;
  });
}

export async function extractAction(_: ActionState, form: FormData): Promise<ActionState> {
  return attempt(async () => {
    const slug = slugField.parse(form.get("slug"));
    await ownedSkillBySlug(await requireUser(), slug);
    await extractVersion(createModelClient(await requireUser()), slug);
    revalidatePath(`/skills/${slug}`);
    return `/skills/${slug}`;
  });
}

export async function runTestsAction(_: ActionState, form: FormData): Promise<ActionState> {
  return attempt(async () => {
    const versionId = uuidField.parse(form.get("versionId"));
    await assertVersionOwner(await requireUser(), versionId);
    const run = await runEval(createModelClient(await requireUser()), versionId);
    return `/runs/${run.id}`;
  });
}

export async function makeCurrentAction(_: ActionState, form: FormData): Promise<ActionState> {
  return attempt(async () => {
    const slug = slugField.parse(form.get("slug"));
    const versionId = uuidField.parse(form.get("versionId"));
    const skill = await ownedSkillBySlug(await requireUser(), slug);
    await setCurrentVersion(skill.id, versionId);
    revalidatePath(`/skills/${slug}`);
    return `/skills/${slug}`;
  });
}

export async function publishAction(_: ActionState, form: FormData): Promise<ActionState> {
  return attempt(async () => {
    const slug = slugField.parse(form.get("slug"));
    const versionId = uuidField.parse(form.get("versionId"));
    const skill = await ownedSkillBySlug(await requireUser(), slug);
    await publishVersion(skill.id, versionId, form.get("confirmLower") === "on");
    revalidatePath(`/skills/${slug}`);
    return `/skills/${slug}`;
  });
}

export async function saveRulesAction(_: ActionState, form: FormData): Promise<ActionState> {
  return attempt(async () => {
    const slug = slugField.parse(form.get("slug"));
    const raw = JSON.parse(String(form.get("sheet") ?? "{}"));
    const sheet = skillSheet.parse(raw);
    const skill = await ownedSkillBySlug(await requireUser(), slug);
    await saveEditedSheet(skill.id, sheet);
    revalidatePath(`/skills/${slug}`);
    return `/skills/${slug}`;
  });
}

const correctionForm = z.object({
  resultId: uuidField,
  edited: z.string().trim().min(1, "Paste or write your corrected version."),
  reason: z.string().max(500).default(""),
});

export async function proposeFromTestAction(_: ActionState, form: FormData): Promise<ActionState> {
  return attempt(async () => {
    const { resultId, edited, reason } = correctionForm.parse(Object.fromEntries(form));
    await assertTestResultOwner(await requireUser(), resultId);
    const correction = await proposeCorrectionFromTest(
      createModelClient(await requireUser()),
      resultId,
      edited,
      reason,
    );
    return `/corrections/${correction.id}`;
  });
}

export async function decideCorrectionAction(_: ActionState, form: FormData): Promise<ActionState> {
  return attempt(async () => {
    const id = uuidField.parse(form.get("correctionId"));
    await assertCorrectionOwner(await requireUser(), id);
    const { skill } = await getCorrection(id);
    if (form.get("intent") === "reject") {
      await rejectCorrection(id);
      revalidatePath(`/skills/${skill.slug}`);
      return `/skills/${skill.slug}`;
    }
    const version = await acceptCorrection(id);
    const run = await runEval(createModelClient(await requireUser()), version.id);
    return `/runs/${run.id}`;
  });
}

/* ---------- Example pairs ---------- */

export type PairFormState = {
  error: string | null;
  review?: {
    slug: string;
    split: "train" | "test";
    input: string;
    output: string;
    redactedInput: string;
    redactedOutput: string;
    inputFindings: Finding[];
    outputFindings: Finding[];
  };
  saved?: string;
};

const pairForm = z.object({
  skillSlug: slugField,
  name: z.string().trim().max(80).optional(),
  split: z.enum(["train", "test"]),
});

/**
 * Two-step save. First submit: read pasted text or uploaded files and scan for
 * identifiers. If anything is found, return it for the owner to review. The
 * second submit carries the owner's choice (redacted or as written).
 */
export async function addPairAction(_: PairFormState, form: FormData): Promise<PairFormState> {
  try {
    const { skillSlug, name, split } = pairForm.parse(Object.fromEntries(form));
    const skill = await ownedSkillBySlug(await requireUser(), skillSlug);
    const choice = form.get("choice");

    let input: string;
    let output: string;
    if (choice === "redacted" || choice === "original") {
      input = String(form.get(choice === "redacted" ? "redactedInput" : "input") ?? "");
      output = String(form.get(choice === "redacted" ? "redactedOutput" : "output") ?? "");
    } else {
      input =
        (await readUploadedText(form.get("inputFile"))) ?? String(form.get("inputText") ?? "");
      output =
        (await readUploadedText(form.get("outputFile"))) ?? String(form.get("outputText") ?? "");
    }
    input = normalizeText(input);
    output = normalizeText(output);
    if (!input || !output) return { error: "Add both the raw input and your finished output." };

    if (!choice) {
      const scan = await scanPair(createModelClient(await requireUser()), input, output);
      if (scan.inputFindings.length || scan.outputFindings.length) {
        return {
          error: null,
          review: {
            // Name the pair from the redacted text, so a name never ends up in the slug.
            slug: slugify(name || scan.redactedInput.split("\n")[0] || "pair") || "pair",
            split,
            input,
            output,
            ...scan,
          },
        };
      }
    }

    const slug = slugify(name || input.split("\n")[0] || "pair") || "pair";
    await addPair(skill.id, { slug, split, input, output, redacted: choice === "redacted" });
    revalidatePath(`/skills/${skillSlug}/examples`);
    revalidatePath(`/skills/${skillSlug}`);
    return { error: null, saved: slug };
  } catch (error) {
    unstable_rethrow(error);
    console.error(error);
    if (error instanceof z.ZodError) return { error: error.issues[0]?.message ?? "Invalid input." };
    return { error: error instanceof Error ? error.message : "Something went wrong." };
  }
}

export async function updatePairAction(_: ActionState, form: FormData): Promise<ActionState> {
  return attempt(async () => {
    const slug = slugField.parse(form.get("skillSlug"));
    const exampleId = uuidField.parse(form.get("exampleId"));
    const skill = await ownedSkillBySlug(await requireUser(), slug);
    const intent = form.get("intent");
    if (intent === "delete") await deletePair(skill.id, exampleId);
    else await setPairSplit(skill.id, exampleId, intent === "test" ? "test" : "train");
    revalidatePath(`/skills/${slug}/examples`);
    return `/skills/${slug}/examples`;
  });
}

/* ---------- Interview and voice ---------- */

export async function saveInterviewAction(_: ActionState, form: FormData): Promise<ActionState> {
  return attempt(async () => {
    const slug = slugField.parse(form.get("slug"));
    const skill = await ownedSkillBySlug(await requireUser(), slug);
    const answers = Object.fromEntries(
      INTERVIEW_QUESTIONS.map((q) => [
        q.key,
        z
          .string()
          .max(4000)
          .parse(form.get(q.key) ?? ""),
      ]),
    ) as InterviewAnswers;
    await saveInterview(skill.id, answers);
    if (form.get("intent") === "propose") {
      const notes = interviewText(answers);
      if (!notes) throw new Error("Answer at least one question first");
      const proposal = await proposeFromMethodNotes(
        createModelClient(await requireUser()),
        skill.id,
        "interview",
        notes,
      );
      return `/corrections/${proposal.id}`;
    }
    revalidatePath(`/skills/${slug}/interview`);
    return `/skills/${slug}/interview?saved=1`;
  });
}

/**
 * Voice walkthrough: the owner talks through how they do the task. The
 * transcript becomes proposed rule changes, or, before any rules exist, is
 * added to the interview so extraction uses it.
 */
export async function voiceWalkthroughAction(_: ActionState, form: FormData): Promise<ActionState> {
  return attempt(async () => {
    const slug = slugField.parse(form.get("slug"));
    const skill = await ownedSkillBySlug(await requireUser(), slug);
    const audio = readAudio(form.get("audio"));
    if (!audio) throw new Error("Record or upload your walkthrough first");
    const { text } = await createTranscriber(await requireUser()).transcribe(audio, audio.name);
    if (!text) throw new Error("No speech was found in the recording");

    if (!skill.currentVersionId) {
      const answers = { ...(skill.interview ?? {}) };
      answers.steps = [answers.steps, text].filter(Boolean).join("\n\n");
      await saveInterview(skill.id, answers);
      revalidatePath(`/skills/${slug}/interview`);
      return `/skills/${slug}/interview?transcribed=1`;
    }
    const proposal = await proposeFromMethodNotes(
      createModelClient(await requireUser()),
      skill.id,
      "walkthrough",
      text,
    );
    return `/corrections/${proposal.id}`;
  });
}

/** One click for new users: their own copy of the sample skill, ready to extract. */
export async function trySampleSkillAction(): Promise<ActionState> {
  return attempt(async () => {
    const user = await requireUser();
    const skill = await createSampleSkill(user.id, actorOf(user));
    revalidatePath("/skills");
    return `/skills/${skill.slug}?sample=1`;
  });
}

export type ModelCheckState = {
  error: string | null;
  results?: { role: string; ok: boolean; ms: number; detail: string }[];
};

/** Admins: send each live model role a tiny request and report what came back. */
export async function testModelsAction(): Promise<ModelCheckState> {
  try {
    await requireAdmin();
    const client = createModelClient();
    const roles = ["extract", "draft", "evaluate"] as const;
    const results = await Promise.all(
      roles.map(async (role) => {
        const started = Date.now();
        try {
          const reply = await client.complete(
            role,
            [{ role: "user", content: "Reply with the single word OK." }],
            { maxTokens: 20 },
          );
          return {
            role,
            ok: reply.text.trim().length > 0,
            ms: Date.now() - started,
            detail: `${reply.model}: “${reply.text.trim().slice(0, 40)}”`,
          };
        } catch (error) {
          return {
            role,
            ok: false,
            ms: Date.now() - started,
            detail: (error as Error).message.slice(0, 300),
          };
        }
      }),
    );
    const voice = transcriptionCheck();
    return { error: null, results: [...results, { role: "transcribe", ms: 0, ...voice }] };
  } catch (error) {
    unstable_rethrow(error);
    return { error: error instanceof Error ? error.message : "Check failed" };
  }
}
