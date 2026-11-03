import { PDFDocument, StandardFonts, type PDFFont, type PDFPage } from "pdf-lib";

const PAGE_W = 595; // A4
const PAGE_H = 842;
const MARGIN = 56;
const BODY = 11;
const LEADING = 16;

interface Block {
  kind: "h1" | "h2" | "bullet" | "text";
  text: string;
}

/** Markdown headings, bullets and paragraphs as printable blocks. */
export function markdownToBlocks(markdown: string): Block[] {
  const blocks: Block[] = [];
  for (const raw of markdown.replace(/\r\n/g, "\n").split("\n")) {
    const line = raw.trim();
    if (!line) continue;
    const h1 = line.match(/^#\s+(.*)/);
    if (h1) {
      blocks.push({ kind: "h1", text: clean(h1[1]) });
      continue;
    }
    const h2 = line.match(/^#{2,3}\s+(.*)/);
    if (h2) {
      blocks.push({ kind: "h2", text: clean(h2[1]) });
      continue;
    }
    const bullet = line.match(/^[-*]\s+(.*)/) ?? line.match(/^\d+[.)]\s+(.*)/);
    if (bullet) {
      blocks.push({ kind: "bullet", text: clean(bullet[1]) });
      continue;
    }
    if (line.startsWith("|")) {
      const cells = line
        .split("|")
        .slice(1, -1)
        .map((c) => clean(c))
        .filter((c) => c && !/^[:|-]+$/.test(c));
      if (cells.length) blocks.push({ kind: "text", text: cells.join(" · ") });
      continue;
    }
    blocks.push({ kind: "text", text: clean(line) });
  }
  return blocks;
}

function clean(text: string): string {
  return text
    .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
    .replace(/(\*\*|__)(.*?)\1/g, "$2")
    .replace(/(\*|_)(.*?)\1/g, "$2")
    .replace(/`([^`]+)`/g, "$1")
    .trim();
}

function wrap(font: PDFFont, size: number, text: string): string[] {
  const words = text.split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let line = "";
  for (const word of words) {
    const next = line ? `${line} ${word}` : word;
    if (font.widthOfTextAtSize(next, size) > PAGE_W - MARGIN * 2 && line) {
      lines.push(line);
      line = word;
    } else line = next;
  }
  if (line) lines.push(line);
  return lines;
}

/** A Markdown document as a paginated PDF with the title in its metadata. */
export async function markdownToPdf(markdown: string, title: string): Promise<Buffer> {
  const doc = await PDFDocument.create();
  doc.setTitle(title);
  doc.setProducer("Persuna");
  const regular = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  let page: PDFPage = doc.addPage([PAGE_W, PAGE_H]);
  let y = PAGE_H - MARGIN;
  const draw = (font: PDFFont, size: number, text: string, indent = 0, gap = LEADING) => {
    for (const line of wrap(font, size, text)) {
      if (y < MARGIN + size) {
        page = doc.addPage([PAGE_W, PAGE_H]);
        y = PAGE_H - MARGIN;
      }
      page.drawText(line, { x: MARGIN + indent, y, size, font });
      y -= gap;
    }
  };
  draw(bold, 22, title, 0, 30);
  y -= 6;
  for (const block of markdownToBlocks(markdown)) {
    if (block.kind === "h1") draw(bold, 17, block.text, 0, 24);
    else if (block.kind === "h2") draw(bold, 13, block.text, 0, 20);
    else if (block.kind === "bullet") draw(regular, BODY, `•  ${block.text}`, 14);
    else draw(regular, BODY, block.text);
    if (block.kind !== "bullet") y -= 4;
  }
  return Buffer.from(await doc.save());
}
