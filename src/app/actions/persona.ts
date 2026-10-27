"use server";

import { revalidatePath } from "next/cache";
import { unstable_rethrow } from "next/navigation";
import { z } from "zod";
import { uuidField } from "@/lib/action-state";
import { actorOf, requireUser } from "@/lib/auth/session";
import { createModelClient, createTranscriber } from "@/lib/models";
import { readAudio } from "@/lib/models/transcribe";
import {
  AVATARS,
  addNote,
  chat,
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

export async function personaChatAction(text: string, day: string) {
  return run(async () => {
    const user = await requireUser();
    const message = z.string().trim().min(1, "Say something first").max(4000).parse(text);
    return chat(createModelClient(user), user.id, {
      text: message,
      day: dayField.parse(day),
      actor: actorOf(user),
    });
  });
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
  name: z.string().trim().min(1, "Give your Persona a name").max(40).optional(),
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
