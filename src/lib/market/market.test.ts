import { describe, expect, it } from "vitest";
import { browse, isFiltered, parseBrowseQuery, typeOptions, type BrowseItem } from "./browse";
import { isVerified, ratingSummary, shouldPauseListing } from "./rules";

const item = (over: Partial<BrowseItem> & { title: string }): BrowseItem => ({
  description: "",
  skillName: over.title,
  inputType: "notes",
  outputType: "minutes",
  priceCents: 1000,
  turnaroundHours: 24,
  score: 85,
  rentals: 0,
  rating: null,
  updatedAt: new Date("2026-10-01"),
  ...over,
});

describe("Persuna Verified", () => {
  const v = { score: 88, examples: 4, verifiedAt: new Date(), version: 2 };

  it("needs held-back examples and the minimum score", () => {
    expect(isVerified(v, 80)).toBe(true);
    expect(isVerified({ ...v, score: 79.9 }, 80)).toBe(false);
    expect(isVerified({ ...v, examples: 0 }, 80)).toBe(false);
    expect(isVerified(null, 80)).toBe(false);
  });

  it("pauses only live listings that no longer meet the minimum", () => {
    expect(shouldPauseListing(true, 79, 80)).toBe(true);
    expect(shouldPauseListing(true, null, 80)).toBe(true);
    expect(shouldPauseListing(true, 80, 80)).toBe(false);
    expect(shouldPauseListing(false, 10, 80)).toBe(false);
  });
});

describe("ratingSummary", () => {
  it("averages to one decimal and counts each star", () => {
    expect(ratingSummary([5, 4, 4])).toEqual({ count: 3, average: 4.3, stars: [0, 0, 0, 2, 1] });
    expect(ratingSummary([])).toEqual({ count: 0, average: null, stars: [0, 0, 0, 0, 0] });
  });

  it("ignores anything outside 1–5", () => {
    expect(ratingSummary([0, 6, 3.5, 2]).count).toBe(1);
  });
});

describe("parseBrowseQuery", () => {
  it("reads search, filters and sort from the URL", () => {
    expect(
      parseBrowseQuery({
        q: " board minutes ",
        type: "Minutes",
        min: "5",
        max: "12.50",
        score: "90",
        hours: "24",
        sort: "price_low",
      }),
    ).toEqual({
      q: "board minutes",
      type: "minutes",
      minPriceCents: 500,
      maxPriceCents: 1250,
      minScore: 90,
      maxHours: 24,
      sort: "price_low",
    });
  });

  it("ignores malformed values and falls back to the best score first", () => {
    const q = parseBrowseQuery({ min: "-3", score: "abc", hours: "9999", sort: "drop table" });
    expect(q).toMatchObject({
      minPriceCents: null,
      minScore: null,
      maxHours: null,
      sort: "best",
    });
    expect(isFiltered(q)).toBe(false);
    expect(isFiltered(parseBrowseQuery({ q: "x" }))).toBe(true);
  });
});

describe("browse", () => {
  const items = [
    item({ title: "Board minutes", priceCents: 1500, score: 92, rentals: 3 }),
    item({ title: "Grant proposal", outputType: "proposal", priceCents: 4000, score: 81 }),
    item({ title: "Quick summary", priceCents: 500, score: 86, rentals: 9, turnaroundHours: 2 }),
  ];
  const run = (params: Record<string, string>) =>
    browse(items, parseBrowseQuery(params)).map((i) => i.title);

  it("sorts by best score by default", () => {
    expect(run({})).toEqual(["Board minutes", "Quick summary", "Grant proposal"]);
  });

  it("searches by word prefix across the listing", () => {
    expect(run({ q: "prop" })).toEqual(["Grant proposal"]);
    expect(run({ q: "board min" })).toEqual(["Board minutes"]);
    expect(run({ q: "nothing" })).toEqual([]);
  });

  it("filters by type, price, score and turnaround", () => {
    expect(run({ type: "proposal" })).toEqual(["Grant proposal"]);
    expect(run({ min: "10", max: "20" })).toEqual(["Board minutes"]);
    expect(run({ score: "90" })).toEqual(["Board minutes"]);
    expect(run({ hours: "1" })).toEqual([]);
    expect(run({ hours: "2" })).toEqual(["Quick summary"]);
    expect(run({ sort: "price_low" })).toEqual([
      "Quick summary",
      "Board minutes",
      "Grant proposal",
    ]);
  });

  it("sorts by rentals and by price", () => {
    expect(run({ sort: "popular" })[0]).toBe("Quick summary");
    expect(run({ sort: "price_high" })[0]).toBe("Grant proposal");
  });

  it("lists the output types on offer", () => {
    expect(typeOptions(items)).toEqual(["minutes", "proposal"]);
  });
});
