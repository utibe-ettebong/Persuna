/**
 * Does a typed message need the screen to go with it? Reading the screen on
 * the desktop takes a couple of seconds, so plain chat ("draft an email",
 * "what's my focus") no longer pays for a capture it never uses. Conservative
 * on purpose: a miss costs the user one "look at my screen" (or the Show me
 * button); a false positive costs two seconds on every turn.
 */
const SCREEN_WORDS =
  "screen|page|window|button|error|tab|app|form|link|menu|dialog|icon|field|chart|image|picture|photo";

const SCREENISH = new RegExp(
  [
    // "what is this (error)?", but not "what is this week"
    `what('s| is) (this|that)(?!\\s+(week|month|year|meeting|time))\\b`,
    `(this|that) (?:\\w+ ){0,2}(${SCREEN_WORDS})\\b`,
    `(${SCREEN_WORDS}) (on|in) (my|the|this)`,
    "on (my|the) screen\\b",
    "show me\\b",
    "look at (this|that|the|my)\\b",
    "read (this|that|it|the)\\b",
    "where('s| is| do| can)\\b",
    "point (to|at|out)\\b",
    "(explain|fix|fill|open|click|find) (this|that|it)\\b",
    "summari[sz]e (this|that|the page|my screen)\\b",
  ].join("|"),
  "i",
);

export function wantsSight(text: string): boolean {
  return SCREENISH.test(text);
}

/**
 * Should the next turn take the screen too? Yes straight after a turn about it
 * (a follow-up like "and the other one?"), not forever after. `words` is null
 * when they aren't known yet: a recording the server will hear.
 */
export function stayOnScreen(words: string | null, circled: boolean, showed: boolean): boolean {
  return showed || circled || words === null || wantsSight(words);
}
