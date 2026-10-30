/**
 * Persuna's thinking with no storage attached: one chat turn, one look at the
 * screen. Like the training engine, it takes a {@link ModelClient} so tests
 * and the offline mock run the same code as live models.
 */
import type { ChatMessage, ModelClient } from "@/lib/models/gateway";
import { completeJson } from "@/lib/models/json";
import {
  persunaChatMessages,
  persunaObserveMessages,
  persunaWorkMessages,
} from "@/lib/skill/prompts";
import { entryAt, sceneEntries, sceneForModel, spotOf, type Scene } from "./scene";
import { createSentenceSplitter, splitSentences } from "./sentences";
import { createTurnSplitter, type TurnEvent } from "./stream-protocol";
import {
  persunaAction,
  persunaObservation,
  persunaReply,
  persunaWork,
  type PersunaAction,
  type PersunaObservation,
  type PersunaReply,
  type PersunaState,
  type PersunaTurn,
  type PersunaWork,
} from "./types";

/** What's on screen as Persuna sees it for one turn (see the service's Sight). */
type Sight = { scene: Scene | null; image: string | null; circled?: boolean };

/** A file handed to Persuna: its name, and its text or (for a picture) a data URL. */
export interface PersunaFile {
  name: string;
  text: string | null;
  image: string | null;
}

/** How many earlier messages go back to the model with each turn. */
export const HISTORY_TURNS = 12;

/**
 * One turn. The message is text, or a recording (base64 WAV) that the
 * listening model hears directly and writes down in `heard`.
 */
/** A chat turn gives up on a stuck provider this soon (per attempt). */
export const TURN_TIMEOUT_MS = 20_000;

const SHOW_MESSAGE =
  'The user pressed "Show me": your reply MUST include a draw (marks on screen entries, or a flow diagram) or a point, so they can see what you mean — a text-only answer is not enough.';

/** The model role for a turn: hearing and pictures need the LISTEN role. */
function turnRole(
  message: string | { audio: string },
  sight: Sight | null,
  file: PersunaFile | null,
) {
  // Hearing and pictures go to Meta's Muse Spark (the LISTEN role); text,
  // including the list of what's on screen, to the drafting model.
  return typeof message === "string" && !sight?.image && !file?.image ? "draft" : "listen";
}

function turnMessages(
  state: PersunaState,
  history: PersunaTurn[],
  message: string | { audio: string },
  sight: Sight | null,
  file: PersunaFile | null,
  show: boolean,
  voice: boolean,
): ChatMessage[] {
  const messages = persunaChatMessages(
    state,
    history.slice(-HISTORY_TURNS),
    message,
    sight && {
      scene: sight.scene && sceneForModel(sight.scene),
      image: sight.image,
      circled: Boolean(sight.circled),
    },
    file,
    voice,
  );
  if (show) messages.push({ role: "system", content: SHOW_MESSAGE });
  return messages;
}

export async function persunaTurn(
  client: ModelClient,
  state: PersunaState,
  history: PersunaTurn[],
  message: string | { audio: string },
  /**
   * What's on the user's screen right now, when Persuna may look: the list of
   * it read on their computer, and the screenshot when the list isn't enough.
   */
  sight: Sight | null = null,
  /** A file the user handed Persuna with this message: its text, or a picture. */
  file: PersunaFile | null = null,
  /** The user pressed "Show me": the reply must show, not just tell. */
  show = false,
): Promise<PersunaReply> {
  const { value } = await completeJson(
    client,
    turnRole(message, sight, file),
    turnMessages(state, history, message, sight, file, show, false),
    persunaReply,
    // Room for "thinking" models to reason before the short reply; a stuck
    // provider fails in seconds, not the training budget's minutes.
    { maxTokens: 4096, timeoutMs: TURN_TIMEOUT_MS },
  );
  return tidyReply(value, state, sight);
}

/**
 * One streamed turn: heard and sentences flow as they're written, so speech
 * can start on the first sentence; the full prose, actions and asked key
 * arrive at the end, already tidied like {@link persunaTurn}. Clients without
 * streams answer one whole JSON reply, which is replayed as the same events.
 */
export type TurnStreamEvent =
  | { type: "started" }
  | { type: "heard"; text: string }
  | { type: "sentence"; text: string }
  | { type: "prose"; text: string }
  | { type: "actions"; actions: PersunaAction[] }
  | { type: "asked"; key: PersunaReply["asked"] }
  | { type: "malformed-tail" };

export async function* persunaTurnStream(
  client: ModelClient,
  state: PersunaState,
  history: PersunaTurn[],
  message: string | { audio: string },
  sight: Sight | null = null,
  file: PersunaFile | null = null,
  show = false,
): AsyncGenerator<TurnStreamEvent> {
  if (!client.completeStream) {
    const reply = await persunaTurn(client, state, history, message, sight, file, show);
    yield { type: "started" };
    if (reply.heard) yield { type: "heard", text: reply.heard };
    for (const sentence of splitSentences(reply.reply)) {
      yield { type: "sentence", text: sentence };
    }
    yield { type: "prose", text: reply.reply };
    yield { type: "actions", actions: reply.actions };
    yield { type: "asked", key: reply.asked ?? null };
    return;
  }
  const stream = client.completeStream(
    turnRole(message, sight, file),
    turnMessages(state, history, message, sight, file, show, true),
    { maxTokens: 4096, timeoutMs: TURN_TIMEOUT_MS },
  );
  const queued: TurnEvent[] = [];
  const splitter = createTurnSplitter((event) => queued.push(event));
  const sentences = createSentenceSplitter();
  let started = false;
  let heard: string | null = null;
  let prose = "";
  let actions: PersunaAction[] = [];
  let asked: string | null = null;
  const drain = function* (): Generator<TurnStreamEvent> {
    while (queued.length) {
      const event = queued.shift()!;
      if (event.type === "heard") {
        heard = event.text;
        yield { type: "heard", text: event.text };
      } else if (event.type === "prose") {
        prose += event.text;
        for (const sentence of sentences.push(event.text)) {
          yield { type: "sentence", text: sentence };
        }
      } else if (event.type === "actions") {
        actions = event.actions.flatMap((entry) => {
          const parsed = persunaAction.safeParse(entry);
          return parsed.success ? [parsed.data] : [];
        });
      } else if (event.type === "asked") {
        asked = event.key;
      } else {
        yield { type: "malformed-tail" };
      }
    }
  };
  for await (const chunk of stream) {
    if (!started) {
      started = true;
      yield { type: "started" };
    }
    splitter.feed(chunk);
    yield* drain();
  }
  splitter.finish();
  yield* drain();
  for (const sentence of sentences.finish()) yield { type: "sentence", text: sentence };
  const reply = tidyReply({ heard, reply: prose.trim(), actions, asked }, state, sight);
  yield { type: "prose", text: reply.reply };
  yield { type: "actions", actions: reply.actions };
  yield { type: "asked", key: reply.asked ?? null };
}

/** The end state of a streamed turn, gathered from its events. */
export interface CollectedTurn {
  heard: string | null;
  prose: string;
  actions: PersunaAction[];
  asked: PersunaReply["asked"];
  malformed: boolean;
}

/** Gathers a turn's end state; started and sentence events only speak. */
export function collectTurn(events: TurnStreamEvent[]): CollectedTurn {
  let heard: string | null = null;
  let prose = "";
  let actions: PersunaAction[] = [];
  let asked: PersunaReply["asked"] = null;
  let malformed = false;
  for (const event of events) {
    if (event.type === "heard") heard = event.text;
    else if (event.type === "prose") prose = event.text;
    else if (event.type === "actions") actions = event.actions;
    else if (event.type === "asked") asked = event.key;
    else if (event.type === "malformed-tail") malformed = true;
  }
  return { heard, prose, actions, asked, malformed };
}

/**
 * The id of the screen entry the model named ("the Settings gear") instead of
 * giving its id, or null when it matches nothing — or more than one thing.
 */
function entryNamed(scene: Scene, name: string): string | null {
  const want = name.trim().toLowerCase();
  if (!want) return null;
  const entries = sceneEntries(scene);
  const exact = entries.find((e) => e.label.trim().toLowerCase() === want);
  if (exact) return exact.id;
  const partial = entries.filter(
    (e) => e.label.toLowerCase().includes(want) || want.includes(e.label.toLowerCase()),
  );
  return partial.length === 1 ? partial[0].id : null;
}

/**
 * Drops actions the state can't support, so a confused model can't save an
 * answer nobody asked for or point the focus at someone else's skill.
 */
export function tidyReply(
  reply: PersunaReply,
  state: PersunaState,
  sight: Sight | null = null,
): PersunaReply {
  const slugs = new Set(state.skills.map((s) => s.slug));
  const unanswered = new Set(state.focusSkill?.unanswered.map((q) => q.key) ?? []);
  const actions = reply.actions.flatMap((action): PersunaAction[] => {
    if (
      action.type === "add_example" ||
      action.type === "train_skill" ||
      action.type === "test_skill" ||
      action.type === "publish_skill"
    ) {
      // A named skill must be theirs; otherwise it means today's skill.
      return [{ ...action, skill: action.skill && slugs.has(action.skill) ? action.skill : null }];
    }
    if (action.type === "suggest_switch") {
      return [{ ...action, skill: action.skill && slugs.has(action.skill) ? action.skill : null }];
    }
    if (action.type === "open_page" && action.page === "skill" && !slugs.has(action.skill ?? ""))
      return [{ ...action, page: "skills" as const, skill: null }];
    if (action.type === "run_task" || action.type === "coach")
      return [{ ...action, skill: action.skill && slugs.has(action.skill) ? action.skill : null }];
    if (action.type === "set_focus")
      return [{ ...action, skill: action.skill && slugs.has(action.skill) ? action.skill : null }];
    if (action.type === "point") {
      // Only entries that exist (by id, or by the name the model used), and
      // things it could look for in a picture it has.
      let item: string | null = null;
      if (action.item && sight?.scene) {
        item = spotOf(sight.scene, action.item)
          ? action.item
          : entryNamed(sight.scene, action.item);
      }
      const thing = !item && sight?.image ? (action.thing ?? null) : null;
      return item || thing ? [{ type: "point" as const, item, thing }] : [];
    }
    if (action.type === "look_closer") return sight?.scene && !sight.image ? [action] : [];
    if (action.type === "draw") {
      // Notes only on things that are on screen, by id or by name; a drawing
      // with nothing left is dropped.
      const marks = (action.marks ?? []).flatMap((m) => {
        if (!sight?.scene) return [];
        if (spotOf(sight.scene, m.item)) return [m];
        const named = entryNamed(sight.scene, m.item);
        return named ? [{ ...m, item: named }] : [];
      });
      return marks.length || action.flow ? [{ ...action, marks }] : [];
    }
    if (action.type === "make_file") {
      if (action.kind === "flow") return action.flow ? [action] : [];
      return action.body.trim() ? [action] : [];
    }
    if (action.type === "mcp") {
      // Only servers and tools the user actually connected.
      const server = (state.mcpServers ?? []).find((s) => s.name === action.server);
      return server?.tools.some((t) => t.name === action.tool) ? [action] : [];
    }
    if (action.type === "answer" || action.type === "learn")
      return state.focusSkill ? [action] : [];
    return [action];
  });
  const asked = reply.asked && unanswered.has(reply.asked) ? reply.asked : null;
  return { ...reply, actions, asked };
}

export async function persunaObserve(
  client: ModelClient,
  input: { name: string; focus: string | null; recentSteps: string[]; frame: string },
): Promise<PersunaObservation> {
  const { value } = await completeJson(
    client,
    "extract",
    persunaObserveMessages(input.name, input.focus, input.recentSteps.slice(-6), input.frame),
    persunaObservation,
    { maxTokens: 2048 },
  );
  return value;
}

/**
 * Work mode: one look at what the user is doing (the list of what's on screen,
 * and the picture only when the list is thin), and whether to step in.
 */
export async function persunaWorkLook(
  client: ModelClient,
  input: {
    state: PersunaState;
    scene: Scene;
    image: string | null;
    /** The last few things they were doing ("Safari — Search results"), oldest first. */
    trail: string[];
    recentSteps: string[];
    /** False when Persuna spoke up a moment ago: it may only follow quietly. */
    mayInterrupt: boolean;
    /** Where the pointer is, and for how long it has stayed there (seconds). */
    pointer?: { x: number; y: number; still: number } | null;
  },
): Promise<PersunaWork> {
  const under = input.pointer ? entryAt(input.scene, input.pointer) : null;
  const { value } = await completeJson(
    client,
    input.image ? "listen" : "draft",
    persunaWorkMessages({
      state: input.state,
      scene: sceneForModel(input.scene),
      image: input.image,
      trail: input.trail.slice(-6),
      recentSteps: input.recentSteps.slice(-6),
      mayInterrupt: input.mayInterrupt,
      pointer: input.pointer
        ? {
            over: under ? `${under.id} ${under.kind} "${under.label.replace(/\s+/g, " ")}"` : null,
            still: Math.round(input.pointer.still),
          }
        : null,
    }),
    persunaWork,
    { maxTokens: 2048 },
  );
  const point = value.point && spotOf(input.scene, value.point) ? value.point : null;
  const skill =
    value.skill && input.state.skills.some((s) => s.slug === value.skill) ? value.skill : null;
  if (!input.mayInterrupt || value.mode === "quiet" || value.mode === "follow" || !value.say) {
    return {
      mode: value.mode === "quiet" ? "quiet" : "follow",
      fit: value.fit ?? null,
      skill,
      say: null,
      point: null,
      offer: null,
      step: value.step ?? null,
    };
  }
  return {
    ...value,
    skill,
    fit: value.fit ?? null,
    point:
      value.mode === "guide" || value.mode === "explain" || value.mode === "correct" ? point : null,
    offer: value.mode === "lead" ? (value.offer ?? null) : null,
  };
}
