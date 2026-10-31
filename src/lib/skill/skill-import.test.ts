import { describe, expect, it } from "vitest";
import { parseSkillMd } from "./skill-import";

const SKILL_MD = `---
name: meeting-minutes
description: Turn rough meeting notes into structured minutes.
---

# Meeting Minutes

## When to use

When notes arrive after a meeting.

## Inputs

Open the notes and the attendee list.

## Steps

1. Read the notes once.
2. Write decisions, then actions.

## Output

Decisions, actions with owners, open questions.
`;

describe("parseSkillMd", () => {
  it("reads the frontmatter and maps sections to layers", () => {
    const parsed = parseSkillMd(SKILL_MD);
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.value.name).toBe("meeting-minutes");
    expect(parsed.value.description).toBe("Turn rough meeting notes into structured minutes.");
    expect(parsed.value.layers[1]).toContain("When notes arrive");
    expect(parsed.value.layers[2]).toContain("attendee list");
    expect(parsed.value.layers[5]).toContain("Read the notes");
    expect(parsed.value.layers[6]).toContain("open questions");
    expect(parsed.value.methodNotes).toContain("Read the notes");
  });

  it("reads plain markdown without frontmatter", () => {
    const parsed = parseSkillMd(
      "# Invoices\n\nTurn bills into rows.\n\n## Steps\n\nRead each bill.\n",
    );
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.value.name).toBe("Invoices");
    expect(parsed.value.description).toBe("Turn bills into rows.");
    expect(parsed.value.layers[5]).toContain("Read each bill");
  });

  it("refuses files without a name, a task, or anything to learn", () => {
    expect(parseSkillMd("nothing here").ok).toBe(false);
    expect(parseSkillMd("---\nname: x\n---\n").ok).toBe(false);
    const noFrontmatter = parseSkillMd("# Title only");
    expect(noFrontmatter.ok).toBe(false);
  });

  it("caps runaway files", () => {
    const big = `---\nname: big\ndescription: A big skill file.\n---\n\n## Steps\n\n${"do it.\n".repeat(5000)}`;
    const parsed = parseSkillMd(big);
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.value.methodNotes.length).toBeLessThanOrEqual(8000);
  });
});
