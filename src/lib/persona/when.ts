/**
 * Times for reminders. The browser sends its local time and UTC offset, the
 * model answers in local wall-clock time ("2026-10-27T16:00"), and this turns
 * that into a real instant. Also a small parser the offline mock uses.
 */

/** `new Date().getTimezoneOffset()` in the browser: minutes to ADD to local time to get UTC. */
export type OffsetMinutes = number;

const LOCAL = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/;

export function localToUtc(local: string, offset: OffsetMinutes): Date | null {
  const m = LOCAL.exec(local);
  if (!m) return null;
  const [, y, mo, d, h, mi] = m.map(Number);
  if (mo < 1 || mo > 12 || d < 1 || d > 31 || h > 23 || mi > 59) return null;
  return new Date(Date.UTC(y, mo - 1, d, h, mi) + offset * 60_000);
}

export function utcToLocal(date: Date, offset: OffsetMinutes): string {
  return new Date(date.getTime() - offset * 60_000).toISOString().slice(0, 16);
}

/** The instant the user's local day began. */
export function startOfLocalDay(now: Date, offset: OffsetMinutes): Date {
  const local = utcToLocal(now, offset).slice(0, 10);
  return localToUtc(`${local}T00:00`, offset)!;
}

const pad = (n: number) => String(n).padStart(2, "0");

/**
 * Finds a time in plain English relative to local `now` ("YYYY-MM-DDTHH:mm"):
 * "at 4pm", "at 16:30", "tomorrow at 9am", "in 10 minutes", "in 2 hours".
 * Returns local wall-clock time, or null when there is no time.
 */
export function parseWhen(text: string, now: string): string | null {
  const m = LOCAL.exec(now);
  if (!m) return null;
  const [, y, mo, d, h, mi] = m.map(Number);
  const base = new Date(Date.UTC(y, mo - 1, d, h, mi));
  const lower = text.toLowerCase();

  const rel = lower.match(/\bin (\d+|an?|one) (minute|min|hour|hr)s?\b/);
  if (rel) {
    const n = /^\d+$/.test(rel[1]) ? Number(rel[1]) : 1;
    const ms = n * (rel[2].startsWith("h") ? 3_600_000 : 60_000);
    return new Date(base.getTime() + ms).toISOString().slice(0, 16);
  }

  const at = lower.match(/\b(?:at|by)\s+(\d{1,2})(?::(\d{2}))?\s*(am|pm)?\b/);
  if (!at) return null;
  let hour = Number(at[1]);
  const minute = at[2] ? Number(at[2]) : 0;
  if (at[3] === "pm" && hour < 12) hour += 12;
  if (at[3] === "am" && hour === 12) hour = 0;
  if (hour > 23 || minute > 59) return null;
  const day = new Date(base);
  day.setUTCHours(hour, minute, 0, 0);
  const tomorrow = /\btomorrow\b/.test(lower);
  if (tomorrow || day.getTime() <= base.getTime()) day.setUTCDate(day.getUTCDate() + 1);
  return `${day.getUTCFullYear()}-${pad(day.getUTCMonth() + 1)}-${pad(day.getUTCDate())}T${pad(hour)}:${pad(minute)}`;
}
