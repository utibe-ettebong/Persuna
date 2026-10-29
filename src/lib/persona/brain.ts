/**
 * Persona's thinking with no storage attached: one chat turn, one look at the
 * screen. Like the training engine, it takes a {@link ModelClient} so tests
 * and the offline mock run the same code as live models.
 */
import type { ModelClient } from "@/lib/models/gateway";
import { completeJson } from "@/lib/models/json";
import {
  personaChatMessages,
  personaObserveMessages,
  personaWorkMessages,
} from "@/lib/skill/prompts";
import { sceneForModel, spotOf, type Scene } from "./scene";
import {
  personaObservation,
  personaReply,
  personaWork,
  type PersonaAction,
  type PersonaObservation,
  type PersonaReply,
  type PersonaState,
  type PersonaTurn,
  type PersonaWork,
} from "./types";

/** What's on screen as Persona sees it for one turn (see the service's Sight). */
type Sight = { scene: Scene | null; image: string | null; circled?: boolean };

/** A file handed to Persona: its name, and its text or (for a picture) a data URL. */
export interface PersonaFile {
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
export async function personaTurn(
  client: ModelClient,
  state: PersonaState,
  history: PersonaTurn[],
  message: string | { audio: string },
  /**
   * What's on the user's screen right now, when Persona may look: the list of
   * it read on their computer, and the screenshot when the list isn't enough.
   */
  sight: Sight | null = null,
  /** A file the user handed Persona with this message: its text, or a picture. */
  file: PersonaFile | null = null,
): Promise<PersonaReply> {
  const { value } = await completeJson(
    client,
    // Hearing and pictures go to Meta's Muse Spark (the LISTEN role); text,
    // including the list of what's on screen, to the drafting model.
    typeof message === "string" && !sight?.image && !file?.image ? "draft" : "listen",
    personaChatMessages(
      state,
      history.slice(-HISTORY_TURNS),
      message,
      sight && {
        scene: sight.scene && sceneForModel(sight.scene),
        image: sight.image,
        circled: Boolean(sight.circled),
      },
      file,
    ),
    personaReply,
    // Room for "thinking" models to reason before the short reply.
    { maxTokens: 4096 },
  );
  return tidyReply(value, state, sight);
}

/**
 * Drops actions the state can't support, so a confused model can't save an
 * answer nobody asked for or point the focus at someone else's skill.
 */
export function tidyReply(
  reply: PersonaReply,
  state: PersonaState,
  sight: Sight | null = null,
): PersonaReply {
  const slugs = new Set(state.skills.map((s) => s.slug));
  const unanswered = new Set(state.focusSkill?.unanswered.map((q) => q.key) ?? []);
  const actions = reply.actions.flatMap((action): PersonaAction[] => {
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
      // Only entries that exist, and things it could look for in a picture it has.
      const item =
        action.item && sight?.scene && spotOf(sight.scene, action.item) ? action.item : null;
      const thing = !item && sight?.image ? (action.thing ?? null) : null;
      return item || thing ? [{ type: "point" as const, item, thing }] : [];
    }
    if (action.type === "look_closer") return sight?.scene && !sight.image ? [action] : [];
    if (action.type === "draw") {
      // Notes only on things that are on screen; a drawing with nothing left is dropped.
      const marks = (action.marks ?? []).filter((m) => sight?.scene && spotOf(sight.scene, m.item));
      return marks.length || action.flow ? [{ ...action, marks }] : [];
    }
    if (action.type === "make_file") {
      if (action.kind === "flow") return action.flow ? [action] : [];
      return action.body.trim() ? [action] : [];
    }
    if (action.type === "answer" || action.type === "learn")
      return state.focusSkill ? [action] : [];
    return [action];
  });
  const asked = reply.asked && unanswered.has(reply.asked) ? reply.asked : null;
  return { ...reply, actions, asked };
}

export async function personaObserve(
  client: ModelClient,
  input: { name: string; focus: string | null; recentSteps: string[]; frame: string },
): Promise<PersonaObservation> {
  const { value } = await completeJson(
    client,
    "extract",
    personaObserveMessages(input.name, input.focus, input.recentSteps.slice(-6), input.frame),
    personaObservation,
    { maxTokens: 2048 },
  );
  return value;
}

/**
 * Work mode: one look at what the user is doing (the list of what's on screen,
 * and the picture only when the list is thin), and whether to step in.
 */
export async function personaWorkLook(
  client: ModelClient,
  input: {
    state: PersonaState;
    scene: Scene;
    image: string | null;
    /** The last few things they were doing ("Safari — Search results"), oldest first. */
    trail: string[];
    recentSteps: string[];
    /** False when Persona spoke up a moment ago: it may only follow quietly. */
    mayInterrupt: boolean;
  },
): Promise<PersonaWork> {
  const { value } = await completeJson(
    client,
    input.image ? "listen" : "draft",
    personaWorkMessages({
      state: input.state,
      scene: sceneForModel(input.scene),
      image: input.image,
      trail: input.trail.slice(-6),
      recentSteps: input.recentSteps.slice(-6),
      mayInterrupt: input.mayInterrupt,
    }),
    personaWork,
    { maxTokens: 2048 },
  );
  const point = value.point && spotOf(input.scene, value.point) ? value.point : null;
  if (!input.mayInterrupt || value.mode === "quiet" || value.mode === "follow") {
    return {
      mode: value.mode === "quiet" ? "quiet" : "follow",
      say: null,
      point: null,
      offer: null,
      step: value.step ?? null,
    };
  }
  return {
    ...value,
    point: value.mode === "guide" ? point : null,
    offer: value.mode === "lead" ? (value.offer ?? null) : null,
  };
}
