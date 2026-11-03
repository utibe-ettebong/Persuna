import ExcelJS from "exceljs";
import { parseCsv } from "./csv";

/**
 * A CSV table (header row first, as make_file writes them) as a real
 * spreadsheet: bold header, sized columns, one sheet named for the title.
 */
export async function csvToXlsx(csv: string, title: string): Promise<Buffer> {
  const rows = parseCsv(csv);
  const book = new ExcelJS.Workbook();
  book.creator = "Persuna";
  book.title = title;
  const sheet = book.addWorksheet(title.slice(0, 31) || "Sheet", {
    views: [{ state: "frozen", ySplit: 1 }],
  });
  const widths: number[] = [];
  for (const [i, row] of rows.entries()) {
    const added = sheet.addRow(row.map((c) => (/^-?\d+(\.\d+)?$/.test(c) ? Number(c) : c)));
    if (i === 0) added.font = { bold: true };
    row.forEach((cell, j) => {
      widths[j] = Math.min(60, Math.max(widths[j] ?? 10, String(cell).length + 2));
    });
  }
  sheet.columns = widths.map((width) => ({ width }));
  return Buffer.from(await book.xlsx.writeBuffer());
}
