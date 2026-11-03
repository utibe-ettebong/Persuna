import { describe, expect, it } from "vitest";
import type { ModelRole } from "@/env";
import type { ChatMessage, ModelClient } from "@/lib/models/gateway";
import { extractJson } from "@/lib/models/json";
import {
  draftGrounded,
  extractSheet,
  mapLimit,
  proposeCorrection,
  runTestCase,
  runToolLoop,
  transcribeDocument,
  type ToolCall,
  type ToolOutcome,
  type ToolRunner,
} from "./engine";
import type { Pair, SkillSheet, ToolSpec } from "./types";

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

describe("draftGrounded", () => {
  const input = "Budget: spend to date is 41,500 against 60,000.";
  const claims = (list: [string, string][]) =>
    JSON.stringify({ claims: list.map(([claim, quote]) => ({ claim, quote })) });

  it("rewrites a draft whose statements the input doesn't support, then accepts it", async () => {
    const { client, calls } = fakeClient({
      draft: ["Spend is 99,000.", "Spend to date is 41,500."],
      evaluate: [
        claims([["Spend is 99,000.", ""]]),
        claims([["Spend to date is 41,500.", "spend to date is 41,500"]]),
      ],
    });
    const result = await draftGrounded(client, sheet, [], input);
    expect(result.draft).toBe("Spend to date is 41,500.");
    expect(result.grounding).toEqual({ checked: 1, unsupported: [], redrafts: 1 });
    // The redraft request names exactly the unsupported statement.
    const redraft = calls.filter((c) => c.role === "draft")[1].messages.at(-1)!;
    expect(String(redraft.content)).toContain("- Spend is 99,000.");
  });

  it("revises a delivered version, and accepts facts the client gave in their request", async () => {
    const { client, calls } = fakeClient({
      draft: ["Spend to date is 41,500. Review moved to 3pm Friday."],
      evaluate: [
        claims([
          ["Spend to date is 41,500.", "spend to date is 41,500"],
          ["Review moved to 3pm Friday.", "move the review to 3pm friday"],
        ]),
      ],
    });
    const result = await draftGrounded(client, sheet, [], input, {
      previous: "Spend to date is 41,500.",
      request: "Please add that we move the review to 3pm Friday.",
    });
    expect(result.grounding).toEqual({ checked: 2, unsupported: [], redrafts: 0 });
    const asked = calls.find((c) => c.role === "draft")!.messages;
    // The model sees its earlier version, then the client's request.
    expect(asked.at(-2)).toEqual({ role: "assistant", content: "Spend to date is 41,500." });
    expect(String(asked.at(-1)!.content)).toContain("<change_request>");
  });

  it("stops after two redrafts and reports what's still unsupported", async () => {
    const { client, calls } = fakeClient({
      draft: ["Made up.", "Still made up.", "Made up again."],
      evaluate: [1, 2, 3].map(() => claims([["Approved 75,000.", "approved 75,000"]])),
    });
    const result = await draftGrounded(client, sheet, [], input);
    expect(result.grounding.redrafts).toBe(2);
    expect(result.grounding.unsupported.map((c) => c.claim)).toEqual(["Approved 75,000."]);
    expect(calls.filter((c) => c.role === "draft")).toHaveLength(3);
  });
});

describe("transcribeDocument", () => {
  it("returns each page's text and drops empty pages", async () => {
    const { client, calls } = fakeClient({
      extract: [
        JSON.stringify({
          pages: [
            { page: 1, text: "Ops sync" },
            { page: 2, text: "  " },
          ],
        }),
      ],
    });
    const pages = await transcribeDocument(client, "notes.pdf", {
      type: "file",
      file: { file_id: "file-1" },
    });
    expect(pages).toEqual([{ page: 1, text: "Ops sync" }]);
    const parts = calls[0].messages[1].content as { type: string }[];
    expect(parts.map((p) => p.type)).toEqual(["text", "file"]);
  });
});

const toolSpecs: ToolSpec[] = [
  { name: "notion_search", server: null, description: "Find pages", writes: false },
  { name: "notion_create_page", server: null, description: "Add a page", writes: true },
];

/** A tool runner that replays scripted outcomes and records calls. */
function fakeRunner(outcomes: (ToolOutcome | ((call: ToolCall) => ToolOutcome))[]) {
  const calls: ToolCall[] = [];
  const runner: ToolRunner = {
    list: () => toolSpecs,
    async run(call) {
      calls.push(call);
      const next = outcomes.shift();
      if (!next) throw new Error(`No scripted outcome for ${call.tool}`);
      return typeof next === "function" ? next(call) : next;
    },
  };
  return { runner, calls };
}

const doneStep = (findings: string) => JSON.stringify({ action: "done", findings });
const callStep = (tool: string, args: Record<string, unknown> = {}) =>
  JSON.stringify({ action: "call", tool, server: null, args });

describe("runToolLoop", () => {
  it("calls tools until done, keeping the transcript and findings", async () => {
    const { client } = fakeClient({
      draft: [
        callStep("notion_search", { query: "standup" }),
        doneStep("Found the standup notes."),
      ],
    });
    const { runner, calls } = fakeRunner([
      { status: "done", result: [{ title: "Standup" }], targetId: null, preview: "Search Notion" },
    ]);
    const result = await runToolLoop(client, runner, { brief: "Summarize the standup notes." });
    expect(result.done).toBe(true);
    expect(result.findings).toBe("Found the standup notes.");
    expect(calls).toEqual([{ tool: "notion_search", server: null, args: { query: "standup" } }]);
    expect(result.transcript).toHaveLength(1);
    expect(result.transcript[0]).toMatchObject({ tool: "notion_search", status: "done" });
  });

  it("pauses on pending and re-runs the call when resumed", async () => {
    const { client } = fakeClient({
      draft: [callStep("notion_create_page", { title: "Notes" })],
    });
    const pending: ToolOutcome = {
      status: "pending",
      result: null,
      targetId: null,
      preview: "Add a page",
      approvalId: "appr-1",
    };
    const first = fakeRunner([pending]);
    const paused = await runToolLoop(client, first.runner, { brief: "File the notes." });
    expect(paused.done).toBe(false);
    expect(paused.pending?.approvalId).toBe("appr-1");

    const { client: resumedClient } = fakeClient({ draft: [doneStep("Page created.")] });
    const second = fakeRunner([
      {
        status: "done",
        result: { url: "https://notion.so/x" },
        targetId: "https://notion.so/x",
        preview: "Add a page",
      },
    ]);
    const resumed = await runToolLoop(resumedClient, second.runner, {
      brief: "File the notes.",
      transcript: paused.transcript,
    });
    expect(second.calls).toHaveLength(1);
    expect(resumed.done).toBe(true);
    expect(resumed.transcript).toHaveLength(1);
    expect(resumed.transcript[0]).toMatchObject({
      status: "done",
      targetId: "https://notion.so/x",
    });
  });

  it("feeds errors back so the model can work around them", async () => {
    const { client, calls } = fakeClient({
      draft: [callStep("notion_search"), doneStep("Nothing found; drafted from the brief.")],
    });
    const { runner } = fakeRunner([
      {
        status: "error",
        result: null,
        targetId: null,
        preview: "Search Notion",
        message: "Notion is down",
      },
    ]);
    const result = await runToolLoop(client, runner, { brief: "Summarize." });
    expect(result.done).toBe(true);
    expect(result.transcript[0].status).toBe("error");
    // The second turn saw the failure.
    expect(JSON.stringify(calls[1].messages)).toContain("error");
  });

  it("stops after maxTurns", async () => {
    const { client } = fakeClient({
      draft: [callStep("notion_search"), callStep("notion_search")],
    });
    const { runner } = fakeRunner([
      { status: "done", result: [], targetId: null, preview: "Search" },
      { status: "done", result: [], targetId: null, preview: "Search" },
    ]);
    const result = await runToolLoop(client, runner, { brief: "Summarize.", maxTurns: 1 });
    expect(result.done).toBe(false);
    expect(result.exhausted).toBe(true);
    expect(result.transcript).toHaveLength(1);
  });
});
