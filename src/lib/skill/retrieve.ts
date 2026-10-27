import type { Pair } from "./types";

/**
 * Picks the training pairs whose inputs look most like the new input, using
 * TF-IDF cosine similarity. With tens of examples this is instant, needs no
 * embedding model, and is deterministic, which keeps test runs comparable
 * between skill versions. Swap for pgvector once examples number in the hundreds.
 */
export function closestPairs(input: string, pairs: Pair[], k: number): Pair[] {
  if (pairs.length <= k) return pairs;

  const docs = pairs.map((p) => termCounts(p.input));
  const query = termCounts(input);
  const idf = inverseDocumentFrequency([...docs, query]);
  const queryVector = weigh(query, idf);

  return pairs
    .map((pair, i) => ({ pair, score: cosine(queryVector, weigh(docs[i], idf)) }))
    .sort((a, b) => b.score - a.score || a.pair.slug.localeCompare(b.pair.slug))
    .slice(0, k)
    .map((s) => s.pair);
}

export function tokenize(text: string): string[] {
  return text.toLowerCase().match(/[\p{L}\p{N}]{3,}/gu) ?? [];
}

function termCounts(text: string): Map<string, number> {
  const counts = new Map<string, number>();
  for (const token of tokenize(text)) counts.set(token, (counts.get(token) ?? 0) + 1);
  return counts;
}

function inverseDocumentFrequency(docs: Map<string, number>[]): Map<string, number> {
  const df = new Map<string, number>();
  for (const doc of docs) for (const term of doc.keys()) df.set(term, (df.get(term) ?? 0) + 1);
  const idf = new Map<string, number>();
  for (const [term, n] of df) idf.set(term, Math.log((1 + docs.length) / (1 + n)) + 1);
  return idf;
}

function weigh(counts: Map<string, number>, idf: Map<string, number>): Map<string, number> {
  const vector = new Map<string, number>();
  for (const [term, n] of counts) vector.set(term, n * (idf.get(term) ?? 1));
  return vector;
}

function cosine(a: Map<string, number>, b: Map<string, number>): number {
  let dot = 0;
  for (const [term, w] of a) dot += w * (b.get(term) ?? 0);
  const norm = (v: Map<string, number>) =>
    Math.sqrt([...v.values()].reduce((s, w) => s + w * w, 0));
  const denominator = norm(a) * norm(b);
  return denominator === 0 ? 0 : dot / denominator;
}
