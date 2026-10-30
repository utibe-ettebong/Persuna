"use server";

import { revalidatePath } from "next/cache";
import { unstable_rethrow } from "next/navigation";
import { z } from "zod";
import { slugField, uuidField } from "@/lib/action-state";
import { readTaskInput } from "@/lib/docs/read-input";
import { createFileStore } from "@/lib/models/files";
import { actorOf, requireUser } from "@/lib/auth/session";
import { createModelClient, createTranscriber } from "@/lib/models";
import { ModelError } from "@/lib/models/gateway";
import { sceneSchema } from "@/lib/persuna/scene";
import {
  FRAME_TYPES,
  MAX_FRAME_CHARS,
  clockField,
  dayField,
  screenField,
  sightField,
} from "@/lib/persuna/fields";
import { MAX_FIRST_SKILLS } from "@/lib/persuna/onboarding";
import { readAudio } from "@/lib/models/transcribe";
import { takeTurns } from "@/lib/persuna/voice-agent";
import { PROVIDER_IDS } from "@/lib/connections/providers";
import { disconnect } from "@/lib/connections/service";
import { connectMcpServer, disconnectMcpServer, refreshMcpTools } from "@/lib/mcp/service";
import { confirmMcpFromChat } from "@/lib/persuna/service";
import {
  AVATARS,
  addExampleFromChat,
  addNote,
  addReminder,
  publishFromChat,
  addTodo,
  chat,
  chatFromVoice,
  confirmAppFromChat,
  saveIntro,
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
  workLook,
  teachFromNote,
  updateProfile,
} from "@/lib/persuna/service";

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
    // A model provider's own wording ("[extract model] HTTP 404 …") means nothing to the user.
    if (error instanceof ModelError)
      return {
        ok: false,
        error: "I couldn't reach my model just now. Give me a moment and try again.",
      };
    return { ok: false, error: error instanceof Error ? error.message : "Something went wrong." };
  }
}

/** Pictures handed to Persuna are looked at as they are; other files are read into text. */
const PICTURE_FILE = /\.(png|jpe?g|webp|gif)$/i;
const MAX_PICTURE_BYTES = 8 * 1024 * 1024;
/** Enough of a long document for one turn. */
const MAX_FILE_CHARS = 24_000;

/**
 * A message with a file (a picture, PDF, Word document or text file) dropped
 * on Persuna or chosen in its panel. The file is read for this turn only; just
 * its name is kept in the conversation.
 */
export async function persunaFileAction(form: FormData, clock: z.input<typeof clockField>) {
  return run(async () => {
    const user = await requireUser();
    const upload = form.get("file");
    if (!(upload instanceof File) || upload.size === 0) throw new Error("Choose a file first");
    const said = z
      .string()
      .trim()
      .max(4000)
      .parse(form.get("text") ?? "");
    const client = createModelClient(user);
    let file: { name: string; text: string | null; image: string | null };
    if (PICTURE_FILE.test(upload.name)) {
      if (upload.size > MAX_PICTURE_BYTES) throw new Error(`${upload.name} is larger than 8 MB`);
      const type = upload.type && upload.type.startsWith("image/") ? upload.type : "image/png";
      const data = Buffer.from(await upload.arrayBuffer()).toString("base64");
      file = { name: upload.name, text: null, image: `data:${type};base64,${data}` };
    } else {
      const text = await readTaskInput(upload, client, createFileStore());
      if (!text) throw new Error(`Nothing readable in ${upload.name}`);
      file = { name: upload.name, text: text.slice(0, MAX_FILE_CHARS), image: null };
    }
    return chat(client, user.id, {
      text: said || `Here's ${upload.name}. What's in it?`,
      clock: clockField.parse(clock),
      actor: actorOf(user),
      file,
    });
  });
}

const workField = z.object({
  scene: sceneSchema,
  image: screenField,
  trail: z.array(z.string().max(300)).max(8).default([]),
  mayInterrupt: z.boolean(),
  pointer: z.object({ x: z.number(), y: z.number(), still: z.number().min(0).max(3600) }).nullish(),
});

/** Work mode: one look at what you're doing, and whether Persuna should step in. */
export async function persunaWorkAction(
  input: z.input<typeof workField>,
  clock: z.input<typeof clockField>,
) {
  return run(async () => {
    const user = await requireUser();
    const look = workField.parse(input);
    return workLook(createModelClient(user), user.id, {
      clock: clockField.parse(clock),
      scene: look.scene,
      image: look.image ?? null,
      trail: look.trail,
      mayInterrupt: look.mayInterrupt,
      pointer: look.pointer ?? null,
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
    z.object({
      kind: z.literal("many"),
      skills: z
        .array(
          z.object({
            name: z.string().trim().min(3, "Name each task").max(120),
            description: z.string().trim().max(1000).optional(),
          }),
        )
        .min(1, "Pick at least one")
        .max(MAX_FIRST_SKILLS, `Pick up to ${MAX_FIRST_SKILLS} for now`),
    }),
    z.object({ kind: z.literal("skip") }),
  ]),
});

export async function persunaSetupAction(input: z.input<typeof setupForm>) {
  return run(async () => {
    const user = await requireUser();
    const parsed = setupForm.parse(input);
    const result = await completeSetup(user.id, { ...parsed, actor: actorOf(user) });
    revalidatePath("/", "layout");
    return result;
  });
}

/** Runs a published skill from the chat on pasted text or an uploaded file. */
export async function persunaRunTaskAction(form: FormData) {
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

export async function persunaJobAction(jobId: string) {
  return run(async () => {
    const user = await requireUser();
    return jobForChat(user.id, uuidField.parse(jobId));
  });
}

export async function persunaReviewJobAction(
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
export async function persunaPulseAction(clock: z.input<typeof clockField>, path: string) {
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

export async function persunaToneAction(tone: z.input<typeof toneForm>) {
  return run(async () => {
    const user = await requireUser();
    await setTone(user.id, toneForm.parse(tone));
    revalidatePath("/persuna");
    return true;
  });
}

export async function reminderDoneAction(form: FormData) {
  const user = await requireUser();
  await setReminderDone(user.id, uuidField.parse(form.get("id")), form.get("done") === "true");
  revalidatePath("/persuna");
}

export async function deleteReminderAction(form: FormData) {
  const user = await requireUser();
  await deleteReminder(user.id, uuidField.parse(form.get("id")));
  revalidatePath("/persuna");
}

const fastField = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("reminder"),
    text: z.string().trim().min(1).max(300),
    dueIso: z.string().datetime(),
  }),
  z.object({ kind: z.literal("todo"), text: z.string().trim().min(1).max(300) }),
  z.object({
    kind: z.literal("note"),
    title: z.string().trim().min(1).max(100),
    body: z.string().trim().min(1).max(4000),
  }),
]);

/**
 * The companion's fast path: a reminder, to-do or note it recognized itself,
 * saved without a model call. Returns where to see it.
 */
export async function persunaFastAction(intent: z.input<typeof fastField>) {
  return run(async () => {
    const user = await requireUser();
    const parsed = fastField.parse(intent);
    if (parsed.kind === "note") {
      await addNote(user.id, { title: parsed.title, body: parsed.body });
      revalidatePath("/persuna");
      return { link: { href: "/persuna#notes", label: "See your notes" } };
    }
    if (parsed.kind === "reminder") {
      const due = new Date(parsed.dueIso);
      await addReminder(user.id, {
        text: parsed.text,
        due: due.getTime() > Date.now() ? due : null,
      });
    } else {
      await addTodo(user.id, parsed.text);
    }
    revalidatePath("/persuna");
    return { link: { href: "/persuna#todos", label: "See your to-dos" } };
  });
}

export async function addTodoAction(_: { error: string | null }, form: FormData) {
  const result = await run(async () => {
    const user = await requireUser();
    await addTodo(
      user.id,
      z.string().trim().min(1, "Write the to-do").max(300).parse(form.get("text")),
    );
    revalidatePath("/persuna");
    return true;
  });
  return { error: result.ok ? null : result.error };
}

export async function persunaCheckInAction(day: string) {
  return run(async () => {
    const user = await requireUser();
    return checkIn(user.id, dayField.parse(day));
  });
}

/** Speech to text for the companion's mic button. The audio isn't kept. */
/** What the last spoken turns (through ElevenLabs Agents) set up on screen. */
export async function persunaAgentTurnsAction() {
  return run(async () => {
    const user = await requireUser();
    return takeTurns(user.id);
  });
}

/** Something said out loud to Persuna: heard (or transcribed) and answered in one go. */
export async function persunaVoiceAction(form: FormData, clock: z.input<typeof clockField>) {
  return run(async () => {
    const user = await requireUser();
    const audio = readAudio(form.get("audio"));
    if (!audio) throw new Error("Nothing was recorded");
    const image = form.get("screen");
    const scene = form.get("scene");
    return chatFromVoice(createModelClient(user), createTranscriber(user), user.id, {
      audio,
      clock: clockField.parse(clock),
      actor: actorOf(user),
      sight: sightField.parse({
        image: typeof image === "string" ? image : null,
        scene: typeof scene === "string" ? JSON.parse(scene) : null,
        circled: form.get("circled") === "1",
      }),
    });
  });
}

export async function persunaTranscribeAction(form: FormData) {
  return run(async () => {
    const user = await requireUser();
    const audio = readAudio(form.get("audio"));
    if (!audio) throw new Error("Nothing was recorded");
    return (await createTranscriber(user).transcribe(audio, audio.name)).text;
  });
}

export async function persunaObserveAction(frame: string, noteId: string | null) {
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

export async function persunaTeachNoteAction(noteId: string) {
  return run(async () => {
    const user = await requireUser();
    const link = await teachFromNote(
      createModelClient(user),
      user.id,
      uuidField.parse(noteId),
      actorOf(user),
    );
    revalidatePath("/persuna");
    return link;
  });
}

const profileForm = z.object({
  name: z.string().trim().min(1, "Give your Persuna a name").max(40).optional(),
  avatar: z.enum(AVATARS).optional(),
  focus: z.string().trim().max(200).nullable().optional(),
});

export async function persunaProfileAction(input: z.input<typeof profileForm>) {
  return run(async () => {
    const user = await requireUser();
    const parsed = profileForm.parse(input);
    await updateProfile(user.id, { ...parsed, focus: parsed.focus === "" ? null : parsed.focus });
    revalidatePath("/persuna");
    return true;
  });
}

export async function persunaForgetAction(index: number) {
  return run(async () => {
    const user = await requireUser();
    await forgetFact(user.id, z.number().int().min(0).parse(index));
    revalidatePath("/persuna");
    return true;
  });
}

export async function persunaClearChatAction() {
  return run(async () => {
    const user = await requireUser();
    await clearConversation(user.id);
    return true;
  });
}

export async function deleteNoteAction(form: FormData) {
  const user = await requireUser();
  await deleteNote(user.id, uuidField.parse(form.get("noteId")));
  revalidatePath("/persuna");
}

const noteForm = z.object({
  title: z.string().trim().min(1, "Give the note a title").max(100),
  body: z.string().trim().min(1, "Write something").max(4000),
});

export async function addNoteAction(_: { error: string | null }, form: FormData) {
  const result = await run(async () => {
    const user = await requireUser();
    await addNote(user.id, noteForm.parse(Object.fromEntries(form)));
    revalidatePath("/persuna");
    return true;
  });
  return { error: result.ok ? null : result.error };
}

/** An example given to Persuna through its card: text, or files (PDFs, scans and photos too). */
export async function persunaAddExampleAction(form: FormData) {
  return run(async () => {
    const user = await requireUser();
    const client = createModelClient(user);
    const files = createFileStore();
    const before =
      (await readTaskInput(form.get("beforeFile"), client, files)) ??
      String(form.get("before") ?? "");
    const after =
      (await readTaskInput(form.get("afterFile"), client, files)) ??
      String(form.get("after") ?? "");
    const test = form.get("test");
    const result = await addExampleFromChat(client, user.id, {
      slug: slugField.parse(form.get("skill")),
      before: z.string().max(100_000).parse(before),
      after: z.string().max(100_000).parse(after),
      test: test === "on" ? true : test === "off" ? false : null,
      actor: actorOf(user),
    });
    revalidatePath("/skills");
    return result;
  });
}

/** Publishing, after the user confirmed it in the chat. */
export async function persunaPublishAction(slug: string, versionId: string, confirmLower: boolean) {
  return run(async () => {
    const user = await requireUser();
    const result = await publishFromChat(user.id, {
      slug: slugField.parse(slug),
      versionId: uuidField.parse(versionId),
      confirmLower: z.boolean().parse(confirmLower),
    });
    revalidatePath("/skills");
    return result;
  });
}

/** The user OK'd sending or creating something in one of their apps. */
export async function persunaAppConfirmAction(token: string) {
  return run(async () => {
    const user = await requireUser();
    return confirmAppFromChat(user.id, z.string().min(10).max(20_000).parse(token), actorOf(user));
  });
}

/** The user OK'd a proposed MCP tool call on one of their servers. */
export async function persunaMcpConfirmAction(token: string) {
  return run(async () => {
    const user = await requireUser();
    return confirmMcpFromChat(user.id, z.string().min(10).max(20_000).parse(token), actorOf(user));
  });
}

const mcpServerForm = z.object({
  name: z.string().trim().min(1).max(80),
  url: z.string().trim().url().max(500),
  token: z.string().trim().max(2000).optional(),
});

/** Connects a remote MCP server: tools are discovered before it is stored. */
export async function connectMcpServerAction(input: z.input<typeof mcpServerForm>) {
  return run(async () => {
    const user = await requireUser();
    const server = await connectMcpServer(user.id, mcpServerForm.parse(input), actorOf(user));
    revalidatePath("/persuna");
    return server;
  });
}

export async function disconnectMcpServerAction(serverId: string) {
  return run(async () => {
    const user = await requireUser();
    await disconnectMcpServer(user.id, uuidField.parse(serverId), actorOf(user));
    revalidatePath("/persuna");
  });
}

export async function refreshMcpServerAction(serverId: string) {
  return run(async () => {
    const user = await requireUser();
    const tools = await refreshMcpTools(user.id, uuidField.parse(serverId));
    revalidatePath("/persuna");
    return tools;
  });
}

export async function disconnectAppAction(provider: string) {
  return run(async () => {
    const user = await requireUser();
    await disconnect(user.id, z.enum(PROVIDER_IDS).parse(provider), actorOf(user));
    revalidatePath("/persuna");
  });
}

const introForm = z.object({
  work: z.string().trim().max(1000).optional(),
  current: z.string().trim().max(1000).optional(),
  timeSink: z.string().trim().max(1000).optional(),
  style: z.string().trim().max(1000).optional(),
});

/** Persuna Desktop's "get to know you" answers. */
export async function persunaIntroAction(answers: z.input<typeof introForm>) {
  return run(async () => {
    const user = await requireUser();
    return saveIntro(user.id, introForm.parse(answers));
  });
}
