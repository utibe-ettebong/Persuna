/**
 * Onboarding by conversation: Persona asks its name, its look and its first
 * task, and the user answers however they like, typed or spoken. These turn
 * free answers into choices. Pure, so they are tested without a browser.
 */
import { LOOKS, LOOK_IDS, type LookId } from "./looks";

export type SetupStep = "name" | "look" | "task" | "describe";

export const SETUP_QUESTIONS: Record<SetupStep, (name: string) => string> = {
  name: () =>
    "Hi! I'm your new assistant. I'll keep notes, remind you of things, and learn how you work. First things first: what would you like to call me?",
  look: (name) =>
    `${name}. I like it. How should I look? Plum, Aurora, Ember, Lagoon, Moss or Ink? Or tap one.`,
  task: (name) =>
    `Lovely. I'm ${name}. What should I learn first? Tell me a task you do, pick one of yours, or say "sample" to try meeting minutes.`,
  describe: () => "Got it. In a sentence, what goes in and what comes out?",
};

const NAME_LEADS =
  /^(?:(?:ok(?:ay)?|um+|uh+|hmm+|well|so|right)[\s,]+)*(?:i(?:'d| would)? (?:like|want) to call you|i'?ll call you|let'?s (?:go with|call you|name you)|call you|you can be|your name (?:is|will be|should be)|name you|how about|maybe|i think|let'?s say|just)\s+/i;
const PICK_FOR_ME =
  /\b(you (?:choose|pick|decide)|anything|whatever|surprise me|no idea|don'?t know|up to you)\b/i;

/** "Let's call you Nova!" → "Nova". Null when they leave it to Persona. */
export function parseName(text: string): string | null {
  if (PICK_FOR_ME.test(text)) return null;
  const cleaned = text
    .trim()
    .replace(NAME_LEADS, "")
    .replace(/["'“”‘’.!?,]/g, " ")
    .trim()
    .split(/\s+/)
    .filter((w) => !/^(please|then|maybe)$/i.test(w))
    .slice(0, 3)
    .join(" ");
  if (!cleaned || cleaned.length > 30) return null;
  return cleaned.replace(/\b\p{L}/gu, (c) => c.toUpperCase());
}

const COLOUR_WORDS: Record<LookId, RegExp> = {
  plum: /\b(plum|purple|violet|lilac)\b/i,
  aurora: /\b(aurora|teal|turquoise|cyan|northern)\b/i,
  ember: /\b(ember|orange|red|pink|fire|warm|sunset)\b/i,
  lagoon: /\b(lagoon|blue|ocean|sea|sky)\b/i,
  moss: /\b(moss|green|forest|leaf|lime)\b/i,
  ink: /\b(ink|black|dark|grey|gray|night|mono)\b/i,
};

/** "Something blue" → "lagoon". "You choose" → the default. Null when unclear. */
export function parseLook(text: string): LookId | null {
  for (const id of LOOK_IDS) if (COLOUR_WORDS[id].test(text)) return id;
  if (PICK_FOR_ME.test(text)) return "plum";
  const label = LOOK_IDS.find((id) => text.toLowerCase().includes(LOOKS[id].label.toLowerCase()));
  return label ?? null;
}

export type FirstTaskAnswer =
  | { kind: "existing"; slug: string }
  | { kind: "sample" }
  | { kind: "new"; name: string }
  | { kind: "skip" };

const STOP = new Set([
  "the",
  "a",
  "an",
  "my",
  "of",
  "to",
  "into",
  "and",
  "for",
  "with",
  "notes",
  "i",
  "me",
]);
const TASK_LEADS =
  /^(?:(?:ok(?:ay)?|um+|so|well)[\s,]+)*(?:i(?:'d| would)? (?:like|want) you to (?:learn|do|help (?:me )?with)|(?:please )?learn(?: how to do)?|teach you|help me (?:with|do)|i (?:do|write|make)|start with|let'?s do|first,?)\s+/i;

export function parseFirstTask(
  text: string,
  skills: { slug: string; name: string }[],
): FirstTaskAnswer {
  const t = text.trim();
  if (/\b(skip|later|not now|nothing yet|no thanks)\b/i.test(t)) return { kind: "skip" };
  if (/\b(sample|example|demo|try it|the meeting minutes one)\b/i.test(t))
    return { kind: "sample" };
  const words = t
    .toLowerCase()
    .split(/\W+/)
    .filter((w) => w.length > 2 && !STOP.has(w));
  const match = skills.find((s) =>
    s.name
      .toLowerCase()
      .split(/\W+/)
      .some((w) => w.length > 2 && !STOP.has(w) && words.includes(w)),
  );
  if (match) return { kind: "existing", slug: match.slug };
  const name = t
    .replace(TASK_LEADS, "")
    .replace(/[.!?]+$/, "")
    .trim();
  const short = name.split(/\s+/).slice(0, 8).join(" ");
  return { kind: "new", name: short.charAt(0).toUpperCase() + short.slice(1) };
}
