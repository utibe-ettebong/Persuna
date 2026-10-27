import { z } from "zod";

/**
 * Redaction for example pairs before they are saved. Two sources:
 *
 * - Patterns catch structured identifiers: emails, phone and account
 *   numbers, links, street addresses.
 * - Named entities (people, organisations, places) come from the model, since
 *   no pattern can find names reliably.
 *
 * Entity placeholders are numbered per pair and shared between the input and
 * the output ("Ada" is [PERSON 1] in both), so the pair still teaches the
 * method. The owner reviews every finding before anything is saved.
 */
export type PatternKind = "email" | "phone" | "account" | "url" | "address";
export type EntityKind = "person" | "organisation" | "place";
export type FindingKind = PatternKind | EntityKind;

export interface Finding {
  kind: FindingKind;
  match: string;
  index: number;
}

export const namedEntities = z.object({
  entities: z.array(
    z.object({
      text: z.string().min(1),
      kind: z.enum(["person", "organisation", "place"]),
    }),
  ),
});
export type NamedEntity = z.infer<typeof namedEntities>["entities"][number];

const PATTERNS: { kind: PatternKind; re: RegExp }[] = [
  { kind: "email", re: /[\w.+-]+@[\w-]+\.[\w.-]+/g },
  { kind: "url", re: /\bhttps?:\/\/[^\s)>\]]+/gi },
  // Nigerian (+234 / 0xxx) and general international numbers, with spacing or dashes.
  { kind: "phone", re: /(?:\+\d{1,3}[\s-]?)?\(?0?\d{3}\)?[\s-]?\d{3}[\s-]?\d{4}\b/g },
  // NUBAN (10), BVN/NIN (11), card numbers (13–19), with optional spaces.
  { kind: "account", re: /\b\d(?:[\s-]?\d){9,18}\b/g },
  {
    kind: "address",
    re: /\b\d{1,5}[A-Za-z]?,?\s+(?:[A-Z][\w'-]*\s){1,4}(?:Street|St|Road|Rd|Avenue|Ave|Close|Crescent|Way|Lane|Drive|Estate)\b\.?/g,
  },
];

const PATTERN_PLACEHOLDER: Record<PatternKind, string> = {
  email: "[EMAIL]",
  phone: "[PHONE]",
  account: "[NUMBER]",
  url: "[LINK]",
  address: "[ADDRESS]",
};

const ENTITY_LABEL: Record<EntityKind, string> = {
  person: "PERSON",
  organisation: "ORG",
  place: "PLACE",
};

const isEntity = (kind: FindingKind): kind is EntityKind => kind in ENTITY_LABEL;

export function scanForIdentifiers(text: string): Finding[] {
  return claim(
    [],
    PATTERNS.flatMap(({ kind, re }) => matches(text, re, kind)),
  );
}

/** Every mention of the given entities in `text`. People also match by first name, any case. */
export function findEntityMentions(text: string, entities: NamedEntity[]): Finding[] {
  const found: Finding[] = [];
  for (const variant of entityVariants(entities)) {
    const re = new RegExp(`(?<![\\p{L}\\p{N}])${escape(variant.text)}(?![\\p{L}\\p{N}])`, "giu");
    found.push(...matches(text, re, variant.kind));
  }
  return found;
}

/** Pattern findings first, then entity mentions, longest first; overlapping spans are dropped. */
export function scanText(text: string, entities: NamedEntity[] = []): Finding[] {
  const patterns = scanForIdentifiers(text);
  const mentions = findEntityMentions(text, entities).sort(
    (a, b) => b.match.length - a.match.length,
  );
  return claim(patterns, mentions);
}

/**
 * Redacts several related texts (a pair's input and output) together, so each
 * entity gets the same numbered placeholder everywhere it appears.
 */
export function redactTogether(
  texts: string[],
  findings: Finding[][],
  entities: NamedEntity[] = [],
): string[] {
  const keyOf = entityKeyer(entities);
  const numbers = new Map<string, number>();
  const counters: Record<EntityKind, number> = { person: 0, organisation: 0, place: 0 };
  const placeholder = (f: Finding) => {
    if (!isEntity(f.kind)) return PATTERN_PLACEHOLDER[f.kind];
    const key = `${f.kind}:${keyOf(f.match)}`;
    if (!numbers.has(key)) numbers.set(key, ++counters[f.kind]);
    return `[${ENTITY_LABEL[f.kind]} ${numbers.get(key)}]`;
  };

  // Number placeholders in reading order across all texts, then replace back to front.
  const ordered = findings.map((list) => [...list].sort((a, b) => a.index - b.index));
  const labels = ordered.map((list) => list.map(placeholder));
  return texts.map((text, t) => {
    let out = text;
    for (let i = ordered[t].length - 1; i >= 0; i--) {
      const f = ordered[t][i];
      out = out.slice(0, f.index) + labels[t][i] + out.slice(f.index + f.match.length);
    }
    return out;
  });
}

export function redact(text: string, findings = scanForIdentifiers(text)): string {
  return redactTogether([text], [findings])[0];
}

/** Full names, plus first names for people ("Ada O." also matches "Ada" and "ada"). */
function entityVariants(entities: NamedEntity[]) {
  const variants = new Map<string, { text: string; kind: EntityKind }>();
  for (const e of entities) {
    const text = e.text.trim();
    if (text.length < 2) continue;
    variants.set(text.toLowerCase(), { text, kind: e.kind });
    const first = text.split(/\s+/)[0];
    if (e.kind === "person" && first.length >= 3 && first !== text) {
      variants.set(first.toLowerCase(), { text: first, kind: "person" });
    }
  }
  return [...variants.values()];
}

/** Maps any mention ("ada", "Ada O.") back to one canonical entity, for consistent numbering. */
function entityKeyer(entities: NamedEntity[]) {
  return (mention: string) => {
    const m = mention.toLowerCase();
    const owner = entities.find((e) => {
      const full = e.text.trim().toLowerCase();
      return full === m || (e.kind === "person" && full.split(/\s+/)[0] === m);
    });
    return (owner?.text ?? mention).trim().toLowerCase();
  };
}

function matches(text: string, re: RegExp, kind: FindingKind): Finding[] {
  return [...text.matchAll(re)].map((m) => ({ kind, match: m[0], index: m.index }));
}

function claim(existing: Finding[], candidates: Finding[]): Finding[] {
  const out = [...existing];
  for (const c of candidates) {
    const end = c.index + c.match.length;
    if (out.some((f) => c.index < f.index + f.match.length && end > f.index)) continue;
    out.push(c);
  }
  return out.sort((a, b) => a.index - b.index);
}

function escape(text: string) {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
