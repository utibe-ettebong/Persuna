/**
 * Sentence boundaries for streamed speech: prose arrives in arbitrary pieces
 * and is spoken sentence by sentence, so the first sentence can be voiced
 * while the rest is still being written. A boundary is end punctuation
 * followed by whitespace and a fresh start — guarded against decimals,
 * abbreviations and initials, which only affect where one breath ends.
 */
const ABBREVIATIONS = new Set([
  "mr",
  "mrs",
  "ms",
  "dr",
  "st",
  "etc",
  "eg",
  "ie",
  "vs",
  "no",
  "jr",
  "sr",
  "prof",
  "gen",
  "rep",
  "sen",
]);

export interface SentenceSplitter {
  /** Feeds streamed prose; returns each sentence completed by this piece. */
  push(text: string): string[];
  /** Flushes the trailing fragment, if it says anything. */
  finish(): string[];
}

export function createSentenceSplitter(): SentenceSplitter {
  let buf = "";
  return {
    push(text) {
      buf += text;
      const sentences: string[] = [];
      for (;;) {
        const end = boundaryIn(buf);
        if (end < 0) return sentences;
        const sentence = buf.slice(0, end).trim();
        buf = buf.slice(end).trimStart();
        if (sentence) sentences.push(sentence);
      }
    },
    finish() {
      const rest = buf.trim();
      buf = "";
      return rest ? [rest] : [];
    },
  };
}

/** Splits whole text the way the stream would have. */
export function splitSentences(text: string): string[] {
  const splitter = createSentenceSplitter();
  return [...splitter.push(text), ...splitter.finish()];
}

/** Index just past a sentence boundary, or -1 when the buffer holds none. */
function boundaryIn(buf: string): number {
  const blank = buf.search(/\n\s*\n/);
  for (const match of buf.matchAll(/([.?!…]+)(["”')\]]*)(\s+)(?=["“'(\[A-Z0-9])/g)) {
    const end = (match.index ?? 0) + match[0].length;
    if (blank >= 0 && blank < end) return blank;
    const word = /[A-Za-z]+$/.exec(buf.slice(0, match.index))?.[0] ?? "";
    if (word.length === 1 && match[1] === ".") continue;
    if (ABBREVIATIONS.has(word.toLowerCase()) && match[1] === ".") continue;
    // A bare "1." starts a list item; it isn't a sentence on its own.
    if (/^\(?\d+[.)]?$/.test(buf.slice(0, end).trim())) continue;
    return end;
  }
  return blank >= 0 ? blank : -1;
}
