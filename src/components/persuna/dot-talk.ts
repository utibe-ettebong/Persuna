/**
 * In Work mode the cursor dot takes over talking from the notch island: while
 * you hold the talk key, and while Persuna thinks and answers, the status and
 * the reply appear beside the dot, and the island stays a silent strip. Pure
 * helpers, so the precedence is unit-tested; the companion wires them in.
 */

/** The talk phases the dot can be in, matching the companion's Busy. */
export type TalkBusy = "idle" | "thinking" | "hearing";

/** The island goes quiet once setup is done and Work mode is on (desktop overlay). */
export function islandQuiet(workMode: boolean, setupDone: boolean): boolean {
  return workMode && setupDone;
}

/** What the dot says while you're talking or Persuna is working on it. */
export function talkStatus(holding: boolean, busy: TalkBusy): string | null {
  if (holding) return "Listening…";
  if (busy === "hearing") return "Hearing you…";
  if (busy === "thinking") return "Thinking…";
  return null;
}

/**
 * What shows beside the dot: the live talk status first, then the latest
 * reply or error, then whatever Work mode itself is saying. Off Work mode
 * the dot only ever shows Work mode's own messages.
 */
export function dotLine(input: {
  quiet: boolean;
  status: string | null;
  talk: string | null;
  bubble: string | null;
}): string | null {
  if (!input.quiet) return input.bubble;
  return input.status ?? input.talk ?? input.bubble;
}
