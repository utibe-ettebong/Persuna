import { z } from "zod";
import type { JobFlag } from "./self-check";

/**
 * Grounding: is every statement in a draft backed by the input? The model
 * lists the draft's factual statements, each with a quote from the input;
 * code then checks each quote really is in the input. A statement without a
 * real quote is unsupported. (The model can be wrong about support; it can't
 * fake a quote.)
 */
export const groundingClaims = z.object({
  claims: z
    .array(z.object({ claim: z.string().trim().min(1), quote: z.string().default("") }))
    .max(80),
});
export type GroundingClaim = z.infer<typeof groundingClaims>["claims"][number];

export interface GroundingReport {
  /** Statements checked. */
  checked: number;
  /** Statements with no quote found in the input. */
  unsupported: GroundingClaim[];
  /** How many times the draft was rewritten to fix unsupported statements. */
  redrafts: number;
}

/** Drafts are rewritten at most this many times before going to the owner flagged. */
export const MAX_REDRAFTS = 2;
/** A quote shorter than this proves nothing ("the", "Friday"). */
export const MIN_QUOTE_CHARS = 8;

const SPACE = /\s+/g;
const SAME = new Map(
  Object.entries({
    "‘": "'",
    "’": "'",
    "“": '"',
    "”": '"',
    "–": "-",
    "—": "-",
    " ": " ",
  }),
);

/** Case, spacing and curly quotes don't count as differences. */
export function normalizeForQuote(text: string): string {
  return [...(text ?? "")]
    .map((c) => SAME.get(c) ?? c)
    .join("")
    .replace(SPACE, " ")
    .trim()
    .toLowerCase();
}

export function quoteInSource(quote: string, source: string): boolean {
  const q = normalizeForQuote(quote).replace(/^["'.\s]+|["'.\s]+$/g, "");
  return q.length >= MIN_QUOTE_CHARS && normalizeForQuote(source).includes(q);
}

export function assessClaims(
  claims: GroundingClaim[],
  source: string,
  redrafts = 0,
): GroundingReport {
  return {
    checked: claims.length,
    unsupported: claims.filter((c) => !quoteInSource(c.quote, source)),
    redrafts,
  };
}

/** What's still unsupported after the redrafts, as flags for the owner (at most 5). */
export function groundingFlags(report: GroundingReport): JobFlag[] {
  return report.unsupported.slice(0, 5).map((c) => ({
    kind: "invented_detail" as const,
    message: `Not supported by the input: "${c.claim}"`,
  }));
}
