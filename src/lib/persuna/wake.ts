/**
 * The wake word: "Hey Nova" (whatever the persuna is called). Speech
 * recognition transcripts are messy, so this allows a near miss on the name
 * and a few greetings, and returns anything said after it.
 */
const GREETINGS = ["hey", "hi", "hello", "okay", "ok", "yo"];

function distance(a: string, b: string): number {
  const row = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    let prev = row[0];
    row[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const temp = row[j];
      row[j] = Math.min(row[j] + 1, row[j - 1] + 1, prev + (a[i - 1] === b[j - 1] ? 0 : 1));
      prev = temp;
    }
  }
  return row[b.length];
}

const words = (text: string) =>
  text
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s']/gu, " ")
    .split(/\s+/)
    .filter(Boolean);

function nameMatches(word: string, name: string): boolean {
  if (word === name) return true;
  return name.length >= 4 && distance(word, name) <= 1;
}

/**
 * Null unless the transcript contains greeting + name ("hey nova"). Then
 * `rest` is what followed ("remind me at four"), possibly empty.
 */
export function matchWakeWord(transcript: string, persunaName: string): { rest: string } | null {
  const name = words(persunaName)[0];
  if (!name) return null;
  const said = words(transcript);
  for (let i = 0; i < said.length - 1; i++) {
    if (GREETINGS.includes(said[i]) && nameMatches(said[i + 1], name)) {
      return { rest: said.slice(i + 2).join(" ") };
    }
  }
  return null;
}
