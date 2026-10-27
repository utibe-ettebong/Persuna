/**
 * Offline stand-in for the real models, used when MODEL_PROVIDER=mock (the
 * default when no API key is set). It is deterministic and reads the same
 * prompts the real models get, so every screen and the whole loop work
 * without keys. Its drafts are rough and its scores are plain text
 * similarity: good for building and demoing the flow, not for judging a skill.
 */
import { tokenize } from "@/lib/skill/retrieve";
import type { RuleCategory } from "@/lib/skill/types";
import type { ChatMessage, ModelClient } from "./gateway";

export const MOCK_MODEL = "mock";

export function createMockClient(): ModelClient {
  return {
    async complete(role, messages) {
      const user = messages.findLast((m) => m.role === "user")?.content ?? "";
      const system = messages.find((m) => m.role === "system")?.content ?? "";
      let text: string;
      if (role === "draft") text = mockDraft(user, system);
      else if (user.includes("<self_check_draft>")) text = JSON.stringify(mockSelfCheck(user));
      else if (role === "evaluate") text = JSON.stringify(mockEvaluate(user));
      else if (user.includes("<redact_text>")) text = JSON.stringify(mockEntities(user));
      else if (user.includes("<method_notes>")) text = JSON.stringify(mockMethodNotes(user));
      else if (user.includes("<corrected_version>")) text = JSON.stringify(mockCorrection(user));
      else text = JSON.stringify(mockExtract(user));
      return {
        text,
        model: MOCK_MODEL,
        promptTokens: estimateTokens(messages),
        completionTokens: Math.ceil(text.length / 4),
      };
    },
  };
}

function estimateTokens(messages: ChatMessage[]): number {
  return Math.ceil(messages.reduce((n, m) => n + m.content.length, 0) / 4);
}

export function blocks(text: string, tag: string): string[] {
  const re = new RegExp(`<${tag}>\\n?([\\s\\S]*?)\\n?</${tag}>`, "g");
  return [...text.matchAll(re)].map((m) => m[1].trim());
}

const headingsOf = (md: string) =>
  md
    .split("\n")
    .filter((l) => /^#{2,3}\s/.test(l))
    .map((l) =>
      l
        .replace(/^#+\s*/, "")
        .replace(/^\d+\.\s*/, "")
        .trim(),
    );

/** Bold labels in the header block, i.e. before the first section heading. */
const labelsOf = (md: string) =>
  [...(md.split(/^##\s/m)[0] ?? "").matchAll(/^\*\*([^*:]+):\*\*/gm)].map((m) => m[1].trim());

/** Items present in every list (all of them when there is only one). */
const common = (lists: string[][]) =>
  lists.length === 0 ? [] : lists[0].filter((x) => lists.every((l) => l.includes(x)));

function mockExtract(user: string) {
  const outputs = blocks(user, "finished_output");
  const first = outputs[0] ?? "# Output";
  const headings = common(outputs.map(headingsOf));
  const labels = common(outputs.map(labelsOf));
  const usesTable = outputs.some((o) => /^\|.*\|\s*$/m.test(o));
  const tableHeader = first
    .match(/^\|(.+)\|\s*$/m)?.[1]
    .split("|")
    .map((c) => c.trim());

  const rules: { category: RuleCategory; text: string }[] = [];
  if (labels.length) {
    rules.push({
      category: "structure",
      text: `Open with a header block of bold labels: ${labels.join(", ")}.`,
    });
  }
  if (headings.length) {
    rules.push({
      category: "structure",
      text: `Use these sections in this order: ${headings.join(" → ")}.`,
    });
  }
  if (usesTable && tableHeader) {
    rules.push({
      category: "formatting",
      text: `List action items in a table with columns ${tableHeader.join(" | ")}.`,
    });
  }
  rules.push(
    {
      category: "cut",
      text: "Leave out jokes, asides and remarks that led to no decision or action.",
    },
    {
      category: "content",
      text: "Record every decision as a separate line starting with **Decision:**.",
    },
    { category: "tone", text: "Write in the third person and past tense." },
  );

  let seenTableHeader = false;
  const template = first
    .split("\n")
    .map((line) => {
      if (/^#\s/.test(line)) return line.replace(/:.*$/, ": …");
      if (/^#{2,3}\s/.test(line) || /^\|[\s-|]+\|$/.test(line)) return line;
      if (/^\|/.test(line) && !seenTableHeader) {
        seenTableHeader = true;
        return line;
      }
      if (/^\*\*[^*]+:\*\*/.test(line)) return line.replace(/(\*\*[^*]+:\*\*).*/, "$1 …");
      if (/^\|/.test(line)) return line.replace(/[^|]+/g, (cell) => (cell.trim() ? " … " : cell));
      return line.trim() ? "…" : "";
    })
    .filter((line, i, all) => !(line === "…" && all[i - 1] === "…"))
    .join("\n");

  return {
    summary: `Finished output with ${headings.length || "no"} section headings${usesTable ? " and an action table" : ""}. Extracted by the offline mock model from ${outputs.length} example(s).`,
    rules: rules.map((r, i) => ({ id: `R${i + 1}`, ...r })),
    template,
  };
}

const ACTION = /\b(to|will|shall|should)\b\s+\w+/i;
const DECISION = /\b(agreed|decided|decision|approved|resolved)\b/i;
const NOISE = /\b(lol|haha|not relevant|off topic|joke)\b|\bAOB\b.*\b(broken|lunch|weather)\b/i;
const DUE =
  /\b(by\s+[\w\s]+?|end of (the )?(week|month)|this (week|wk|month)|next (week|wk)|mon(day)?|tue(s(day)?)?|wed(nesday)?|thu(rs(day)?)?|fri(day)?|\d{1,2}(st|nd|rd|th)?)\s*$/i;

function mockDraft(user: string, system: string): string {
  const inputs = blocks(user, "input");
  const input = inputs[inputs.length - 1] ?? "";
  const lines = input
    .split("\n")
    .map((l) => l.replace(/^[-*•]\s*/, "").trim())
    .filter(Boolean);

  const title = titleCase(lines[0]?.replace(/\b(mtg|meeting|call)\b.*$/i, "").trim() || "Meeting");
  const presentLine = lines.find((l) => /^(present|ppl|attendees|people)\b/i.test(l));
  const present = presentLine?.replace(/^[^:]*:\s*/, "") ?? "Not recorded";
  const apologies = presentLine?.match(/(\w+)\s+sent apologies/i)?.[1];
  const chair = present.match(/([A-Z][\w.]*(?:\s[A-Z]\.?)?)\s*\(chair\)/i)?.[1] ?? "Not recorded";

  const body = lines.slice(1).filter((l) => l !== presentLine && !NOISE.test(l));
  const decisions = body.filter((l) => DECISION.test(l));
  const actions = body.filter((l) => !DECISION.test(l) && ACTION.test(l));
  const discussion = body.filter((l) => !decisions.includes(l) && !actions.includes(l));

  // Follow the two kinds of rule the mock can act on: header labels and "Always include".
  const ruleLabels = system.match(/bold labels: ([^.\n]+)\./)?.[1].split(/,\s*/) ?? [];
  const mustInclude = [...system.matchAll(/Always include “([^”]+)”/g)].map((m) => m[1]);
  const header: Record<string, string> = {
    Chair: chair,
    Present: present.replace(/\s*\(chair\)/i, "").replace(/\.\s*\w+ sent apologies/i, ""),
  };
  if (apologies) header.Apologies = apologies;
  for (const label of [...ruleLabels, ...mustInclude.filter((l) => ruleLabels.includes(l))]) {
    header[label] ??= label === "Apologies" ? "None" : "Not recorded";
  }
  const order = [...new Set([...ruleLabels, ...Object.keys(header)])];
  const out = [
    `# Minutes: ${title}`,
    "",
    ...order.map((label) => `**${label}:** ${header[label]}`),
  ];
  out.push("", "## Discussion", ...discussion.map((l) => `- ${sentence(l)}`));
  if (decisions.length)
    out.push(
      "",
      ...decisions.map(
        (l) => `**Decision:** ${sentence(l.replace(/^(agreed|decided)\s*:?\s*/i, ""))}`,
      ),
    );
  if (actions.length) {
    out.push("", "## Action items", "", "| Owner | Action | Due |", "| --- | --- | --- |");
    for (const line of actions) {
      const owner = titleCase(line.split(/[\s:]/)[0]);
      const due = line.match(DUE)?.[0].replace(/^by\s+/i, "") ?? "TBC";
      const action = line
        .replace(/^[^\s:]+:?\s*/, "")
        .replace(DUE, "")
        .replace(/^(to|will|shall|should)\s+/i, "")
        .trim();
      out.push(`| ${owner} | ${sentence(action).replace(/\.$/, "")} | ${titleCase(due)} |`);
    }
  }
  for (const section of mustInclude.filter((l) => !ruleLabels.includes(l) && !(l in header))) {
    const closing =
      section.toLowerCase() === "close"
        ? body.find((l) => /\b(ended|closed)\b/i.test(l))
        : undefined;
    out.push("", `## ${section}`, closing ? sentence(closing) : "Not recorded.");
  }
  return out.join("\n");
}

function mockEvaluate(user: string) {
  const draft = blocks(user, "draft")[0] ?? "";
  const reference = blocks(user, "reference")[0] ?? "";
  const structureOf = (md: string) =>
    new Set([...headingsOf(md), ...labelsOf(md)].map((s) => s.toLowerCase()));
  const draftStructure = structureOf(draft);
  const refStructure = structureOf(reference);
  const draftTokens = new Set(tokenize(draft));
  const refTokens = new Set(tokenize(reference));
  const names = (md: string) => new Set(md.match(/\b[A-Z][a-z]{2,}\b/g) ?? []);
  const draftNames = names(draft);
  const refNames = names(reference);

  const ratio = (a: Set<string>, b: Set<string>) =>
    b.size === 0 ? 1 : [...b].filter((x) => a.has(x)).length / b.size;
  const scale = (x: number) => Math.round(Math.min(1, Math.max(0, x)) * 100) / 10;
  const lengthRatio =
    Math.min(draft.length, reference.length) / Math.max(draft.length, reference.length, 1);

  return {
    criteria: {
      structure: scale(jaccard(draftStructure, refStructure)),
      content: scale(ratio(draftTokens, refTokens)),
      cuts: scale(ratio(refTokens, draftTokens)),
      tone: scale(0.5 + lengthRatio / 2),
      naming: scale(ratio(draftNames, refNames)),
    },
    missing: [...refStructure]
      .filter((s) => !draftStructure.has(s))
      .map((s) => `Section or label “${s}”`),
    extra: [...draftStructure]
      .filter((s) => !refStructure.has(s))
      .map((s) => `Section or label “${s}”`),
    ruleViolations: [],
    rationale:
      "Mock evaluation: scores are word and section overlap between the draft and your version, not a model's judgement.",
  };
}

function mockCorrection(user: string) {
  const draft = blocks(user, "draft")[0] ?? "";
  const edited = blocks(user, "corrected_version")[0] ?? "";
  const reason = user.match(/Reason given: (.*)$/m)?.[1]?.trim();
  const draftLines = new Set(draft.split("\n").map((l) => l.trim()));
  const added = edited
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l && !draftLines.has(l));
  const addedHeadings = added.filter((l) => /^#{1,3}\s/.test(l) || /^\*\*[^*]+:\*\*/.test(l));

  const ops: { op: "add"; category: RuleCategory; text: string }[] = [];
  if (reason && reason !== "(none)")
    ops.push({ op: "add", category: guessCategory(reason), text: sentence(reason) });
  const labelOf = (line: string) => line.replace(/^#+\s*/, "").replace(/^\*\*([^*]+):\*\*.*/, "$1");
  const draftLabels = new Set(
    draft
      .split("\n")
      .filter((l) => /^#|^\*\*[^*]+:\*\*/.test(l))
      .map(labelOf),
  );
  for (const label of addedHeadings
    .map(labelOf)
    .filter((l) => !draftLabels.has(l))
    .slice(0, 2)) {
    ops.push({ op: "add", category: "structure", text: `Always include “${label}”.` });
  }
  if (ops.length === 0) {
    ops.push({
      op: "add",
      category: "content",
      text: "Follow the owner's corrected wording and layout for this kind of input.",
    });
  }
  return {
    explanation:
      reason && reason !== "(none)"
        ? sentence(reason)
        : `The owner changed ${added.length} line(s).`,
    ops,
    templateChange: null,
  };
}

/** Words that start sentences or label sections, never names. */
const NOT_NAMES = new Set(
  (
    "the this that these there their they then it its we he she his her our all every each no yes " +
    "agreed decided discussed ended closed opened started someone anyone minutes date chair present " +
    "apologies decision decisions action actions items item owner due close opening discussion " +
    "none not tbc aob any next end week month meeting call notes summary agenda update" +
    " monday tuesday wednesday thursday friday saturday sunday january february march april may june" +
    " july august september october november december"
  ).split(/\s+/),
);
const ORG_SUFFIX =
  /\b(Ltd|Limited|Foundation|Church|Bank|Group|Inc|Ministry|University|School|Hospital)\b/;

function mockEntities(user: string) {
  const texts = blocks(user, "redact_text");
  const entities = new Map<string, { text: string; kind: "person" | "organisation" | "place" }>();
  const add = (text: string, kind: "person" | "organisation" | "place") => {
    const clean = text
      .replace(/\s*\(.*?\)\s*/g, "")
      .trim()
      .replace(/[,;:]+$/, "")
      // Keep the dot of a trailing initial ("Ada O."), drop a sentence full stop.
      .replace(/(?<!\b[A-Z])\.$/, "");
    if (clean.length < 3 || NOT_NAMES.has(clean.toLowerCase())) return;
    if (!entities.has(clean.toLowerCase()))
      entities.set(clean.toLowerCase(), { text: clean, kind });
  };
  for (const text of texts) {
    for (const line of text.split(/\r?\n/)) {
      const attendees = line.match(
        /^\s*[-*]?\s*\**(present|ppl|people|attendees)\**:?\**\s*:?\s*(.+)$/i,
      );
      if (attendees) {
        attendees[2]
          .replace(/\.?\s*\w+ sent apologies.*/i, "")
          .split(/,|\band\b/)
          .forEach((n) => add(n, "person"));
        continue;
      }
      if (/^\s*#/.test(line)) continue;
      for (const m of line.matchAll(/\b([A-Z][a-z]{2,})(?:\s([A-Z]\.|[A-Z][a-z]{2,}))?/g)) {
        const phrase = m[0];
        // Capitalised at the start of a sentence, cell or label is grammar; mid-sentence it's a name.
        if (!/[\p{Ll}\d,]\s+$/u.test(line.slice(0, m.index))) continue;
        if (ORG_SUFFIX.test(phrase)) add(phrase, "organisation");
        else if (!NOT_NAMES.has(m[1].toLowerCase()))
          add(m[2] && /\.$/.test(m[2]) ? phrase : m[1], "person");
      }
    }
  }
  return { entities: [...entities.values()] };
}

function mockSelfCheck(user: string) {
  const input = blocks(user, "self_check_input")[0] ?? "";
  const flags: { kind: string; message: string }[] = [];
  const hasDate =
    /\b(mon|tue|wed|thu|fri|sat|sun)[a-z]*\b|\b\d{1,2}(st|nd|rd|th)\b|\bdate\b|\d{1,2}\/\d{1,2}/i.test(
      input,
    );
  if (!hasDate) flags.push({ kind: "missing_info", message: "The input has no meeting date." });
  if (!/\b(present|ppl|people|attendees)\b/i.test(input)) {
    flags.push({ kind: "missing_info", message: "The input doesn't list who attended." });
  }
  return { flags };
}

function mockMethodNotes(user: string) {
  const notes = blocks(user, "method_notes")[0] ?? "";
  const answers = [...notes.matchAll(/^A:\s*(.+)$/gm)].map((m) => m[1]);
  const statements = (answers.length ? answers : notes.split(/(?<=[.!?])\s+/))
    .map((t) => t.trim())
    .filter((t) => t.split(/\s+/).length >= 4)
    .slice(0, 6);
  const ops = statements.map((text) => ({
    op: "add" as const,
    category: guessCategory(text),
    text: sentence(text),
  }));
  if (ops.length === 0) {
    ops.push({ op: "add", category: "content", text: "Follow the owner's described method." });
  }
  return {
    explanation: `Adds ${ops.length} rule(s) from your own description of the method.`,
    ops,
    templateChange: null,
  };
}

function guessCategory(reason: string): RuleCategory {
  if (/\b(name|title|abbreviat|spell|call)\w*/i.test(reason)) return "naming";
  if (/\b(cut|remove|drop|leave out|omit|never include)\w*/i.test(reason)) return "cut";
  if (/\b(table|bold|bullet|format|font|heading)\w*/i.test(reason)) return "formatting";
  if (/\b(tone|formal|casual|voice|tense)\w*/i.test(reason)) return "tone";
  if (/\b(section|order|structure|header)\w*/i.test(reason)) return "structure";
  return "content";
}

function jaccard(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 && b.size === 0) return 1;
  const inter = [...a].filter((x) => b.has(x)).length;
  return inter / (a.size + b.size - inter);
}

function titleCase(s: string): string {
  return s.replace(/\b\w/g, (c) => c.toUpperCase());
}

function sentence(s: string): string {
  const t = s.trim();
  if (!t) return t;
  const capped = t[0].toUpperCase() + t.slice(1);
  return /[.!?]$/.test(capped) ? capped : `${capped}.`;
}
