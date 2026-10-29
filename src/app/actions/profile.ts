"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { attempt, uuidField, type ActionState } from "@/lib/action-state";
import { actorOf, requireUser } from "@/lib/auth/session";
import { portfolioInput, profileInput } from "@/lib/profile/rules";
import {
  addPortfolioItem,
  movePortfolioItem,
  myProfile,
  removePortfolioItem,
  saveProfile,
  updatePortfolioItem,
} from "@/lib/profile/service";

const PAGE = "/profile";
const text = (form: FormData, key: string) => String(form.get(key) ?? "");

/** Your public page changes too. */
async function refresh(userId: string) {
  revalidatePath(PAGE);
  revalidatePath(`/persunas/${(await myProfile(userId)).handle}`);
}

export async function saveProfileAction(_: ActionState, form: FormData): Promise<ActionState> {
  return attempt(async () => {
    const user = await requireUser();
    const input = profileInput.parse({
      publicName: text(form, "publicName"),
      headline: text(form, "headline"),
      bio: text(form, "bio"),
      location: text(form, "location"),
      website: text(form, "website"),
    });
    await saveProfile(user.id, input, actorOf(user));
    await refresh(user.id);
    return `${PAGE}?saved=profile`;
  });
}

const pieceFrom = (form: FormData) =>
  portfolioInput.parse({
    title: text(form, "title"),
    description: text(form, "description"),
    link: text(form, "link"),
    imageUrl: text(form, "imageUrl"),
    skill: text(form, "skill"),
  });

export async function savePortfolioItemAction(
  _: ActionState,
  form: FormData,
): Promise<ActionState> {
  return attempt(async () => {
    const user = await requireUser();
    const id = text(form, "itemId");
    if (id) await updatePortfolioItem(user.id, uuidField.parse(id), pieceFrom(form), actorOf(user));
    else await addPortfolioItem(user.id, pieceFrom(form), actorOf(user));
    await refresh(user.id);
    return `${PAGE}?saved=portfolio#portfolio`;
  });
}

export async function portfolioOrderAction(_: ActionState, form: FormData): Promise<ActionState> {
  return attempt(async () => {
    const user = await requireUser();
    const id = uuidField.parse(form.get("itemId"));
    const intent = z.enum(["up", "down", "remove"]).parse(form.get("intent"));
    if (intent === "remove") await removePortfolioItem(user.id, id, actorOf(user));
    else await movePortfolioItem(user.id, id, intent);
    await refresh(user.id);
    return `${PAGE}#portfolio`;
  });
}
