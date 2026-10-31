/**
 * Which screen mode a turn goes out in. Talk mode never carries the screen;
 * Work mode reads it on its own cadence; Look mode is one consented read for
 * this turn (a circled question, "show me", or a question about the screen).
 * Both the page and the server enforce this: the server rejects a Talk turn
 * that arrives with a screen read.
 */
export type TurnMode = "talk" | "work" | "look";

/** The mode a turn goes out in: working, carrying a read, or just talking. */
export function modeForTurn(work: boolean, sight: boolean): TurnMode {
  if (work) return "work";
  return sight ? "look" : "talk";
}

/**
 * Is the front app on the user's never-read list? Names, matched whole and
 * case-insensitively (the desktop reports names, not bundle ids).
 */
export function isExcludedApp(app: string, excluded: readonly string[]): boolean {
  const name = app.trim().toLowerCase();
  if (!name) return false;
  return excluded.some((entry) => {
    const match = entry.trim().toLowerCase();
    return match.length > 0 && match === name;
  });
}

/**
 * Has Work mode been quiet long enough to turn itself off? `minutes` of 0
 * means never. Activity is anything the user did or Persuna said or sent.
 */
export function workAutoOffDue(now: number, lastActive: number, minutes: number): boolean {
  return minutes > 0 && now - lastActive > minutes * 60_000;
}
