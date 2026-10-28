"use server";

import { revalidatePath } from "next/cache";
import { unstable_rethrow } from "next/navigation";
import { z } from "zod";
import { slugField, uuidField } from "@/lib/action-state";
import { readTaskInput } from "@/lib/docs/read-input";
import { createFileStore } from "@/lib/models/files";
import { actorOf, requireUser } from "@/lib/auth/session";
import { createModelClient, createTranscriber } from "@/lib/models";
import { readAudio } from "@/lib/models/transcribe";
import {
  AVATARS,
  addNote,
  addTodo,
  chat,
  completeSetup,
  deleteReminder,
  jobForChat,
  reviewFromChat,
  runTask,
  pulse,
  setReminderDone,
  setTone,
  checkIn,
  clearConversation,
  deleteNote,
  forgetFact,
  observe,
  teachFromNote,
  updateProfile,
} from "@/lib/persona/service";

/** Companion actions are called from client code and return data, not redirects. */
export type Result<T> = { ok: true; value: T } | { ok: false; error: string };

async function run<T>(work: () => Promise<T>): Promise<Result<T>> {
  try {
    return { ok: true, value: await work() };
  } catch (error) {
    unstable_rethrow(error);
    console.error(error);
    if (error instanceof z.ZodError)
      return { ok: false, error: error.issues[0]?.message ?? "Invalid input." };
    return { ok: false, error: error instanceof Error ? error.message : "Something went wrong." };
  }
}

const dayField = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const FRAME_TYPES = /^data:image\/(jpeg|png|webp);base64,/;
/** About 1.5 MB of image once decoded. */
const MAX_FRAME_CHARS = 2_000_000;

const clockField = z.object({
  day: dayField,
  now: z.string().regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/),
  offset: z.number().int().min(-900).max(900),
});

export async function personaChatAction(text: string, clock: z.input<typeof clockField>) {
  return run(async () => {
    const user = await requireUser();
    const message = z.string().trim().min(1, "Say something first").max(4000).parse(text);
    return chat(createModelClient(user), user.id, {
      text: message,
      clock: clockField.parse(clock),
      actor: actorOf(user),
    });
  });
}

const setupForm = z.object({
  name: z.string().trim().min(1, "Give your Persuna a name").max(40),
  avatar: z.enum(AVATARS),
  task: z.discriminatedUnion("kind", [
    z.object({ kind: z.literal("existing"), slug: slugField }),
    z.object({ kind: z.literal("sample") }),
    z.object({
      kind: z.literal("new"),
      name: z.string().trim().min(3, "Name the task").max(120),
      description: z.string().trim().min(10, "Describe the task in a sentence").max(1000),
    }),
    z.object({ kind: z.literal("skip") }),
  ]),
});

export async function personaSetupAction(input: z.input<typeof setupForm>) {
  return run(async () => {
    const user = await requireUser();
    const parsed = setupForm.parse(input);
    const result = await completeSetup(user.id, { ...parsed, actor: actorOf(user) });
    revalidatePath("/", "layout");
    return result;
  });
}

/** Runs a published skill from the chat on pasted text or an uploaded file. */
export async function personaRunTaskAction(form: FormData) {
  return run(async () => {
    const user = await requireUser();
    const slug = slugField.parse(form.get("skill"));
    const text =
      (await readTaskInput(form.get("file"), createModelClient(user), createFileStore())) ??
      String(form.get("text") ?? "");
    if (!text.trim()) throw new Error("Paste the input or upload a file first.");
    if (text.length > 100_000) throw new Error("That's too long for one task.");
    const result = await runTask(createModelClient(user), user, { slug, text });
    revalidatePath("/jobs");
    return result;
  });
}

export async function personaJobAction(jobId: string) {
  return run(async () => {
    const user = await requireUser();
    return jobForChat(user.id, uuidField.parse(jobId));
  });
}

export async function personaReviewJobAction(
  jobId: string,
  decision: "approve" | "reject",
  finalOutput?: string,
) {
  return run(async () => {
    const user = await requireUser();
    const job = await reviewFromChat(
      user.id,
      uuidField.parse(jobId),
      z.enum(["approve", "reject"]).parse(decision),
      finalOutput === undefined ? undefined : z.string().max(200_000).parse(finalOutput),
    );
    revalidatePath("/jobs");
    return job;
  });
}

/**
 * The companion's heartbeat: reminders that came due and anything worth
 * speaking up about. `path` is the page the user is on.
 */
export async function personaPulseAction(clock: z.input<typeof clockField>, path: string) {
  return run(async () => {
    const user = await requireUser();
    return pulse(user.id, {
      clock: clockField.parse(clock),
      path: z.string().max(300).parse(path),
    });
  });
}

const toneForm = z.object({
  length: z.enum(["short", "normal", "detailed"]).optional(),
  formality: z.enum(["casual", "neutral", "formal"]).optional(),
  playful: z.boolean().optional(),
  notes: z.array(z.string().trim().min(1).max(160)).max(6).optional(),
});

export async function personaToneAction(tone: z.input<typeof toneForm>) {
  return run(async () => {
    const user = await requireUser();
    await setTone(user.id, toneForm.parse(tone));
    revalidatePath("/persona");
    return true;
  });
}

export async function reminderDoneAction(form: FormData) {
  const user = await requireUser();
  await setReminderDone(user.id, uuidField.parse(form.get("id")), form.get("done") === "true");
  revalidatePath("/persona");
}

export async function deleteReminderAction(form: FormData) {
  const user = await requireUser();
  await deleteReminder(user.id, uuidField.parse(form.get("id")));
  revalidatePath("/persona");
}

export async function addTodoAction(_: { error: string | null }, form: FormData) {
  const result = await run(async () => {
    const user = await requireUser();
    await addTodo(
      user.id,
      z.string().trim().min(1, "Write the to-do").max(300).parse(form.get("text")),
    );
    revalidatePath("/persona");
    return true;
  });
  return { error: result.ok ? null : result.error };
}

export async function personaCheckInAction(day: string) {
  return run(async () => {
    const user = await requireUser();
    return checkIn(user.id, dayField.parse(day));
  });
}

/** Speech to text for the companion's mic button. The audio isn't kept. */
export async function personaTranscribeAction(form: FormData) {
  return run(async () => {
    const user = await requireUser();
    const audio = readAudio(form.get("audio"));
    if (!audio) throw new Error("Nothing was recorded");
    return (await createTranscriber(user).transcribe(audio, audio.name)).text;
  });
}

export async function personaObserveAction(frame: string, noteId: string | null) {
  return run(async () => {
    const user = await requireUser();
    if (!FRAME_TYPES.test(frame) || frame.length > MAX_FRAME_CHARS) {
      throw new Error("That screen frame couldn't be read");
    }
    return observe(createModelClient(user), user.id, {
      frame,
      noteId: noteId ? uuidField.parse(noteId) : null,
    });
  });
}

export async function personaTeachNoteAction(noteId: string) {
  return run(async () => {
    const user = await requireUser();
    const link = await teachFromNote(
      createModelClient(user),
      user.id,
      uuidField.parse(noteId),
      actorOf(user),
    );
    revalidatePath("/persona");
    return link;
  });
}

const profileForm = z.object({
  name: z.string().trim().min(1, "Give your Persuna a name").max(40).optional(),
  avatar: z.enum(AVATARS).optional(),
  focus: z.string().trim().max(200).nullable().optional(),
});

export async function personaProfileAction(input: z.input<typeof profileForm>) {
  return run(async () => {
    const user = await requireUser();
    const parsed = profileForm.parse(input);
    await updateProfile(user.id, { ...parsed, focus: parsed.focus === "" ? null : parsed.focus });
    revalidatePath("/persona");
    return true;
  });
}

export async function personaForgetAction(index: number) {
  return run(async () => {
    const user = await requireUser();
    await forgetFact(user.id, z.number().int().min(0).parse(index));
    revalidatePath("/persona");
    return true;
  });
}

export async function personaClearChatAction() {
  return run(async () => {
    const user = await requireUser();
    await clearConversation(user.id);
    return true;
  });
}

export async function deleteNoteAction(form: FormData) {
  const user = await requireUser();
  await deleteNote(user.id, uuidField.parse(form.get("noteId")));
  revalidatePath("/persona");
}

const noteForm = z.object({
  title: z.string().trim().min(1, "Give the note a title").max(100),
  body: z.string().trim().min(1, "Write something").max(4000),
});

export async function addNoteAction(_: { error: string | null }, form: FormData) {
  const result = await run(async () => {
    const user = await requireUser();
    await addNote(user.id, noteForm.parse(Object.fromEntries(form)));
    revalidatePath("/persona");
    return true;
  });
  return { error: result.ok ? null : result.error };
}
