/**
 * Other agents' skill files (SKILL.md and similar markdown) into the six-layer
 * model: the frontmatter names the skill, sections map to layers by their
 * headings, and the steps become method notes. Pure, so it is tested without
 * a database. What it makes is marked imported until the skill is tested.
 */
import type { Layer } from "./interview";

/** Largest file read, in bytes. */
export const MAX_SKILL_MD_BYTES = 200_000;
/** Longest text kept per layer or for the method. */
const MAX_LAYER_CHARS = 4000;

export interface SkillMd {
  name: string;
  description: string;
  /** One text per layer that had a matching section. */
  layers: Partial<Record<Layer, string>>;
  /** The steps, as method notes. */
  methodNotes: string;
}

/** Heading words that place a section in a layer, in priority order. Layers match the interview. */
const LAYER_WORDS: { layer: Layer; words: string[] }[] = [
  { layer: 1, words: ["trigger", "when to use", "overview", "use this when"] },
  { layer: 2, words: ["input", "context", "prerequisite", "read first", "before you start"] },
  { layer: 3, words: ["decisions", "branches", "choices", "paths", "conditions", "procedure"] },
  { layer: 4, words: ["tools", "prompts", "commands", "usage", "api", "cli", "options"] },
  {
    layer: 5,
    words: [
      "steps",
      "process",
      "how to",
      "instructions",
      "method",
      "standards",
      "checks",
      "rules",
      "quality",
      "validation",
      "constraints",
      "style",
    ],
  },
  { layer: 6, words: ["output", "handoff", "result", "format", "deliverable"] },
];

function layerOf(heading: string): Layer | null {
  const lower = heading.toLowerCase();
  for (const { layer, words } of LAYER_WORDS) {
    if (words.some((word) => lower.includes(word))) return layer;
  }
  return null;
}

interface Section {
  heading: string;
  body: string;
}

function sectionsOf(markdown: string): Section[] {
  const sections: Section[] = [];
  let heading = "";
  let lines: string[] = [];
  for (const line of markdown.split(/\r?\n/)) {
    const match = /^(#{1,3})\s+(.*)$/.exec(line.trim());
    if (match) {
      if (lines.join("\n").trim()) sections.push({ heading, body: lines.join("\n").trim() });
      heading = match[2]!.trim();
      lines = [];
    } else {
      lines.push(line);
    }
  }
  if (lines.join("\n").trim()) sections.push({ heading, body: lines.join("\n").trim() });
  return sections;
}

function frontmatter(text: string): { name?: string; description?: string; rest: string } {
  const match = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/.exec(text.trim());
  if (!match) return { rest: text };
  const fields: Record<string, string> = {};
  for (const line of match[1]!.split(/\r?\n/)) {
    const field = /^([A-Za-z_]+):\s*(.+)$/.exec(line.trim());
    if (field) fields[field[1]!.toLowerCase()] = field[2]!.trim().replace(/^["']|["']$/g, "");
  }
  return { name: fields.name, description: fields.description, rest: match[2] ?? "" };
}

/** Parses a SKILL.md (or similar markdown) file into the six-layer model. */
export function parseSkillMd(
  text: string,
): { ok: true; value: SkillMd } | { ok: false; errors: string[] } {
  if (!text || text.length > MAX_SKILL_MD_BYTES) {
    return { ok: false, errors: ["That file is empty or over 200 KB."] };
  }
  const { name: frontName, description: frontDescription, rest } = frontmatter(text);
  const sections = sectionsOf(rest);
  const name = frontName?.slice(0, 80) || sections[0]?.heading.slice(0, 80) || "";
  const description =
    frontDescription?.slice(0, 1000) ||
    sections
      .find((section) => section.body)
      ?.body.split(/\n+/)[0]
      ?.slice(0, 1000) ||
    "";
  if (name.trim().length < 2) return { ok: false, errors: ["Name the skill in the file."] };
  if (description.trim().length < 10) {
    return { ok: false, errors: ["Say what the skill does in a sentence or two."] };
  }
  const layers: Partial<Record<Layer, string>> = {};
  for (const section of sections) {
    const layer = layerOf(section.heading);
    if (!layer) continue;
    const combined = [layers[layer], section.body].filter(Boolean).join("\n\n");
    layers[layer] = combined.slice(0, MAX_LAYER_CHARS);
  }
  const methodNotes = [layers[5], layers[3], layers[6]].filter(Boolean).join("\n\n").slice(0, 8000);
  if (Object.keys(layers).length === 0) {
    return {
      ok: false,
      errors: ["No usable sections: add steps, inputs or outputs under ## headings."],
    };
  }
  return {
    ok: true,
    value: { name: name.trim(), description: description.trim(), layers, methodNotes },
  };
}
