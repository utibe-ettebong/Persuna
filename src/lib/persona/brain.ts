/**
 * Persona's thinking with no storage attached: one chat turn, one look at the
 * screen. Like the training engine, it takes a {@link ModelClient} so tests
 * and the offline mock run the same code as live models.
 */
import type { ModelClient } from "@/lib/models/gateway";
import { completeJson } from "@/lib/models/json";
import { personaChatMessages, personaObserveMessages } from "@/lib/skill/prompts";
import {
  personaObservation,
  personaReply,
  type PersonaAction,
  type PersonaObservation,
  type PersonaReply,
  type PersonaState,
  type PersonaTurn,
} from "./types";

/** How many earlier messages go back to the model with each turn. */
export const HISTORY_TURNS = 12;

export async function personaTurn(
  client: ModelClient,
  state: PersonaState,
  history: PersonaTurn[],
  text: string,
): Promise<PersonaReply> {
  const { value } = await completeJson(
    client,
    "draft",
    personaChatMessages(state, history.slice(-HISTORY_TURNS), text),
    personaReply,
    // Room for "thinking" models to reason before the short reply.
    { maxTokens: 4096 },
  );
  return tidyReply(value, state);
}

/**
 * Drops actions the state can't support, so a confused model can't save an
 * answer nobody asked for or point the focus at someone else's skill.
 */
export function tidyReply(reply: PersonaReply, state: PersonaState): PersonaReply {
  const slugs = new Set(state.skills.map((s) => s.slug));
  const unanswered = new Set(state.focusSkill?.unanswered.map((q) => q.key) ?? []);
  const actions = reply.actions.flatMap((action): PersonaAction[] => {
    if (action.type === "open_page" && action.page === "skill" && !slugs.has(action.skill ?? ""))
      return [{ ...action, page: "skills" as const, skill: null }];
    if (action.type === "run_task" || action.type === "coach")
      return [{ ...action, skill: action.skill && slugs.has(action.skill) ? action.skill : null }];
    if (action.type === "set_focus")
      return [{ ...action, skill: action.skill && slugs.has(action.skill) ? action.skill : null }];
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
