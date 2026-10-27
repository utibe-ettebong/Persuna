/**
 * How the user likes to be spoken to. Explicit choices ("keep it short", or
 * the Persona page) always win; until then Persona follows what it notices in
 * how the user writes.
 */
export interface Tone {
  length?: "short" | "normal" | "detailed";
  formality?: "casual" | "neutral" | "formal";
  playful?: boolean;
  /** Other preferences in the user's words ("call me Ada", "no exclamation marks"). */
  notes?: string[];
}

export const MAX_TONE_NOTES = 6;

export type ToneChange = Partial<Omit<Tone, "notes">> & { note?: string };

export function applyToneChange(tone: Tone, change: ToneChange): Tone {
  const { note, ...rest } = change;
  const next: Tone = {
    ...tone,
    ...Object.fromEntries(Object.entries(rest).filter(([, v]) => v !== undefined)),
  };
  if (note?.trim()) {
    const notes = (tone.notes ?? []).filter((n) => n.toLowerCase() !== note.trim().toLowerCase());
    next.notes = [...notes, note.trim()].slice(-MAX_TONE_NOTES);
  }
  return next;
}

/** Explicit requests about how to talk, in plain English. Null when there are none. */
export function toneFromMessage(text: string): ToneChange | null {
  const t = text.toLowerCase();
  const change: ToneChange = {};
  if (
    /\b(keep it|be|more|much) (short|brief)|shorter|too long|fewer words|less wordy|tl;?dr\b/.test(
      t,
    )
  )
    change.length = "short";
  else if (/\b(more detail|more detailed|longer answers|explain more|go deeper)\b/.test(t))
    change.length = "detailed";
  if (/\b(more formal|be formal|professional)\b/.test(t)) change.formality = "formal";
  else if (/\b(more casual|less formal|relax|chill)\b/.test(t)) change.formality = "casual";
  if (/\b(be (more )?(playful|funny|fun)|you can joke|make me laugh|crack a joke)\b/.test(t))
    change.playful = true;
  else if (/\b(no jokes|stop joking|be serious|less playful)\b/.test(t)) change.playful = false;
  return Object.keys(change).length ? change : null;
}

/** What Persona notices about how the user writes: a guide until they say otherwise. */
export function inferTone(userMessages: string[]): Tone {
  const recent = userMessages.slice(-20).filter((m) => m.trim());
  if (recent.length < 3) return {};
  const words = recent.map((m) => m.trim().split(/\s+/).length);
  const avg = words.reduce((a, b) => a + b, 0) / words.length;
  const all = recent.join(" ");
  const playful = /(\p{Extended_Pictographic}|\blol\b|\bhaha|\blmao\b|!!)/iu.test(all);
  const formal = /\b(kindly|regards|dear|please could|would you be so)\b/i.test(all);
  const casual = /\b(hey|yo|gonna|wanna|abeg|pls|thx)\b/i.test(all);
  return {
    length: avg <= 6 ? "short" : avg >= 30 ? "detailed" : "normal",
    formality: formal ? "formal" : casual ? "casual" : "neutral",
    playful,
  };
}

/** Explicit preferences over noticed ones. */
export function effectiveTone(explicit: Tone, inferred: Tone): Tone {
  return {
    length: explicit.length ?? inferred.length,
    formality: explicit.formality ?? inferred.formality,
    playful: explicit.playful ?? inferred.playful,
    notes: explicit.notes,
  };
}

/** One instruction line for the model and the voice. */
export function toneInstruction(tone: Tone): string {
  const parts = [
    tone.length === "short"
      ? "Keep replies to one short sentence when you can."
      : tone.length === "detailed"
        ? "Give fuller answers with a little more detail."
        : "Keep replies to one to three sentences.",
    tone.formality === "formal"
      ? "Be polite and professional."
      : tone.formality === "casual"
        ? "Be relaxed and friendly, like a colleague."
        : "Be warm and plain.",
    tone.playful ? "A little light humour is welcome." : "",
    ...(tone.notes ?? []).map((n) => `They asked: ${n}.`),
  ];
  return parts.filter(Boolean).join(" ");
}

/** How the cloud voice should sound. */
export function voiceStyle(tone: Tone): string {
  return [
    "Speak naturally, like a helpful colleague.",
    tone.length === "short" ? "Be brisk." : "",
    tone.formality === "formal" ? "Calm and professional." : "Warm.",
    tone.playful ? "Upbeat, with a smile in your voice." : "",
  ]
    .filter(Boolean)
    .join(" ");
}
