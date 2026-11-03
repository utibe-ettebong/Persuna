import { describe, expect, it } from "vitest";
import { markdownToOutline, markdownToSlides } from "./pptx";

const DOC = `# Standup

Decided quickly today.

## Shipped
- Login fix
- New invoice export

## Next
1. Refund flow
2. Mobile polish

| Who | Task |
| --- | ---- |
| Ada | Refunds |
`;

describe("markdownToOutline", () => {
  it("maps headings to slides, bullets and tables to lines", () => {
    const slides = markdownToOutline(DOC, "Standup");
    expect(slides.map((s) => s.title)).toEqual(["Standup", "Shipped", "Next"]);
    expect(slides[1].bullets).toEqual(["Login fix", "New invoice export"]);
    expect(slides[2].bullets).toEqual(["Refund flow", "Mobile polish"]);
    expect(slides[2].body).toContain("Ada · Refunds");
    expect(slides[0].body).toContain("Decided quickly today.");
  });

  it("strips Markdown marks", () => {
    const [only] = markdownToOutline("See **bold**, *soft*, `code`, [link](https://x).", "T");
    expect(only.body).toEqual(["See bold, soft, code, link."]);
  });
});

describe("markdownToSlides", () => {
  it("writes a .pptx zip", async () => {
    const buffer = await markdownToSlides(DOC, "Standup notes");
    expect(buffer.subarray(0, 2).toString()).toBe("PK");
    expect(buffer.length).toBeGreaterThan(1000);
  });
});
