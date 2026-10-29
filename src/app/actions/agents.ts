"use server";

import { revalidatePath } from "next/cache";
import { after } from "next/server";
import { z } from "zod";
import { attempt, uuidField, type ActionState } from "@/lib/action-state";
import { MAX_BODY_BYTES } from "@/lib/agents/rules";
import {
  createAgentKey,
  processImport,
  publishAndList,
  receiveImport,
  retryImport,
  revokeAgentKey,
} from "@/lib/agents/service";
import { actorOf, requireUser } from "@/lib/auth/session";
import { dollarsField } from "@/lib/money";

const PAGE = "/skills/import";

const runLater = (id: string) =>
  after(async () => {
    await processImport(id).catch((e) => console.error("Agent import failed:", e));
  });

export interface KeyState {
  error: string | null;
  /** Shown once, right after the key is made. */
  token: string | null;
  agentName: string | null;
}

export async function createAgentKeyAction(_: KeyState, form: FormData): Promise<KeyState> {
  try {
    const user = await requireUser();
    const name = z
      .string()
      .trim()
      .min(2, "Name the agent (e.g. Grokbot)")
      .max(60)
      .parse(form.get("agentName") ?? "");
    const { key, token } = await createAgentKey(user, name, actorOf(user));
    revalidatePath(PAGE);
    return { error: null, token, agentName: key.agentName };
  } catch (error) {
    const message =
      error instanceof z.ZodError
        ? (error.issues[0]?.message ?? "Invalid name")
        : (error as Error).message;
    return { error: message, token: null, agentName: null };
  }
}

export async function revokeAgentKeyAction(_: ActionState, form: FormData): Promise<ActionState> {
  return attempt(async () => {
    const user = await requireUser();
    await revokeAgentKey(user.id, uuidField.parse(form.get("keyId")), actorOf(user));
    revalidatePath(PAGE);
    return PAGE;
  });
}

/** The manual route: upload the same JSON an agent would send. */
export async function uploadImportAction(_: ActionState, form: FormData): Promise<ActionState> {
  return attempt(async () => {
    const user = await requireUser();
    const file = form.get("file");
    if (!(file instanceof File) || file.size === 0) throw new Error("Choose a .json file");
    if (file.size > MAX_BODY_BYTES) throw new Error("That file is too large (1 MB at most)");
    let body: unknown;
    try {
      body = JSON.parse(await file.text());
    } catch {
      throw new Error("That file isn't valid JSON");
    }
    const result = await receiveImport({ userId: user.id, key: null, body });
    if (!result.ok) throw new Error(result.errors.join("; "));
    runLater(result.import.id);
    revalidatePath(PAGE);
    return PAGE;
  });
}

export async function retryImportAction(_: ActionState, form: FormData): Promise<ActionState> {
  return attempt(async () => {
    const user = await requireUser();
    const id = uuidField.parse(form.get("importId"));
    await retryImport(user.id, id, actorOf(user));
    runLater(id);
    revalidatePath(PAGE);
    return PAGE;
  });
}

const publishForm = z.object({
  importId: uuidField,
  price: dollarsField("Price", 100, 100_000_00),
  declareOwnership: z.literal("on", { error: "Confirm the method is yours to list" }),
});

export async function publishImportAction(_: ActionState, form: FormData): Promise<ActionState> {
  return attempt(async () => {
    const user = await requireUser();
    const { importId, price } = publishForm.parse(Object.fromEntries(form));
    const { slug } = await publishAndList(user.id, importId, {
      priceCents: price,
      declareOwnership: true,
    });
    revalidatePath(PAGE);
    revalidatePath("/market");
    return `/skills/${slug}/listing`;
  });
}
