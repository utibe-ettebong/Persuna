import { describe, expect, it } from "vitest";
import { PDFDocument } from "pdf-lib";
import { markdownToBlocks, markdownToPdf } from "./pdf";

describe("markdownToBlocks", () => {
  it("maps headings, bullets, tables and prose", () => {
    expect(
      markdownToBlocks("# T\n\n## S\n- one\n- two\n\nA line.\n\n| A | B |\n| - | - |\n| 1 | 2 |"),
    ).toEqual([
      { kind: "h1", text: "T" },
      { kind: "h2", text: "S" },
      { kind: "bullet", text: "one" },
      { kind: "bullet", text: "two" },
      { kind: "text", text: "A line." },
      { kind: "text", text: "A · B" },
      { kind: "text", text: "1 · 2" },
    ]);
  });
});

describe("markdownToPdf", () => {
  it("writes a PDF with the title in its metadata", async () => {
    const buffer = await markdownToPdf("# Standup\n\n- Shipped the fix\n", "Standup notes");
    expect(buffer.subarray(0, 5).toString()).toBe("%PDF-");
    const reloaded = await PDFDocument.load(buffer);
    expect(reloaded.getTitle()).toBe("Standup notes");
    expect(reloaded.getPageCount()).toBe(1);
  });

  it("paginates long documents", async () => {
    const long = Array.from({ length: 200 }, (_, i) => `Line ${i} of the report.`).join("\n\n");
    const buffer = await markdownToPdf(long, "Report");
    const reloaded = await PDFDocument.load(buffer);
    expect(reloaded.getPageCount()).toBeGreaterThan(1);
  });
});
