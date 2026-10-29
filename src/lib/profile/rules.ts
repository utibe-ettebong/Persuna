/**
 * What a public profile and its portfolio may hold. Pure, so the pages, the
 * actions and the tests agree: short plain text, and links only over https.
 */
import { z } from "zod";

/** Most portfolio pieces one person shows. */
export const MAX_PORTFOLIO = 24;

/** An https address, cleaned up; anything else (javascript:, data:, http:) is refused. */
export function safeUrl(value: string): string {
  const text = value.trim();
  let url: URL;
  try {
    url = new URL(/^[a-z][a-z0-9+.-]*:/i.test(text) ? text : `https://${text}`);
  } catch {
    throw new Error("That isn't a web address");
  }
  if (url.protocol !== "https:") throw new Error("Use an https:// address");
  if (!url.hostname.includes(".")) throw new Error("That isn't a web address");
  return url.toString();
}

const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .transform((v) => v || null);

const optionalUrl = z
  .string()
  .trim()
  .max(500)
  .transform((v, ctx) => {
    if (!v) return null;
    try {
      return safeUrl(v);
    } catch (e) {
      ctx.addIssue({ code: "custom", message: (e as Error).message });
      return z.NEVER;
    }
  });

export const profileInput = z.object({
  publicName: optionalText(60),
  headline: optionalText(120),
  bio: optionalText(1500),
  location: optionalText(80),
  website: optionalUrl,
});
export type ProfileInput = z.output<typeof profileInput>;

export const portfolioInput = z.object({
  title: z.string().trim().min(2, "Give it a title").max(100),
  description: z.string().trim().max(1000).default(""),
  link: optionalUrl,
  imageUrl: optionalUrl,
  /** Slug of one of their skills, or empty. */
  skill: z.string().trim().max(80).default(""),
});
export type PortfolioInput = z.output<typeof portfolioInput>;

/** The name shown publicly: the one they chose, else their first name. */
export function displayName(publicName: string | null | undefined, accountName: string): string {
  return publicName?.trim() || accountName.trim().split(/\s+/)[0] || "Persuna member";
}

/** Average of 1–5 ratings to one decimal, with how many; null average when there are none. */
export function ratingSummary(ratings: (number | null | undefined)[]) {
  const given = ratings.filter((r): r is number => typeof r === "number");
  return {
    count: given.length,
    average: given.length
      ? Math.round((given.reduce((n, r) => n + r, 0) / given.length) * 10) / 10
      : null,
  };
}

/** The order after moving one piece up or down (ids, first shown first). */
export function moveItem(ids: string[], id: string, direction: "up" | "down"): string[] {
  const i = ids.indexOf(id);
  const j = direction === "up" ? i - 1 : i + 1;
  if (i < 0 || j < 0 || j >= ids.length) return ids;
  const next = [...ids];
  [next[i], next[j]] = [next[j], next[i]];
  return next;
}

/** Initials for an avatar: "Utibe Ettebong" → "UE"; no name, the email's first letter. */
export function initialsOf(name: string, email: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean);
  const letters = words.length ? words.slice(0, 2).map((w) => w[0]) : [email[0] ?? "?"];
  return letters.join("").toUpperCase();
}
