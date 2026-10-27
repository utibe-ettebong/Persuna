import {
  Document,
  HeadingLevel,
  Packer,
  Paragraph,
  Table,
  TableCell,
  TableRow,
  TextRun,
  WidthType,
} from "docx";

/**
 * Converts the markdown the skills produce (headings, bold labels, bullets,
 * pipe tables, paragraphs) into a real Word document.
 */
export async function markdownToDocx(markdown: string, title: string): Promise<Buffer> {
  const children: (Paragraph | Table)[] = [];
  const lines = markdown.replace(/\r\n/g, "\n").split("\n");

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (!line.trim()) continue;

    if (isTableRow(line)) {
      const rows: string[][] = [];
      while (i < lines.length && isTableRow(lines[i])) {
        if (!/^\|[\s:|-]+\|\s*$/.test(lines[i])) rows.push(splitRow(lines[i]));
        i++;
      }
      i--;
      children.push(table(rows));
      continue;
    }

    const heading = line.match(/^(#{1,3})\s+(.*)$/);
    if (heading) {
      const level = [HeadingLevel.HEADING_1, HeadingLevel.HEADING_2, HeadingLevel.HEADING_3][
        heading[1].length - 1
      ];
      children.push(new Paragraph({ heading: level, children: inline(heading[2]) }));
      continue;
    }

    const bullet = line.match(/^\s*[-*]\s+(.*)$/);
    if (bullet) {
      children.push(new Paragraph({ bullet: { level: 0 }, children: inline(bullet[1]) }));
      continue;
    }

    children.push(new Paragraph({ children: inline(line.trim()), spacing: { after: 120 } }));
  }

  const doc = new Document({ title, sections: [{ children }] });
  return Packer.toBuffer(doc);
}

const isTableRow = (line: string) => /^\s*\|.*\|\s*$/.test(line);

const splitRow = (line: string) =>
  line
    .trim()
    .replace(/^\||\|$/g, "")
    .split("|")
    .map((c) => c.trim());

function table(rows: string[][]): Table {
  const width = Math.max(...rows.map((r) => r.length));
  return new Table({
    width: { size: 100, type: WidthType.PERCENTAGE },
    rows: rows.map(
      (cells, r) =>
        new TableRow({
          tableHeader: r === 0,
          children: Array.from(
            { length: width },
            (_, c) =>
              new TableCell({
                children: [
                  new Paragraph({
                    children:
                      r === 0
                        ? [new TextRun({ text: cells[c] ?? "", bold: true })]
                        : inline(cells[c] ?? ""),
                  }),
                ],
              }),
          ),
        }),
    ),
  });
}

/** **bold** spans become bold runs; everything else is plain text. */
export function inline(text: string): TextRun[] {
  return text
    .split(/(\*\*[^*]+\*\*)/g)
    .filter(Boolean)
    .map((part) =>
      part.startsWith("**") && part.endsWith("**")
        ? new TextRun({ text: part.slice(2, -2), bold: true })
        : new TextRun(part),
    );
}
