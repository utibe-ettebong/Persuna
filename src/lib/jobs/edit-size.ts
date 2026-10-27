import { diffWords } from "diff";

export type EditSize = "none" | "minor" | "major";

/** Share of words changed between draft and final output, 0–1. */
export function changeRatio(draft: string, final: string): number {
  const parts = diffWords(draft.trim(), final.trim());
  let changed = 0;
  let total = 0;
  for (const part of parts) {
    const words = part.value.split(/\s+/).filter(Boolean).length;
    if (part.added || part.removed) changed += words;
    if (!part.added) total += words;
  }
  return total === 0 ? (changed ? 1 : 0) : Math.min(1, changed / total);
}

/**
 * How much the owner changed a draft at approval. "minor" is wording-level
 * (up to 15% of words), "major" is structure or substance. Feeds the
 * replication score and, later, the trust ladder.
 */
export function classifyEdit(draft: string, final: string, minorThreshold = 0.15): EditSize {
  if (draft.trim() === final.trim()) return "none";
  return changeRatio(draft, final) <= minorThreshold ? "minor" : "major";
}
