/**
 * Offline stand-in for the real models, used when MODEL_PROVIDER=mock (the
 * default when no API key is set). It is deterministic and reads the same
 * prompts the real models get, so every screen and the whole loop work
 * without keys. Its drafts are rough and its scores are plain text
 * similarity: good for building and demoing the flow, not for judging a skill.
 */
import { toneFromMessage } from "@/lib/persona/tone";
import { parseWhen } from "@/lib/persona/when";
import { tokenize } from "@/lib/skill/retrieve";
import type { RuleCategory } from "@/lib/skill/types";
import { textOf, type ChatMessage, type ModelClient } from "./gateway";

export const MOCK_MODEL = "mock";

export function createMockClient(): ModelClient {
  return {
    async complete(role, messages) {
      const lastUser = messages.findLast((m) => m.role === "user");
      const user = lastUser ? textOf(lastUser.content) : "";
      const system = textOf(messages.find((m) => m.role === "system")?.content ?? "");
      let text: string;
      if (user.includes("<transcribe_document>")) text = JSON.stringify(mockTranscription(user));
      else if (user.includes("<ground_draft>")) text = JSON.stringify(mockGrounding(user));
      else if (user.includes("<unsupported>")) text = mockRedraft(messages, user);
      else if (user.includes("<persona_user>")) text = JSON.stringify(mockPersona(user));
      else if (user.includes("<persona_observe>")) text = JSON.stringify(mockObserve(user));
      else if (user.includes("<task>")) text = JSON.stringify(mockAppStep(user));
      else if (role === "draft") text = mockDraft(user, system);
      else if (user.includes("<screen_walkthrough>"))
        text = mockScreenSteps(lastUser?.content ?? "");
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
  return Math.ceil(messages.reduce((n, m) => n + textOf(m.content).length, 0) / 4);
}

/** Stand-in for describing screen frames: counts the frames and echoes the narration. */
function mockScreenSteps(content: ChatMessage["content"]): string {
  const frames = Array.isArray(content) ? content.filter((p) => p.type === "image_url").length : 0;
  const narration = blocks(textOf(content), "narration")[0] ?? "";
  return [
    `Mock description of ${frames} screen frame(s).`,
    "1. Opens the raw notes beside a blank minutes template.",
    "2. Fills the header block first: date, chair, present, apologies.",
    "3. Writes each decision on its own line in bold.",
    "4. Moves action items into a table with owner and due date.",
    "5. Deletes asides that led to no decision before saving.",
    narration ? `Narration: ${narration}` : "",
  ]
    .filter(Boolean)
    .join("\n");
}

interface MockPersonaState {
  now: string;
  tone?: { length?: string };
  memory: string[];
  focus: string | null;
  focusSkill: {
    slug?: string;
    name: string;
    hasRules: boolean;
    trainExamples?: number;
    testExamples?: number;
    unanswered: { key: string; question: string }[];
  } | null;
  pendingSwitch?: { slug: string; name: string } | null;
  skills: { slug: string; name: string; published: boolean }[];
  lastAsked: string | null;
}

/** Stand-in for Persona's chat. A "short" tone keeps only the first sentence, as asked. */
function mockPersona(user: string) {
  const state = JSON.parse(blocks(user, "persona_state")[0] ?? "{}") as MockPersonaState;
  const out = mockPersonaTurn(user);
  if (state.tone?.length === "short") {
    out.reply = out.reply.match(/^[^.!?]+[.!?]/)?.[0] ?? out.reply;
  }
  return out;
}

/** Keyword rules that exercise every action. */
function mockPersonaTurn(user: string): {
  reply: string;
  actions: Record<string, unknown>[];
  asked?: string | null;
} {
  const state = JSON.parse(blocks(user, "persona_state")[0] ?? "{}") as MockPersonaState;
  const text = blocks(user, "persona_user")[0] ?? "";
  const lower = text.toLowerCase();
  // Persona Desktop sent the list of what's on screen: "where's X" points at the matching entry.
  const screen = blocks(user, "persona_screen")[0];
  const where = /\b(?:where(?:'s| is)|point (?:at|to)|show me)\s+(?:the\s+)?(.+?)[?.!]*$/i.exec(
    text,
  );
  if (screen && where) {
    const want = where[1].replace(/\s+(button|link|field)$/i, "").toLowerCase();
    const entry = screen
      .split("\n")
      .find((l) => /^[et]\d+ /.test(l) && l.toLowerCase().includes(want));
    if (entry) {
      return {
        reply: `There, ${where[1]}.`,
        actions: [{ type: "point", item: entry.split(" ")[0], thing: null }],
      };
    }
  }
  const skill = state.focusSkill;
  const nextQuestion = (except: string | null) =>
    skill?.unanswered.find((q) => q.key !== except) ?? null;

  // Persuna offered to switch skills: yes switches, anything else stays.
  if (state.pendingSwitch) {
    const other = state.pendingSwitch;
    if (/^(yes|yeah|yep|sure|ok(ay)?|switch|please do)\b/.test(lower)) {
      return {
        reply: `Switched to ${other.name}.`,
        actions: [{ type: "set_focus", focus: other.name, skill: other.slug }],
      };
    }
    if (/^(no|nope|stay|not now|keep)\b/.test(lower)) {
      return { reply: `Okay, staying on ${skill?.name ?? "this"}.`, actions: [] };
    }
  }

  // Building a skill, all by conversation.
  const learnNew = text.match(
    /\b(?:i (?:want|need) you to learn(?: how to)?|learn (?:how to|to)|new skill[:,]?|create a skill (?:for|to))\s+(.+)/i,
  );
  if (learnNew) {
    const name = learnNew[1].replace(/[.!?]+$/, "").trim();
    const title = name.charAt(0).toUpperCase() + name.slice(1);
    return {
      reply: `Great, I'll learn ${name}. Give me an example of how you do it: say "add an example".`,
      actions: [
        {
          type: "create_skill",
          name: title,
          task: `${title}, done the way the owner does it.`,
          input: null,
          output: null,
        },
      ],
    };
  }
  if (/\b(add (?:an |another )?example|here'?s an example|give you an example)\b/.test(lower)) {
    return {
      reply: "Sure. Paste what you started with and your finished version.",
      actions: [{ type: "add_example", skill: null }],
    };
  }
  if (
    /\b(train yourself|learn the rules|update your rules|train (?:the|this) skill)\b/.test(lower)
  ) {
    return {
      reply: "Learning from your examples now.",
      actions: [{ type: "train_skill", skill: null }],
    };
  }
  if (/\b(test yourself|run the tests|test (?:the|this) skill)\b/.test(lower)) {
    return {
      reply: "Testing myself against the examples you held back.",
      actions: [{ type: "test_skill", skill: null }],
    };
  }
  if (/\bpublish\b/.test(lower)) {
    return {
      reply: "Here's what would go live.",
      actions: [{ type: "publish_skill", skill: null }],
    };
  }

  // Work that belongs to another of their skills: ask before switching.
  if (skill && !/\b(open|show|switch|go to|take me)\b/.test(lower)) {
    const words = tokenize(text);
    const focusWords = new Set(tokenize(skill.name));
    const other = state.skills.find(
      (s) =>
        s.name !== skill.name &&
        tokenize(s.name).some((w) => w.length > 3 && !focusWords.has(w) && words.includes(w)),
    );
    if (other) {
      return {
        reply: `That sounds like your ${other.name} skill, not ${skill.name}. Want me to switch?`,
        actions: [{ type: "suggest_switch", skill: other.slug, task: null }],
      };
    }
  }

  if (state.lastAsked && skill) {
    if (/^(skip|later|not now)\b/.test(lower)) {
      const next = nextQuestion(state.lastAsked);
      return next
        ? { reply: `No problem. ${next.question}`, actions: [], asked: next.key }
        : { reply: "Okay, we'll leave it there for now.", actions: [], asked: null };
    }
    if (/^(stop|that's all|done)\b/.test(lower)) {
      return {
        reply: "Okay, I'll stop the questions. Pick it up any time.",
        actions: [],
        asked: null,
      };
    }
    const next = nextQuestion(state.lastAsked);
    return {
      reply: next
        ? `Got it, I've saved that. Next one: ${next.question}`
        : `Thanks, that's every question for ${skill.name}. Open the skill and extract rules when you're ready.`,
      actions: [{ type: "answer", key: state.lastAsked, answer: text }],
      asked: next?.key ?? null,
    };
  }

  const matchSkill = () => {
    const words = tokenize(text);
    return (
      state.skills.find((s) => tokenize(s.name).some((w) => words.includes(w)))?.slug ??
      (skill ? state.skills.find((s) => s.name === skill.name)?.slug : undefined) ??
      null
    );
  };

  const open = text.match(/\b(?:open|show(?: me)?|go to|take me to|bring up)\s+(?:my |the )?(.+)/i);
  if (open) {
    const what = open[1].toLowerCase();
    const page = /job|review|work|order/.test(what)
      ? "jobs"
      : /market|rent/.test(what)
        ? "market"
        : /earn|money|pay/.test(what)
          ? "earnings"
          : /audit|log|history/.test(what)
            ? "audit"
            : /to-?do|remind/.test(what)
              ? "todos"
              : /note|memory|persona|profile/.test(what)
                ? "persona"
                : /skill/.test(what)
                  ? "skills"
                  : null;
    const slug = matchSkill();
    if (page || slug) {
      return {
        reply: "On it, taking you there.",
        actions: [
          slug && !page
            ? { type: "open_page", page: "skill", skill: slug }
            : { type: "open_page", page: page ?? "skills", skill: null },
        ],
      };
    }
  }

  const toneChange = toneFromMessage(text);
  if (toneChange) {
    const said = [
      toneChange.length === "short" && "shorter",
      toneChange.length === "detailed" && "with more detail",
      toneChange.formality && `more ${toneChange.formality}`,
      toneChange.playful === true && "with a bit of fun",
      toneChange.playful === false && "serious",
    ].filter(Boolean);
    return {
      reply: `Got it. I'll keep it ${said.join(" and ")} from now on.`,
      actions: [{ type: "set_tone", ...toneChange }],
    };
  }

  if (
    /\b(e-?mails?|inbox|gmail|calendar|schedule a|notion)\b/.test(lower) &&
    !/\bskill\b/.test(lower)
  ) {
    return { reply: "On it.", actions: [{ type: "app_task", goal: text.trim() }] };
  }
  if (/\b(stop|quit|end) (?:watching|following)\b/.test(lower)) {
    return {
      reply: "Okay, I've stopped watching.",
      actions: [{ type: "watch_screen", on: false }],
    };
  }
  if (/\b(watch|follow|look at) (?:my |the )?screen\b/.test(lower)) {
    return {
      reply: "Sure, I'll watch while you work.",
      actions: [{ type: "watch_screen", on: true }],
    };
  }

  if (
    /\b(wrap(?:-| )?up|end of (?:the )?day|summar(?:y|ise|ize) (?:of )?(?:my |the )?day)\b/.test(
      lower,
    )
  ) {
    return { reply: "Here's your wrap-up.", actions: [{ type: "wrap_up" }] };
  }

  const remind = text.match(/^(?:please )?remind me\s+(.+)/i);
  if (remind) {
    const at = parseWhen(remind[1], state.now);
    const what = remind[1]
      .replace(/\b(?:tomorrow\s+)?(?:at|by)\s+\d{1,2}(?::\d{2})?\s*(?:am|pm)?\b/i, "")
      .replace(/\bin (?:\d+|an?|one) (?:minute|min|hour|hr)s?\b/i, "")
      .replace(/\btomorrow\b/i, "")
      .replace(/^\s*(?:to|that|about)\s+/i, "")
      .replace(/\s+/g, " ")
      .trim()
      .replace(/[.!]+$/, "");
    return {
      reply: at
        ? `Okay, I'll remind you at ${at.slice(11)}${at.slice(0, 10) !== state.now.slice(0, 10) ? " tomorrow" : ""}.`
        : "Added to your to-dos.",
      actions: [{ type: "remind", text: what || remind[1], at }],
    };
  }

  const todo = text.match(/^(?:add )?(?:to-?do|add to my (?:to-?do|list)s?)[:,]?\s+(.+)/i);
  if (todo) {
    return {
      reply: "Added to your to-dos.",
      actions: [{ type: "remind", text: todo[1].replace(/[.!]+$/, ""), at: null }],
    };
  }

  if (
    /\b(how(?:'s| is) (?:my )?.*skill|my score|coach|can i list|ready to list|what next for)\b/.test(
      lower,
    )
  ) {
    return { reply: "Let me look at it.", actions: [{ type: "coach", skill: matchSkill() }] };
  }

  if (
    /\b(turn (?:these|this|my)|draft (?:the|these|my|this)|do (?:a|this|the) task|run (?:my|the) skill|into minutes|write (?:up )?the minutes)\b/.test(
      lower,
    )
  ) {
    const slug = matchSkill();
    return {
      reply: "Sure. Paste the notes or upload a file and I'll draft it with your skill.",
      actions: [{ type: "run_task", skill: slug }],
    };
  }

  const remember = text.match(/\bremember(?: that)?[:,]?\s+(.+)/i);
  if (remember) {
    return {
      reply: "I'll remember that.",
      actions: [{ type: "remember", fact: remember[1].replace(/[.!]+$/, "") }],
    };
  }

  const note = text.match(
    /^(?:note|take a note|write (?:this )?down|jot (?:this )?down)[:,]?\s*([\s\S]+)/i,
  );
  if (note) {
    const body = note[1].trim();
    return {
      reply: "Noted. It's on your Notes page.",
      actions: [{ type: "note", title: body.split(/\s+/).slice(0, 6).join(" "), body }],
    };
  }

  const focus = text.match(
    /(?:working on|focus(?:ing)? on|today (?:i'?m|we're|we are|is))\s+(.+)/i,
  );
  if (focus) {
    const words = tokenize(focus[1]);
    const match = state.skills.find((s) => tokenize(s.name).some((w) => words.includes(w)));
    return {
      reply: match
        ? `Got it: today is ${focus[1].replace(/[.!]+$/, "")}. That's your "${match.name}" skill. Say "teach me" and I'll ask how you do it, one question at a time.`
        : `Got it: today is ${focus[1].replace(/[.!]+$/, "")}. I'll keep us on it. Want me to take notes as we go?`,
      actions: [
        { type: "set_focus", focus: focus[1].replace(/[.!]+$/, ""), skill: match?.slug ?? null },
      ],
    };
  }

  if (skill && /\b(teach|train|interview me|ask me|learn)\b/.test(lower)) {
    const next = nextQuestion(null);
    if (next) return { reply: `Let's do it. ${next.question}`, actions: [], asked: next.key };
    return {
      reply: `I have your answers for ${skill.name}. Tell me a rule or a step ("I always…") and I'll ${skill.hasRules ? "propose a change to your rules" : "add it to what I know"}.`,
      actions: [],
    };
  }

  if (skill && /\b(i always|i never|i usually|my rule|the way i)\b/.test(lower)) {
    return {
      reply: skill.hasRules
        ? "Thanks, I've turned that into a proposed rule change for you to review."
        : "Thanks, I've added that to how you do it.",
      actions: [{ type: "learn", method: text }],
    };
  }

  return {
    reply: state.focus
      ? `I'm here. We're on ${state.focus}. Ask me to take a note, remember something, or say "teach me".`
      : "I'm here. What are we working on today?",
    actions: [],
  };
}

/** Stand-in for watching the screen: one generic step per look, rarely a remark. */
function mockObserve(user: string) {
  const recent = blocks(user, "recent_steps")[0] ?? "";
  const seen = recent.startsWith("(none") ? 0 : recent.split("\n").length;
  const steps = [
    "Opens the source material beside a blank document.",
    "Writes the header block first.",
    "Works through the material top to bottom, one section at a time.",
    "Moves follow-ups into a list at the end.",
    "Reads the result through once before saving.",
  ];
  return {
    say: seen === 0 ? "I'm watching this window. I'll jot down your steps quietly." : null,
    step: `${steps[seen % steps.length]} (mock)`,
  };
}

/**
 * Stand-in for the grounding check: each draft line with a number is a claim,
 * quoted from the input line holding its numbers; if a number isn't in the
 * input, there's no quote (unsupported).
 */
function mockGrounding(user: string) {
  const input = blocks(user, "ground_input")[0] ?? "";
  const draft = blocks(user, "ground_draft")[0] ?? "";
  const inputLines = input.split(/\r?\n/);
  const claims = draft
    .split(/\r?\n/)
    .map((l) => l.replace(/^[#*\-|\s]+|[*|\s]+$/g, "").trim())
    .filter((l) => /\d/.test(l) && l.length > 3)
    .map((claim) => {
      const numbers = claim.match(/\d[\d,.:]*/g) ?? [];
      const line = inputLines.find((l) =>
        numbers.every((n) => l.includes(n.replace(/[.,:]+$/, ""))),
      );
      return { claim, quote: line?.trim() ?? "" };
    });
  return { claims };
}

/** Stand-in for a redraft: the previous draft without the lines holding unsupported statements. */
function mockRedraft(messages: ChatMessage[], user: string) {
  const previous = textOf(messages.findLast((m) => m.role === "assistant")?.content ?? "");
  const bad = (blocks(user, "unsupported")[0] ?? "")
    .split(/\r?\n/)
    .map((l) => l.replace(/^-\s*/, "").trim())
    .filter(Boolean);
  return previous
    .split(/\r?\n/)
    .filter(
      (line) =>
        !bad.some(
          (b) =>
            line.includes(b) ||
            b.includes(line.replace(/^[#*\-|\s]+|[*|\s]+$/g, "").trim() || "\u0000"),
        ),
    )
    .join("\n");
}

/** Stand-in for reading a PDF or image: fixed meeting notes, so the flow works offline. */
function mockTranscription(user: string) {
  const name = blocks(user, "transcribe_document")[0] ?? "document";
  return {
    pages: [
      {
        page: 1,
        text: `Mock transcription of ${name}.\nOps sync, 14 October. Chair: Sam. Present: Sam, Ife, Tunde.\nAgreed: the stock count moves to Thursdays.\nAction: Tunde to send the revised rota by Friday.`,
      },
    ],
  };
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

/** A task in connected apps, offline: look once if there's a search tool, then answer. */
function mockAppStep(user: string) {
  const results = user.match(/<tool_result>([\s\S]*?)<\/tool_result>/g) ?? [];
  if (!results.length && /e-?mail|inbox/i.test(user)) {
    return { tool: "gmail_search", args: { query: "newer_than:7d" }, reply: null };
  }
  return {
    tool: null,
    args: null,
    reply: results.length
      ? `I looked and found ${results.length === 1 ? "one result" : `${results.length} results`}.`
      : "Done.",
  };
}
