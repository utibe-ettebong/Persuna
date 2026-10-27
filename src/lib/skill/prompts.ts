import type { ChatMessage } from "@/lib/models/gateway";
import { renderSheet } from "./sheet";
import { CRITERIA, RULE_CATEGORIES, type Pair, type SkillSheet } from "./types";

export interface SkillMeta {
  name: string;
  taskDescription: string;
  inputType: string;
  outputType: string;
}

const fence = (label: string, body: string) => `<${label}>\n${body.trim()}\n</${label}>`;

export function extractMessages(meta: SkillMeta, pairs: Pair[], ownerNotes = ""): ChatMessage[] {
  const examples = pairs
    .map(
      (p, i) =>
        `## Example ${i + 1}\n${fence("input", p.input)}\n${fence("finished_output", p.output)}`,
    )
    .join("\n\n");

  return [
    {
      role: "system",
      content: `You study how one specific person does one kind of task, from pairs of their raw input and their finished output, and write down their method as a skill sheet that another writer could follow to produce output indistinguishable from theirs.

Write rules that are specific and checkable ("Action items go in a table with columns Owner | Action | Due"), never generic advice ("Be clear and concise"). Capture: the exact structure and headings, what they always keep, what they consistently cut, tone and person, naming conventions (how people, dates, organisations are written), and formatting. Only state a rule if the examples support it. Where the owner has described their own method, treat that description as authoritative unless the examples clearly contradict it.

Reply with one JSON object and nothing else:
{
  "summary": "two or three sentences on what this person's output is and how it differs from the raw input",
  "rules": [{ "id": "R1", "category": one of ${JSON.stringify(RULE_CATEGORIES)}, "text": "the rule" }, ...],
  "template": "a skeleton of the finished output with placeholders, in the same format the examples use"
}
Number rule ids R1, R2, R3 ... in order.`,
    },
    {
      role: "user",
      content: `Task: ${meta.name}: ${meta.taskDescription}\nInput type: ${meta.inputType}\nOutput type: ${meta.outputType}${ownerNotes.trim() ? `\n\n${fence("owner_description", ownerNotes)}` : ""}\n\n${examples}`,
    },
  ];
}

export function draftMessages(sheet: SkillSheet, shots: Pair[], input: string): ChatMessage[] {
  const examples = shots
    .map(
      (p, i) =>
        `## Reference example ${i + 1}\n${fence("input", p.input)}\n${fence("finished_output", p.output)}`,
    )
    .join("\n\n");

  return [
    {
      role: "system",
      content: `You do one task exactly the way a specific person does it. Follow their skill sheet precisely; where the sheet is silent, copy what the reference examples do. Never invent facts that are not in the input. Reply with only the finished output, with no preamble or commentary.

${renderSheet(sheet)}`,
    },
    {
      role: "user",
      content: `${examples}\n\n## Now do this one\n${fence("input", input)}`,
    },
  ];
}

export function evaluateMessages(
  sheet: SkillSheet,
  input: string,
  draft: string,
  reference: string,
): ChatMessage[] {
  return [
    {
      role: "system",
      content: `You judge how closely a draft replicates the way a specific person did a task. You are given their skill sheet, the raw input, the draft, and the person's own finished output (the reference). Score how close the draft is to the reference, not how good it is in general.

Score each criterion from 0 to 10:
- structure: same sections, order, headings and layout as the reference
- content: same decisions, actions, owners, dates and facts; nothing important missing or invented
- cuts: leaves out what the reference leaves out
- tone: same voice, person and register
- naming: names, titles, dates and organisations written the way the reference writes them

Reply with one JSON object and nothing else:
{
  "criteria": { ${CRITERIA.map((c) => `"${c}": number`).join(", ")} },
  "missing": ["things in the reference that the draft lacks"],
  "extra": ["things in the draft that the reference does not have"],
  "ruleViolations": ["rule ids from the sheet the draft breaks, with a few words each"],
  "rationale": "two or three sentences"
}

${renderSheet(sheet)}`,
    },
    {
      role: "user",
      content: `${fence("input", input)}\n\n${fence("draft", draft)}\n\n${fence("reference", reference)}`,
    },
  ];
}

export function correctionMessages(
  sheet: SkillSheet,
  input: string,
  draft: string,
  edited: string,
  reason: string,
): ChatMessage[] {
  return [
    {
      role: "system",
      content: `You maintain a skill sheet that captures how a specific person does a task. The person just corrected a draft. Turn their correction into the smallest set of rule changes that would have produced their version, written so they generalise to future inputs. Do not copy one-off facts (names, figures, dates) from this input into rules.

Prefer updating an existing rule over adding a near-duplicate. Change the template only if the correction changes the overall layout.

Reply with one JSON object and nothing else:
{
  "explanation": "one sentence on what the person wants differently",
  "ops": [
    { "op": "add", "category": one of ${JSON.stringify(RULE_CATEGORIES)}, "text": "..." }
    | { "op": "update", "id": "R3", "text": "...", "category": optional }
    | { "op": "remove", "id": "R5" }
  ],
  "templateChange": null or "the full new template"
}

Current sheet:
${renderSheet(sheet)}`,
    },
    {
      role: "user",
      content: `${fence("input", input)}\n\n${fence("draft", draft)}\n\n${fence("corrected_version", edited)}\n\nReason given: ${reason.trim() || "(none)"}`,
    },
  ];
}

/** Finds names of people, organisations and places so example pairs can be anonymised. */
export function redactMessages(texts: string[]): ChatMessage[] {
  return [
    {
      role: "system",
      content: `You find identifying names in text so it can be anonymised. List every person, organisation and place named, exactly as written (keep each spelling you see, including lowercase or partial forms like first names alone). Do not list job titles, roles ("the Chair"), days, months or generic words.

Reply with one JSON object and nothing else:
{ "entities": [{ "text": "as written", "kind": "person" | "organisation" | "place" }] }`,
    },
    { role: "user", content: texts.map((t) => fence("redact_text", t)).join("\n\n") },
  ];
}

/** The drafter checks its own work before the owner sees it. */
export function selfCheckMessages(sheet: SkillSheet, input: string, draft: string): ChatMessage[] {
  return [
    {
      role: "system",
      content: `You check a draft before a person reviews it. Compare the draft with the input and the skill sheet, and flag only real problems:
- missing_info: the input lacks something the sheet requires (for example no date or attendees)
- invented_detail: the draft states something the input does not support
- rule_conflict: the draft breaks a rule, or two rules conflict for this input
- unusual_input: the input is unlike what this skill normally handles
- uncertain: anything else the reviewer should look at
If there is nothing worth flagging, return an empty list.

Reply with one JSON object and nothing else:
{ "flags": [{ "kind": "...", "message": "one sentence for the reviewer" }] }

${renderSheet(sheet)}`,
    },
    {
      role: "user",
      content: `${fence("self_check_input", input)}\n\n${fence("self_check_draft", draft)}`,
    },
  ];
}

/**
 * Turns the owner's own description of their method (interview answers or a
 * transcribed voice walkthrough) into proposed rule changes.
 */
export function methodNotesMessages(sheet: SkillSheet, notes: string): ChatMessage[] {
  return [
    {
      role: "system",
      content: `You maintain a skill sheet that captures how a specific person does a task. The person has described their method in their own words. Turn their description into the smallest set of rule changes that makes the sheet match it. Write rules that are specific and checkable. Prefer updating an existing rule over adding a near-duplicate. Leave alone rules the description does not address.

Reply with one JSON object and nothing else:
{
  "explanation": "one sentence on what the description changes",
  "ops": [
    { "op": "add", "category": one of ${JSON.stringify(RULE_CATEGORIES)}, "text": "..." }
    | { "op": "update", "id": "R3", "text": "...", "category": optional }
    | { "op": "remove", "id": "R5" }
  ],
  "templateChange": null or "the full new template"
}

Current sheet:
${renderSheet(sheet)}`,
    },
    { role: "user", content: fence("method_notes", notes) },
  ];
}

/**
 * A recorded screen walkthrough: frames of one window plus the owner's
 * narration. The model describes the method it shows, never the content.
 */
export function screenWalkthroughMessages(
  meta: SkillMeta,
  narration: string,
  frames: string[],
): ChatMessage[] {
  return [
    {
      role: "system",
      content: `You watch a short recording of a person doing one task on their computer, as a sequence of screenshots in time order, plus anything they said while recording. Describe their METHOD as numbered steps another person could follow: what they open first, the order they work in, how they structure the output, what they check, what they leave out, and any conventions (headings, formatting, naming, tone).

Describe the method, not the material. Never copy names of people or organisations, figures, dates, email addresses, account numbers or other client details from the screens: refer to them generically ("the client's name", "the amount"). If a screen shows nothing relevant to the task, skip it. Reply with plain numbered steps and nothing else.`,
    },
    {
      role: "user",
      content: [
        {
          type: "text",
          text: `<screen_walkthrough>\nTask: ${meta.name}: ${meta.taskDescription}\n${frames.length} screenshots follow, in order.\n${fence("narration", narration || "(no narration)")}`,
        },
        ...frames.map((url) => ({ type: "image_url" as const, image_url: { url } })),
      ],
    },
  ];
}
