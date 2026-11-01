/**
 * Pacing a drawing's reveal to Persuna's voice. A drawing's steps (numbered
 * notes, then diagram boxes) appear as Persuna explains them, not all at
 * once: progress is the fraction of the spoken reply said so far, and steps
 * are the leading slice of that. Pure, so the suite pins it.
 */

/** How fast Persuna speaks, in speakable chars a second (about 900 chars a minute). */
export const SPEECH_CPS = 15;

/**
 * Where progress holds while speech is still going: the last step appears
 * when speech really ends, never on an estimate that ran fast.
 */
export const NARRATION_HOLD = 0.97;

/** How much of a narrated reply is already spoken: what's confirmed, over the whole. */
export function initialNarration(alreadyChars: number, totalChars: number): number {
  if (totalChars <= 0) return 1;
  return Math.min(1, Math.max(0, alreadyChars / totalChars));
}

/**
 * How much is spoken after `elapsedMs` more, from `baseChars` of
 * `totalChars`. Speech runs at about {@link SPEECH_CPS}; the estimate holds
 * below 1 until the caller confirms speech ended.
 */
export function narrationProgress(
  elapsedMs: number,
  baseChars: number,
  totalChars: number,
): number {
  if (totalChars <= 0) return 1;
  const est = baseChars + (Math.max(0, elapsedMs) / 1000) * SPEECH_CPS;
  return Math.min(NARRATION_HOLD, Math.max(0, est / totalChars));
}

/** Steps shown for a progress of 0..1: at least the first, all of them at the end. */
export function shownSteps(progress: number, total: number): number {
  if (total <= 0) return 0;
  return Math.min(total, Math.max(1, Math.ceil(progress * total)));
}
