import { RULE_CATEGORIES, type RuleOp, type SkillSheet } from "./types";

const CATEGORY_TITLES: Record<(typeof RULE_CATEGORIES)[number], string> = {
  structure: "Structure",
  content: "What goes in",
  cut: "What gets cut",
  tone: "Tone",
  naming: "Naming conventions",
  formatting: "Formatting",
};

/** Renders a skill sheet as the markdown the owner reads and the drafter follows. */
export function renderSheet(sheet: SkillSheet): string {
  const sections = RULE_CATEGORIES.map((category) => {
    const rules = sheet.rules.filter((r) => r.category === category);
    if (rules.length === 0) return null;
    const lines = rules.map((r) => `- [${r.id}] ${r.text}`).join("\n");
    return `### ${CATEGORY_TITLES[category]}\n${lines}`;
  }).filter(Boolean);

  return [
    `## Summary\n${sheet.summary}`,
    `## Rules\n${sections.join("\n\n")}`,
    `## Output template\n\`\`\`\n${sheet.template}\n\`\`\``,
  ].join("\n\n");
}

/**
 * Applies rule operations deterministically. Unknown ids are reported rather
 * than silently ignored so a bad model proposal can't vanish without trace.
 */
export function applyRuleOps(
  sheet: SkillSheet,
  ops: RuleOp[],
  templateChange?: string | null,
): { sheet: SkillSheet; unknownIds: string[] } {
  const rules = sheet.rules.map((r) => ({ ...r }));
  const unknownIds: string[] = [];
  let nextId = Math.max(0, ...rules.map((r) => Number(r.id.slice(1)))) + 1;

  for (const op of ops) {
    if (op.op === "add") {
      rules.push({ id: `R${nextId++}`, category: op.category, text: op.text });
      continue;
    }
    const index = rules.findIndex((r) => r.id === op.id);
    if (index === -1) {
      unknownIds.push(op.id);
      continue;
    }
    if (op.op === "remove") {
      rules.splice(index, 1);
    } else {
      rules[index] = {
        ...rules[index],
        text: op.text,
        category: op.category ?? rules[index].category,
      };
    }
  }

  return {
    sheet: { ...sheet, rules, template: templateChange?.trim() || sheet.template },
    unknownIds,
  };
}
