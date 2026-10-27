import { redirect, unstable_rethrow } from "next/navigation";
import { z } from "zod";

export type ActionState = { error: string | null };

export const slugField = z.string().regex(/^[a-z0-9-]+$/);
export const uuidField = z.uuid();

/**
 * Runs a server action's work and redirects to the path it returns. Failures
 * become a message for the form instead of a crash page.
 */
export async function attempt(work: () => Promise<string>): Promise<ActionState> {
  let destination: string;
  try {
    destination = await work();
  } catch (error) {
    unstable_rethrow(error); // sign-in redirects and not-found pass straight through
    console.error(error);
    if (error instanceof z.ZodError) return { error: error.issues[0]?.message ?? "Invalid input." };
    return { error: error instanceof Error ? error.message : "Something went wrong." };
  }
  // redirect() throws, so it must sit outside the try block.
  redirect(destination);
}

export function slugify(text: string): string {
  return text
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);
}
