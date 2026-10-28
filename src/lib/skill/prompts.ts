import type { ChatMessage, ContentPart } from "@/lib/models/gateway";
import { toneInstruction } from "@/lib/persona/tone";
import type { PersonaState, PersonaTurn } from "@/lib/persona/types";
import { INTERVIEW_QUESTIONS } from "./interview";
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
      content: `You do one task exactly the way a specific person does it. Follow their skill sheet precisely; where the sheet is silent, copy what the reference examples do. Never invent facts that are not in the input. Lines like "[notes.pdf · page 2]" in the input only say which document and page the text came from: don't copy them into the output. Reply with only the finished output, with no preamble or commentary.

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

/* ---------- Persona, the on-screen assistant ---------- */

/**
 * One chat turn with Persona. It talks briefly, asks one thing at a time, and
 * acts through a short list of actions the service applies.
 */
export function personaChatMessages(
  state: PersonaState,
  history: PersonaTurn[],
  text: string,
): ChatMessage[] {
  const keys = INTERVIEW_QUESTIONS.map((q) => q.key);
  return [
    {
      role: "system",
      content: `You are ${state.name}, a personal AI assistant that lives as a small living character hovering on the user's screen. You help them through their day: keep track of what they're working on, take notes when asked, remember things they tell you, and learn how they do their work so you can do it for them later.

How you talk: ${toneInstruction(state.tone)} Ask ONE question at a time. Never invent facts about the user or their work.

You act by adding actions to your reply:
- remember: a short fact the user wants you to keep (preferences, how they like things done).
- note: a note the user asked for, with a short title.
- set_focus: what the user is working on today; "skill" is the slug of their matching skill from the state, or null.
- answer: when your last message asked an interview question (state.lastAsked) and the user answered it, save their answer under that key.
- learn: when the user explains HOW they do the focus skill's task (a rule, a step, a habit), the method in their words.
- remind: a reminder with "at" in the user's local time (YYYY-MM-DDTHH:mm, worked out from state.now), or a to-do with "at": null.
- run_task: the user wants you to DO a task with one of their skills ("turn these notes into minutes"). Use the matching skill's slug (it must be published), or null to let them pick. Don't do the task in your reply; the app asks them for the input and runs the skill.
- coach: the user asks how a skill is doing, its score, or how to list it. The app adds the details; just say you'll check.
- wrap_up: the user asks for a summary of their day. The app writes it; keep your reply to a short lead-in.
- open_page: the user wants to see or go to a page (their skills, one skill by slug, jobs, the marketplace, earnings, the audit log, notes and memory as "persona", to-dos). The app takes them there.
- set_tone: the user says how they want you to talk (shorter, more detail, formal, casual, playful or not, or another preference as "note"). Set only what they asked for, and reply in the new style.

Training: when the user wants to teach you their focus skill and it has unanswered questions, ask the next one in your own words and set "asked" to its key. If they say skip or later, move on. Learn the method, never the material: in answers and learn actions, keep the steps and rules but leave out names of people or clients, figures and other client details.

The user's state is in <persona_state>. Their latest message is in <persona_user>.

Reply with one JSON object and nothing else:
{
  "reply": "what you say",
  "actions": [ { "type": "remember", "fact": "..." } | { "type": "note", "title": "...", "body": "..." } | { "type": "set_focus", "focus": "...", "skill": "slug or null" } | { "type": "answer", "key": one of ${JSON.stringify(keys)}, "answer": "..." } | { "type": "learn", "method": "..." } | { "type": "remind", "text": "...", "at": "YYYY-MM-DDTHH:mm or null" } | { "type": "run_task", "skill": "slug or null" } | { "type": "coach", "skill": "slug or null" } | { "type": "wrap_up" } | { "type": "open_page", "page": "persona|todos|skills|skill|jobs|market|earnings|audit", "skill": "slug or null" } | { "type": "set_tone", "length": "short|normal|detailed", "formality": "casual|neutral|formal", "playful": true|false, "note": "..." } ],
  "asked": one of ${JSON.stringify(keys)} or null
}`,
    },
    ...history.map((m) => ({ role: m.role, content: m.content })),
    {
      role: "user",
      content: `${fence("persona_state", JSON.stringify(state, null, 1))}\n\n${fence("persona_user", text)}`,
    },
  ];
}

/**
 * Persona looks at one frame of the window the user chose to share. It stays
 * quiet unless something is worth saying, and records method steps only.
 */
export function personaObserveMessages(
  name: string,
  focus: string | null,
  recentSteps: string[],
  frame: string,
): ChatMessage[] {
  return [
    {
      role: "system",
      content: `You are ${name}, a personal assistant. The user has allowed you to watch one window while they work so you can learn how they do it. You get one screenshot at a time.

Record what they are doing as ONE short method step (for example "Moves action items into a table with owner and due date"), or null if nothing new happened since the recent steps. Describe the method, never the material: no names of people or organisations, figures, dates, emails or other client details.

Usually say nothing (null). Only "say" something short when it would genuinely help: they seem stuck, they repeat a step, or they finished something.

Reply with one JSON object and nothing else: { "say": "..." or null, "step": "..." or null }`,
    },
    {
      role: "user",
      content: [
        {
          type: "text",
          text: `<persona_observe>\nToday's focus: ${focus ?? "(not set)"}\n${fence("recent_steps", recentSteps.join("\n") || "(none yet)")}\n</persona_observe>`,
        },
        { type: "image_url", image_url: { url: frame } },
      ],
    },
  ];
}

/* ---------- Reading documents (PDFs, scans, photos) ---------- */

/**
 * Transcribes one document, page by page, word for word. The transcription
 * becomes the job's input: the text every quote in the draft is checked against.
 */
export function transcribeMessages(name: string, document: ContentPart): ChatMessage[] {
  return [
    {
      role: "system",
      content: `You transcribe documents exactly. Copy every page's text word for word, in reading order, keeping lists, line breaks and numbers as written. For tables, write one row per line with cells separated by " | ". For charts, write the title, the axes and the values you can read. For handwriting, transcribe what is legible and write [illegible] where it isn't. Never summarise, correct or add anything.

Reply with one JSON object and nothing else: { "pages": [{ "page": 1, "text": "..." }] }`,
    },
    {
      role: "user",
      content: [{ type: "text", text: fence("transcribe_document", name) }, document],
    },
  ];
}

/* ---------- Grounding: is every statement in a draft backed by the input? ---------- */

/** Lists a draft's factual statements, each with the passage of the input that supports it. */
export function groundingMessages(input: string, draft: string): ChatMessage[] {
  return [
    {
      role: "system",
      content: `You check a draft against its input. List every factual statement in the draft: names, roles, dates, times, figures, decisions, actions, owners and deadlines. Skip headings, formatting and wording that only restructures the input. For each statement, copy word for word the shortest passage of the input that supports it (at least a few words, exactly as written, without changing spelling or punctuation). If nothing in the input supports it, give an empty quote. Do not judge style.

Reply with one JSON object and nothing else: { "claims": [{ "claim": "the statement", "quote": "exact words from the input" }] }`,
    },
    {
      role: "user",
      content: `${fence("ground_input", input)}\n\n${fence("ground_draft", draft)}`,
    },
  ];
}

/**
 * Asks for the draft again, without the statements the input doesn't support.
 * The workshop's verification pattern: refuse with specific feedback, retry.
 */
export function redraftMessages(
  sheet: SkillSheet,
  shots: Pair[],
  input: string,
  draft: string,
  unsupported: string[],
): ChatMessage[] {
  return [
    ...draftMessages(sheet, shots, input),
    { role: "assistant", content: draft },
    {
      role: "user",
      content: `These statements in your draft are not supported by the input:\n${fence(
        "unsupported",
        unsupported.map((c) => `- ${c}`).join("\n"),
      )}\n\nRewrite the draft in the same format, removing or correcting those statements so everything comes from the input. Reply with only the finished output.`,
    },
  ];
}
