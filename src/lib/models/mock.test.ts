import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import { extractSheet, proposeCorrection, runTestCase } from "@/lib/skill/engine";
import type { Pair } from "@/lib/skill/types";
import { createMockClient } from "./mock";

const dir = "data/skills/meeting-minutes/pairs";
const read = (p: string) => readFile(p, "utf8");

async function samplePairs(): Promise<{ train: Pair; test: Pair }> {
  const train = "sample-01-budget-review";
  const test = "sample-02-outreach-planning";
  return {
    train: {
      id: "a",
      slug: train,
      input: await read(`${dir}/train/${train}.input.md`),
      output: await read(`${dir}/train/${train}.output.md`),
    },
    test: {
      id: "b",
      slug: test,
      input: await read(`${dir}/test/${test}.input.md`),
      output: await read(`${dir}/test/${test}.output.md`),
    },
  };
}

const meta = {
  name: "Minutes",
  taskDescription: "Notes to minutes",
  inputType: "notes",
  outputType: "minutes",
};

describe("mock models run the whole loop through the real engine", () => {
  it("extracts a valid sheet, drafts, scores and proposes a correction", async () => {
    const client = createMockClient();
    const { train, test } = await samplePairs();

    const { sheet } = await extractSheet(client, meta, [train]);
    expect(sheet.rules.length).toBeGreaterThan(2);
    expect(sheet.template).toContain("## Action items");

    const result = await runTestCase(client, sheet, [train], test);
    expect(result.draft).toContain("# Minutes:");
    expect(result.draft).toContain("| Owner | Action | Due |");
    expect(result.draft).not.toMatch(/car is in the shop/);
    expect(result.score).toBeGreaterThan(0);
    expect(result.score).toBeLessThanOrEqual(100);

    const corrected = await proposeCorrection(
      client,
      sheet,
      test.input,
      result.draft,
      `${result.draft}\n\n## Close\nThe meeting closed.`,
      "Always end with a Close section",
    );
    expect(corrected.sheet.rules.length).toBeGreaterThan(sheet.rules.length);
  });

  it("is deterministic", async () => {
    const { train, test } = await samplePairs();
    const a = await runTestCase(
      createMockClient(),
      (await extractSheet(createMockClient(), meta, [train])).sheet,
      [train],
      test,
    );
    const b = await runTestCase(
      createMockClient(),
      (await extractSheet(createMockClient(), meta, [train])).sheet,
      [train],
      test,
    );
    expect(a.draft).toBe(b.draft);
    expect(a.score).toBe(b.score);
  });
});
