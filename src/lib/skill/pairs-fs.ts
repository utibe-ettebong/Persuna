import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import type { PairWithSplit, SkillDefinition } from "./service";

/**
 * Skill folders on disk look like:
 *
 *   data/skills/<slug>/skill.json
 *   data/skills/<slug>/pairs/train/<pair>.input.md + <pair>.output.md
 *   data/skills/<slug>/pairs/test/<pair>.input.md  + <pair>.output.md
 *
 * Moving a pair between train/ and test/ is how you change the split.
 */
const skillFile = z.object({
  slug: z.string().regex(/^[a-z0-9-]+$/),
  name: z.string().min(1),
  taskDescription: z.string().min(1),
  inputType: z.string().min(1),
  outputType: z.string().min(1),
});

export async function loadSkillFolder(
  dir: string,
): Promise<{ definition: SkillDefinition; pairs: PairWithSplit[] }> {
  const definition = skillFile.parse(
    JSON.parse(await readFile(path.join(dir, "skill.json"), "utf8")),
  );
  const pairs = [
    ...(await loadSplit(path.join(dir, "pairs", "train"), "train")),
    ...(await loadSplit(path.join(dir, "pairs", "test"), "test")),
  ];
  const slugs = new Set<string>();
  for (const pair of pairs) {
    if (slugs.has(pair.slug)) throw new Error(`Pair "${pair.slug}" is in both train/ and test/`);
    slugs.add(pair.slug);
  }
  return { definition, pairs };
}

export async function loadSplit(dir: string, split: "train" | "test"): Promise<PairWithSplit[]> {
  let files: string[];
  try {
    files = await readdir(dir);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw error;
  }

  const inputs = files.filter((f) => f.endsWith(".input.md")).sort();
  const outputs = new Set(files.filter((f) => f.endsWith(".output.md")));
  const orphans = [...outputs].filter(
    (f) => !inputs.includes(f.replace(/\.output\.md$/, ".input.md")),
  );
  const missing = inputs.filter((f) => !outputs.has(f.replace(/\.input\.md$/, ".output.md")));
  if (missing.length || orphans.length) {
    throw new Error(
      `Unmatched files in ${dir}: ${[...missing, ...orphans].join(", ")}. Every <name>.input.md needs a <name>.output.md.`,
    );
  }

  return Promise.all(
    inputs.map(async (file) => {
      const slug = file.replace(/\.input\.md$/, "");
      const [input, output] = await Promise.all([
        readFile(path.join(dir, file), "utf8"),
        readFile(path.join(dir, `${slug}.output.md`), "utf8"),
      ]);
      if (!input.trim() || !output.trim()) throw new Error(`Pair "${slug}" has an empty file`);
      return { slug, split, input: input.trim(), output: output.trim() };
    }),
  );
}
