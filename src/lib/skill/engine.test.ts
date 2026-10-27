import { describe, expect, it } from "vitest";
import type { ModelRole } from "@/env";
import type { ChatMessage, ModelClient } from "@/lib/models/gateway";
import { extractJson } from "@/lib/models/json";
import { extractSheet, mapLimit, proposeCorrection, runTestCase } from "./engine";
import type { Pair, SkillSheet } from "./types";

type Reply = string | ((messages: ChatMessage[]) => string);

/** A model client that replays scripted replies per role and records calls. */
function fakeClient(replies: Partial<Record<ModelRole, Reply[]>>) {
  const calls: { role: ModelRole; messages: ChatMessage[] }[] = [];
  const client: ModelClient = {
    async complete(role, messages) {
      calls.push({ role, messages });
      const next = replies[role]?.shift();
      if (next === undefined) throw new Error(`No scripted reply for ${role}`);
      const text = typeof next === "function" ? next(messages) : next;
      return { text, model: `fake-${role}`, promptTokens: 10, completionTokens: 5 };
    },
  };
  return { client, calls };
}

const meta = {
  name: "Minutes",
  taskDescription: "Notes to minutes",
  inputType: "notes",
  outputType: "minutes",
};

const sheet: SkillSheet = {
  summary: "Formal minutes.",
  rules: [{ id: "R1", category: "structure", text: "Use a header block." }],
  template: "# Minutes",
};

const pairs: Pair[] = [
  { id: "a", slug: "a", input: "budget fuel", output: "# Minutes: Budget" },
  { id: "b", slug: "b", input: "hiring plan", output: "# Minutes: Hiring" },
];

const evaluation = JSON.stringify({
  criteria: { structure: 8, content: 9, cuts: 7, tone: 8, naming: 6 },
  missing: [],
  extra: ["a joke"],
  ruleViolations: [],
  rationale: "Close.",
});

describe("extractJson", () => {
  it("reads JSON wrapped in a code fence with prose around it", () => {
    expect(extractJson('Here you go:\n```json\n{"a": 1}\n```\nDone')).toEqual({ a: 1 });
  });

  it("throws when there is no object", () => {
    expect(() => extractJson("no json here")).toThrow(SyntaxError);
  });
});

describe("extractSheet", () => {
  it("parses the model's sheet and sends every training pair", async () => {
    const { client, calls } = fakeClient({ extract: [JSON.stringify(sheet)] });
    const result = await extractSheet(client, meta, pairs);
    expect(result.sheet).toEqual(sheet);
    expect(calls[0].messages[1].content).toContain("budget fuel");
    expect(calls[0].messages[1].content).toContain("# Minutes: Hiring");
  });

  it("asks the model to repair invalid JSON once", async () => {
    const { client, calls } = fakeClient({
      extract: ['{"summary": "missing rules"}', JSON.stringify(sheet)],
    });
    const result = await extractSheet(client, meta, pairs);
    expect(result.sheet.rules).toHaveLength(1);
    expect(calls).toHaveLength(2);
    expect(result.completion.promptTokens).toBe(20);
  });

  it("gives up after a second invalid reply", async () => {
    const { client } = fakeClient({ extract: ["nope", "still nope"] });
    await expect(extractSheet(client, meta, pairs)).rejects.toThrow(/invalid JSON twice/);
  });

  it("refuses to run with no training pairs", async () => {
    const { client } = fakeClient({});
    await expect(extractSheet(client, meta, [])).rejects.toThrow(/at least one/);
  });
});

describe("runTestCase", () => {
  it("drafts with the closest examples, scores against the reference, and sums usage", async () => {
    const { client, calls } = fakeClient({
      draft: ["# Minutes: Budget draft"],
      evaluate: [evaluation],
    });
    const test: Pair = { id: "t", slug: "t", input: "fuel budget again", output: "# Minutes: Ref" };
    const result = await runTestCase(client, sheet, pairs, test, 1);

    expect(result.shots.map((s) => s.slug)).toEqual(["a"]);
    expect(result.draft).toBe("# Minutes: Budget draft");
    expect(result.score).toBe(78);
    expect(result.promptTokens).toBe(20);
    // The evaluator sees the reference; the drafter never does.
    expect(calls[0].messages.map((m) => m.content).join()).not.toContain("# Minutes: Ref");
    expect(calls[1].messages[1].content).toContain("# Minutes: Ref");
  });

  it("fails loudly on an empty draft", async () => {
    const { client } = fakeClient({ draft: ["   "] });
    await expect(runTestCase(client, sheet, pairs, pairs[0])).rejects.toThrow(/returned nothing/);
  });
});

describe("proposeCorrection", () => {
  it("applies the proposed rule ops to produce the next sheet", async () => {
    const { client } = fakeClient({
      extract: [
        JSON.stringify({
          explanation: "Wants a table.",
          ops: [{ op: "add", category: "formatting", text: "Put actions in a table." }],
          templateChange: null,
        }),
      ],
    });
    const result = await proposeCorrection(client, sheet, "in", "draft", "edited", "tables");
    expect(result.sheet.rules.map((r) => r.id)).toEqual(["R1", "R2"]);
  });

  it("rejects proposals that reference rules that don't exist", async () => {
    const { client } = fakeClient({
      extract: [JSON.stringify({ explanation: "x", ops: [{ op: "remove", id: "R9" }] })],
    });
    await expect(proposeCorrection(client, sheet, "in", "draft", "edited", "")).rejects.toThrow(
      /unknown rules: R9/,
    );
  });

  it("rejects an edit that changes nothing", async () => {
    const { client } = fakeClient({});
    await expect(proposeCorrection(client, sheet, "in", "same", " same ", "")).rejects.toThrow();
  });
});

describe("mapLimit", () => {
  it("keeps order and never exceeds the limit", async () => {
    let active = 0;
    let peak = 0;
    const out = await mapLimit([5, 1, 3, 2], 2, async (n) => {
      active++;
      peak = Math.max(peak, active);
      await new Promise((r) => setTimeout(r, n));
      active--;
      return n * 10;
    });
    expect(out).toEqual([50, 10, 30, 20]);
    expect(peak).toBe(2);
  });
});
