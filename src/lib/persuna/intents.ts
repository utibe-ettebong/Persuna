/**
 * Fast-path intents: a few things Persuna can do without asking the model.
 * Pure and conservative — it only acts on an explicit lead-in plus, for
 * reminders, an explicit time. Anything ambiguous returns null so the
 * normal chat path handles it. A missed intent just falls through to
 * chat; a wrong one would create a reminder or note the user never asked
 * for, so false negatives are fine and false positives are not.
 */

export type FastIntent =
  | { kind: "reminder"; text: string; due: Date }
  | { kind: "note"; title: string; body: string }
  | { kind: "copy" };

const COPY = /^copy (that|it|this|your last reply|your reply)\.?$/i;

const NOTE_LEAD_IN =
  /^(?:todo|to-do|note)\s*:\s*(.+)$|^add\s+(?:a\s+)?(?:todo|to-do|note)\s*:?\s*(.+)$/i;

const REMIND_ME = /^remind me\b\s*(.*)$/i;
const REMINDER_LABEL = /^reminder\s*:\s*(.+)$/i;

const RELATIVE_TIME = /\bin\s+(\d+|an?|one)\s*(minutes?|mins?|hours?|hrs?)\b/i;

// "tomorrow at 9", "at 9", "at 4:30pm". The "tomorrow at" form is tried
// first so the day word is part of the time phrase, not the text.
const CLOCK_TIME =
  /\b(?:(tomorrow)\s+at\s+|(tomorrow)\s+|at\s+)(\d{1,2})(?::(\d{2}))?\s*(am|pm)?\b/i;

function normalize(raw: string): string {
  return raw.trim().replace(/\s+/g, " ");
}

function cleanReminderText(text: string): string {
  return text
    .replace(/\btomorrow\b/gi, " ")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/^to\s+/i, "")
    .replace(/^[,:;\s]+/, "")
    .replace(/[.\s]+$/, "")
    .trim();
}

/**
 * Builds the due date for a clock time.
 *
 * Time rule (kept deliberately simple):
 * - Explicit am/pm is honoured. If that time today has already passed,
 *   it is tomorrow at the same time. "tomorrow" forces the next day.
 * - 13–23 is read as a 24-hour clock value, today if ahead, else tomorrow.
 * - Bare 1–12: try AM today first (12am is 00:00). If that has passed,
 *   try PM today (12pm is 12:00). If that has passed too, it is AM
 *   tomorrow. So at 10:00 "at 4" means 16:00 today, at 09:00 "at 10"
 *   means 10:00 today, and at 17:30 "at 4" means 04:00 tomorrow.
 * - With "tomorrow", a bare 1–12 is read as AM on the next day.
 */
function clockDue(
  now: Date,
  hourRaw: number,
  minute: number,
  meridiem: string | undefined,
  tomorrow: boolean,
): Date | null {
  if (minute < 0 || minute > 59) return null;

  const onDay = (dayOffset: number, hour24: number): Date => {
    const d = new Date(now);
    d.setDate(d.getDate() + dayOffset);
    d.setHours(hour24, minute, 0, 0);
    return d;
  };

  if (meridiem) {
    if (hourRaw < 1 || hourRaw > 12) return null;
    const hour24 = (hourRaw % 12) + (meridiem.toLowerCase() === "pm" ? 12 : 0);
    if (tomorrow) return onDay(1, hour24);
    const today = onDay(0, hour24);
    return today.getTime() > now.getTime() ? today : onDay(1, hour24);
  }

  if (hourRaw < 0 || hourRaw > 23) return null;

  if (hourRaw >= 13 || hourRaw === 0) {
    if (tomorrow) return onDay(1, hourRaw);
    const today = onDay(0, hourRaw);
    return today.getTime() > now.getTime() ? today : onDay(1, hourRaw);
  }

  // Bare 1–12, as documented above.
  const amHour = hourRaw % 12;
  if (tomorrow) return onDay(1, amHour);
  const amToday = onDay(0, amHour);
  if (amToday.getTime() > now.getTime()) return amToday;
  const pmToday = onDay(0, amHour + 12);
  if (pmToday.getTime() > now.getTime()) return pmToday;
  return onDay(1, amHour);
}

function parseReminder(rest: string, now: Date): FastIntent | null {
  const relative = RELATIVE_TIME.exec(rest);
  const clock = CLOCK_TIME.exec(rest);

  // Both kinds of time at once is ambiguous, so leave it to chat.
  if (relative && clock) return null;

  if (relative) {
    // A second "in …" phrase would also be ambiguous.
    if (RELATIVE_TIME.test(rest.slice(relative.index + relative[0].length))) return null;
    const n = /^\d+$/.test(relative[1]) ? Number(relative[1]) : 1;
    if (!Number.isFinite(n) || n <= 0) return null;
    const ms = n * (relative[2].toLowerCase().startsWith("h") ? 3_600_000 : 60_000);
    const text = cleanReminderText(
      rest.slice(0, relative.index) + " " + rest.slice(relative.index + relative[0].length),
    );
    if (!text) return null;
    return { kind: "reminder", text, due: new Date(now.getTime() + ms) };
  }

  if (!clock) return null;
  // A second clock time would be ambiguous.
  if (CLOCK_TIME.test(rest.slice(clock.index + clock[0].length))) return null;

  const tomorrow = Boolean(clock[1] ?? clock[2]) || /\btomorrow\b/i.test(rest);
  const due = clockDue(now, Number(clock[3]), clock[4] ? Number(clock[4]) : 0, clock[5], tomorrow);
  if (!due) return null;

  const text = cleanReminderText(
    rest.slice(0, clock.index) + " " + rest.slice(clock.index + clock[0].length),
  );
  if (!text) return null;
  return { kind: "reminder", text, due };
}

function parseNote(input: string): FastIntent | null {
  const m = NOTE_LEAD_IN.exec(input);
  if (!m) return null;
  const body = (m[1] ?? m[2] ?? "").trim();
  if (!body) return null;
  // Title is the first sentence, capped at 60 characters.
  const sentence = /^[^.!?]+/.exec(body)?.[0] ?? body;
  const title = sentence.trim().slice(0, 60).trim();
  if (!title) return null;
  return { kind: "note", title, body };
}

export function parseFastIntent(raw: string, now: Date): FastIntent | null {
  const input = normalize(raw);
  if (!input) return null;

  if (COPY.test(input)) return { kind: "copy" };

  const note = parseNote(input);
  if (note) return note;

  const labelled = REMINDER_LABEL.exec(input);
  if (labelled) return parseReminder(labelled[1], now);

  const remindMe = REMIND_ME.exec(input);
  if (remindMe) return parseReminder(remindMe[1], now);

  return null;
}
