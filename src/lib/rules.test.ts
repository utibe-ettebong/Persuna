import { describe, expect, it } from "vitest";
import { markdownToDocx } from "./docs/docx";
import { changeRatio, classifyEdit } from "./jobs/edit-size";
import { MAX_REVISIONS, listingRequirements, revisionAllowed, splitPayment } from "./market/rules";
import { checkPublish, publishCheckMessage } from "./skill/publish";
import { redact, scanForIdentifiers } from "./skill/redact";

describe("scanForIdentifiers / redact", () => {
  it("finds emails, Nigerian phone numbers, account numbers and links", () => {
    const text =
      "Mail ada@example.org or call 0803 123 4567 / +234 803 123 4567. NUBAN 0123456789, see https://x.test/a";
    const kinds = scanForIdentifiers(text).map((f) => f.kind);
    expect(kinds).toContain("email");
    expect(kinds).toContain("url");
    expect(kinds.filter((k) => k === "phone" || k === "account").length).toBeGreaterThanOrEqual(3);
    const clean = redact(text);
    expect(clean).not.toMatch(/ada@example|4567|0123456789|https/);
    expect(clean).toContain("[EMAIL]");
  });

  it("finds street addresses", () => {
    expect(scanForIdentifiers("Office at 12 Adeola Odeku Street, VI").map((f) => f.kind)).toEqual([
      "address",
    ]);
  });

  it("leaves times, dates and percentages alone", () => {
    expect(scanForIdentifiers("Opened 10:05 on 14 March 2026; spend was 12% over.")).toEqual([]);
  });

  it("does not report the digits inside an email twice", () => {
    expect(scanForIdentifiers("user08031234567@mail.com")).toHaveLength(1);
  });
});

describe("classifyEdit", () => {
  const draft =
    "The Chair opened the meeting at 10:05 and the minutes were approved by all present.";

  it("is none when unchanged, ignoring surrounding whitespace", () => {
    expect(classifyEdit(draft, `  ${draft}\n`)).toBe("none");
  });

  it("is minor for a one-word fix", () => {
    expect(classifyEdit(draft, draft.replace("approved", "accepted"))).toBe("minor");
  });

  it("is major for a rewrite", () => {
    expect(classifyEdit(draft, "Meeting cancelled.")).toBe("major");
  });

  it("measures the share of words changed", () => {
    expect(changeRatio("a b c d", "a b c d")).toBe(0);
    expect(changeRatio("", "new text")).toBe(1);
  });
});

describe("checkPublish", () => {
  it("needs a test run", () => {
    expect(checkPublish(null, null, false)).toEqual({ ok: false, reason: "untested" });
  });

  it("allows the first publish and any improvement", () => {
    expect(checkPublish(60, null, false).ok).toBe(true);
    expect(checkPublish(82, 80, false).ok).toBe(true);
  });

  it("blocks a lower score until the owner confirms", () => {
    const blocked = checkPublish(70, 80, false);
    expect(blocked.ok).toBe(false);
    expect(publishCheckMessage(blocked)).toMatch(/70\.0, lower than the published 80\.0/);
    expect(checkPublish(70, 80, true).ok).toBe(true);
  });
});

describe("splitPayment", () => {
  it("takes the platform fee and gives the owner the rest", () => {
    expect(splitPayment(5000, 20)).toEqual({
      amountCents: 5000,
      platformFeeCents: 1000,
      employerShareCents: 0,
      ownerShareCents: 4000,
    });
  });

  it("gives an approving employer their share of the owner's earnings", () => {
    expect(splitPayment(5000, 20, 25)).toEqual({
      amountCents: 5000,
      platformFeeCents: 1000,
      employerShareCents: 1000,
      ownerShareCents: 3000,
    });
    const s = splitPayment(997, 15, 33);
    expect(s.platformFeeCents + s.employerShareCents + s.ownerShareCents).toBe(997);
    expect(() => splitPayment(1000, 20, 101)).toThrow();
  });

  it("rounds the fee to whole cents without losing any", () => {
    const s = splitPayment(999, 15);
    expect(s.platformFeeCents + s.ownerShareCents).toBe(999);
  });

  it("rejects fractional or non-positive prices", () => {
    expect(() => splitPayment(0, 20)).toThrow();
    expect(() => splitPayment(10.5, 20)).toThrow();
  });
});

describe("listingRequirements", () => {
  it("requires a published version, a passing score and an ownership declaration", () => {
    const base = {
      hasPublishedVersion: true,
      publishedScore: 85,
      ownershipDeclared: true,
      minScore: 80,
    };
    expect(listingRequirements(base).every((r) => r.met)).toBe(true);
    expect(
      listingRequirements({ ...base, publishedScore: 79 }).find((r) => r.key === "score")?.met,
    ).toBe(false);
    expect(
      listingRequirements({ ...base, publishedScore: null }).find((r) => r.key === "score")?.met,
    ).toBe(false);
    expect(
      listingRequirements({ ...base, ownershipDeclared: false }).find((r) => r.key === "ownership")
        ?.met,
    ).toBe(false);
  });
});

describe("markdownToDocx", () => {
  it("produces a Word file from headings, labels, bullets and tables", async () => {
    const md =
      "# Minutes\n\n**Chair:** Ada\n\n- point\n\n| Owner | Action |\n| --- | --- |\n| Musa | Quotes |";
    const buffer = await markdownToDocx(md, "Minutes");
    expect(buffer.subarray(0, 2).toString()).toBe("PK");
    expect(buffer.length).toBeGreaterThan(1000);
  });
});

describe("readUploadedText", () => {
  it("reads back text from a .docx the app generated", async () => {
    const { readUploadedText } = await import("./docs/read-file");
    const buffer = await markdownToDocx("# Notes\n\nKemi opened 4pm.", "Notes");
    const file = new File([new Uint8Array(buffer)], "notes.docx");
    expect(await readUploadedText(file)).toContain("Kemi opened 4pm.");
  });

  it("reads .md and .txt, ignores an empty input and rejects other types", async () => {
    const { readUploadedText } = await import("./docs/read-file");
    expect(await readUploadedText(new File(["  hi \n"], "a.md"))).toBe("hi");
    expect(await readUploadedText(new File([""], "empty.txt"))).toBeNull();
    expect(await readUploadedText(null)).toBeNull();
    await expect(readUploadedText(new File(["x"], "a.pdf"))).rejects.toThrow(
      /\.md, \.txt or \.docx/,
    );
  });
});

describe("revisionAllowed", () => {
  const delivered = { status: "approved", escrow: "held", rounds: 0, complaint: null };
  it("lets a renter ask for changes to a delivered, unsettled order", () => {
    expect(revisionAllowed(delivered)).toEqual({ ok: true });
    expect(revisionAllowed({ ...delivered, rounds: MAX_REVISIONS - 1 })).toEqual({ ok: true });
  });
  it("refuses before delivery, after settling, and past the limit", () => {
    expect(revisionAllowed({ ...delivered, status: "review" }).ok).toBe(false);
    expect(revisionAllowed({ ...delivered, escrow: "released" }).ok).toBe(false);
    expect(revisionAllowed({ ...delivered, complaint: "late" }).ok).toBe(false);
    expect(revisionAllowed({ ...delivered, rounds: MAX_REVISIONS }).ok).toBe(false);
  });
});
