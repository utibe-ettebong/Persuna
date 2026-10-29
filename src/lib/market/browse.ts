/**
 * Marketplace search, filters and sorting, as pure functions over the
 * listings already loaded. The query comes from the URL so results can be
 * shared and bookmarked.
 */
import { parseDollars } from "@/lib/money";

export const SORTS = {
  best: "Best score",
  popular: "Most rented",
  rating: "Top rated",
  price_low: "Price: low to high",
  price_high: "Price: high to low",
  newest: "Newest",
} as const;
export type Sort = keyof typeof SORTS;

export const TURNAROUNDS = [
  { hours: 1, label: "Within an hour" },
  { hours: 24, label: "Within a day" },
  { hours: 72, label: "Within 3 days" },
  { hours: 168, label: "Within a week" },
] as const;

export interface BrowseQuery {
  q: string;
  /** The kind of output, e.g. "minutes". */
  type: string | null;
  minPriceCents: number | null;
  maxPriceCents: number | null;
  minScore: number | null;
  maxHours: number | null;
  sort: Sort;
}

export interface BrowseItem {
  title: string;
  description: string;
  skillName: string;
  inputType: string;
  outputType: string;
  priceCents: number;
  turnaroundHours: number;
  score: number | null;
  rentals: number;
  rating: number | null;
  updatedAt: Date;
}

type Params = Record<string, string | string[] | undefined>;

const first = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v)?.trim() ?? "";

/** Reads the browse query from search params, ignoring anything malformed. */
export function parseBrowseQuery(params: Params): BrowseQuery {
  const number = (key: string, min: number, max: number) => {
    const raw = first(params[key]);
    if (!/^\d{1,4}(\.\d+)?$/.test(raw)) return null;
    const n = Number(raw);
    return n >= min && n <= max ? n : null;
  };
  const dollars = (key: string) => {
    const raw = first(params[key]);
    return raw ? parseDollars(raw) : null;
  };
  const sort = first(params.sort);
  return {
    q: first(params.q).slice(0, 100),
    type: first(params.type).slice(0, 60).toLowerCase() || null,
    minPriceCents: dollars("min"),
    maxPriceCents: dollars("max"),
    minScore: number("score", 0, 100),
    maxHours: number("hours", 1, 720),
    sort: sort in SORTS ? (sort as Sort) : "best",
  };
}

/** Whether any filter or search is set (the sort alone doesn't count). */
export function isFiltered(q: BrowseQuery) {
  return Boolean(
    q.q ||
    q.type ||
    q.minPriceCents !== null ||
    q.maxPriceCents !== null ||
    q.minScore !== null ||
    q.maxHours !== null,
  );
}

const words = (text: string) => text.toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? [];

/** Every search word must appear (as a word prefix) in the listing's text. */
function matchesSearch(item: BrowseItem, q: string) {
  const terms = words(q);
  if (!terms.length) return true;
  const haystack = words(
    [item.title, item.description, item.skillName, item.inputType, item.outputType].join(" "),
  );
  return terms.every((t) => haystack.some((w) => w.startsWith(t)));
}

export function browse<T extends BrowseItem>(items: T[], q: BrowseQuery): T[] {
  const filtered = items.filter(
    (i) =>
      matchesSearch(i, q.q) &&
      (!q.type || i.outputType.toLowerCase() === q.type) &&
      (q.minPriceCents === null || i.priceCents >= q.minPriceCents) &&
      (q.maxPriceCents === null || i.priceCents <= q.maxPriceCents) &&
      (q.minScore === null || (i.score ?? -1) >= q.minScore) &&
      (q.maxHours === null || i.turnaroundHours <= q.maxHours),
  );
  const newest = (a: T, b: T) => b.updatedAt.getTime() - a.updatedAt.getTime();
  const by: Record<Sort, (a: T, b: T) => number> = {
    best: (a, b) => (b.score ?? -1) - (a.score ?? -1) || b.rentals - a.rentals || newest(a, b),
    popular: (a, b) => b.rentals - a.rentals || (b.score ?? -1) - (a.score ?? -1),
    rating: (a, b) => (b.rating ?? 0) - (a.rating ?? 0) || b.rentals - a.rentals,
    price_low: (a, b) => a.priceCents - b.priceCents || newest(a, b),
    price_high: (a, b) => b.priceCents - a.priceCents || newest(a, b),
    newest,
  };
  return [...filtered].sort(by[q.sort]);
}

/** The output types on offer, for the type filter. */
export function typeOptions(items: BrowseItem[]): string[] {
  return [...new Set(items.map((i) => i.outputType.trim().toLowerCase()).filter(Boolean))].sort();
}
