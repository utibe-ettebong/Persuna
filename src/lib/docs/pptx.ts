import PptxGenJS from "pptxgenjs";

/** One slide: a heading with bullets and plain lines. */
export interface Slide {
  title: string;
  bullets: string[];
  body: string[];
}

/**
 * A Markdown document as slides: the title opens, each ## section becomes
 * one slide (bullets first, then paragraphs), pipe tables flatten to lines.
 */
export function markdownToOutline(markdown: string, title: string): Slide[] {
  const slides: Slide[] = [{ title, bullets: [], body: [] }];
  const lines = markdown.replace(/\r\n/g, "\n").split("\n");
  for (const raw of lines) {
    const line = raw.trim();
    if (!line || line.startsWith("# ")) continue;
    const section = line.match(/^#{2,3}\s+(.*)/);
    if (section) {
      slides.push({ title: clean(section[1]), bullets: [], body: [] });
      continue;
    }
    const bullet = line.match(/^[-*]\s+(.*)/) ?? line.match(/^\d+[.)]\s+(.*)/);
    const current = slides.at(-1)!;
    if (bullet) current.bullets.push(clean(bullet[1]));
    else if (line.startsWith("|")) {
      const cells = line
        .split("|")
        .slice(1, -1)
        .map((c) => clean(c))
        .filter((c) => c && !/^[:|-]+$/.test(c));
      if (cells.length) current.body.push(cells.join(" · "));
    } else current.body.push(clean(line));
  }
  return slides;
}

/** Markdown bold/italic/code/links as plain slide text. */
function clean(text: string): string {
  return text
    .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
    .replace(/(\*\*|__)(.*?)\1/g, "$2")
    .replace(/(\*|_)(.*?)\1/g, "$2")
    .replace(/`([^`]+)`/g, "$1")
    .trim();
}

/** The outline above as a real .pptx: title slide, then one slide per section. */
export async function markdownToSlides(markdown: string, title: string): Promise<Buffer> {
  const deck = new PptxGenJS();
  deck.title = title;
  deck.author = "Persuna";
  for (const [i, slide] of markdownToOutline(markdown, title).entries()) {
    const page = deck.addSlide();
    page.addText(slide.title, {
      x: 0.5,
      y: i === 0 ? 2.2 : 0.4,
      w: 9,
      h: 1,
      fontSize: i === 0 ? 40 : 32,
      bold: true,
      align: i === 0 ? "center" : "left",
      color: "1D161D",
    });
    const lines: PptxGenJS.TextProps[] = [
      ...slide.bullets.map((b) => ({ text: b, options: { bullet: true, fontSize: 18 } })),
      ...slide.body.map((b) => ({ text: b, options: { fontSize: 18, paraSpaceAfter: 6 } })),
    ];
    if (lines.length) page.addText(lines, { x: 0.7, y: 1.6, w: 8.6, h: 3.6, color: "1D161D" });
  }
  const out = await deck.write({ outputType: "nodebuffer" });
  return out as Buffer;
}
