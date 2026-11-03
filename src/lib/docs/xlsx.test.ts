import { describe, expect, it } from "vitest";
import ExcelJS from "exceljs";
import { looksLikeCsv, parseCsv } from "./csv";
import { csvToXlsx } from "./xlsx";

describe("parseCsv", () => {
  it("reads headers, quoted commas and doubled quotes", () => {
    expect(parseCsv('name,note\nAda,"ship, then rest"\n"Bo ""B""",ok')).toEqual([
      ["name", "note"],
      ["Ada", "ship, then rest"],
      ['Bo "B"', "ok"],
    ]);
  });

  it("drops blank lines", () => {
    expect(parseCsv("a,b\n\nc,d\n")).toEqual([
      ["a", "b"],
      ["c", "d"],
    ]);
  });
});

describe("looksLikeCsv", () => {
  it("spots tables and passes prose by", () => {
    expect(looksLikeCsv("a,b\nc,d")).toBe(true);
    expect(looksLikeCsv("Just a paragraph.\nAnother one.")).toBe(false);
    expect(looksLikeCsv("one")).toBe(false);
  });
});

describe("csvToXlsx", () => {
  it("writes a sheet that reads back with its header and cells", async () => {
    const buffer = await csvToXlsx("name,price\nAda,12\nBo,7", "Price list");
    const book = new ExcelJS.Workbook();
    await book.xlsx.load(buffer as unknown as ArrayBuffer);
    const sheet = book.getWorksheet("Price list")!;
    expect(sheet.getCell("A1").value).toBe("name");
    expect(sheet.getCell("A1").font.bold).toBe(true);
    expect(sheet.getCell("B3").value).toBe(7);
    expect(sheet.rowCount).toBe(3);
  });
});
