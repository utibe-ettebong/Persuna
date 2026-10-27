/**
 * Persona's storage: the profile (name, avatar, memory, today's focus), the
 * conversation and the notes. Applies the actions the brain returns. Learning
 * goes through the skill service, so taught rules arrive as proposals the
 * owner reviews, with names and identifiers removed first.
 */
import { and, desc, eq } from "drizzle-orm";
import { db, schema } from "@/db/client";
import type { PersonaMessage, PersonaNote } from "@/db/schema";
import { audit, type Actor } from "@/lib/audit";
import type { ModelClient } from "@/lib/models/gateway";
import { findNames } from "@/lib/skill/engine";
import { INTERVIEW_QUESTIONS, type InterviewAnswers } from "@/lib/skill/interview";
import { redact, redactTogether, scanText } from "@/lib/skill/redact";
import {
  NotFoundError,
  listSkills,
  proposeFromMethodNotes,
  saveInterview,
} from "@/lib/skill/service";
import { normalizeText } from "@/lib/text";
import { personaObserve, personaTurn, HISTORY_TURNS } from "./brain";
import type { PersonaState } from "./types";

const { personaProfiles, personaMessages, personaNotes, skills } = schema;

export const MAX_MEMORY = 30;
export const AVATARS = ["🦉", "🤖", "🦊", "🐙", "🌱", "✨", "🐝", "🪴"] as const;

export async function getProfile(userId: string) {
  await db().insert(personaProfiles).values({ userId }).onConflictDoNothing();
  const profile = await db().query.personaProfiles.findFirst({
    where: eq(personaProfiles.userId, userId),
  });
  if (!profile) throw new Error("Couldn't load your Persona");
  return profile;
}

export async function recentMessages(userId: string, limit = 40): Promise<PersonaMessage[]> {
  const rows = await db()
    .select()
    .from(personaMessages)
    .where(eq(personaMessages.userId, userId))
    .orderBy(desc(personaMessages.createdAt))
    .limit(limit);
  return rows.reverse();
}

/** Everything the companion needs on first render. */
export async function companion(userId: string) {
  const [profile, messages] = await Promise.all([getProfile(userId), recentMessages(userId)]);
  const focusSkill = profile.focusSkillId
    ? await db().query.skills.findFirst({ where: eq(skills.id, profile.focusSkillId) })
    : null;
  return {
    profile,
    messages,
    focusSkill: focusSkill ? { slug: focusSkill.slug, name: focusSkill.name } : null,
  };
}

/**
 * The daily check-in. Once per day (the user's local date), Persona asks what
 * you're working on. No model call: it's the same question every morning.
 */
export async function checkIn(userId: string, day: string): Promise<PersonaMessage | null> {
  const profile = await getProfile(userId);
  if (profile.checkinDay === day) return null;
  const claimed = await db()
    .update(personaProfiles)
    .set({ checkinDay: day, updatedAt: new Date() })
    .where(eq(personaProfiles.userId, userId))
    .returning();
  if (!claimed.length) return null;
  const greeting = profile.focus
    ? `Good to see you. Yesterday we were on ${profile.focus}. What are we working on today?`
    : "Hi, I'm here. What are we working on today?";
  const [message] = await db()
    .insert(personaMessages)
    .values({ userId, role: "assistant", kind: "checkin", content: greeting })
    .returning();
  return message;
}

async function stateFor(userId: string, day: string): Promise<PersonaState> {
  const profile = await getProfile(userId);
  const owned = await listSkills(userId);
  const focus = owned.find((s) => s.id === profile.focusSkillId) ?? null;
  const [last] = await db()
    .select()
    .from(personaMessages)
    .where(eq(personaMessages.userId, userId))
    .orderBy(desc(personaMessages.createdAt))
    .limit(1);
  return {
    today: day,
    name: profile.name,
    memory: profile.memory,
    focus: profile.focus,
    focusSkill: focus
      ? {
          slug: focus.slug,
          name: focus.name,
          task: focus.taskDescription,
          hasRules: Boolean(focus.currentVersionId),
          unanswered: INTERVIEW_QUESTIONS.filter((q) => !focus.interview?.[q.key]?.trim()).map(
            (q) => ({ key: q.key, question: q.question }),
          ),
        }
      : null,
    skills: owned.map((s) => ({ slug: s.slug, name: s.name })),
    lastAsked:
      last?.role === "assistant" ? ((last.askedKey as PersonaState["lastAsked"]) ?? null) : null,
  };
}

export interface ChatResult {
  messages: PersonaMessage[];
  /** Something the reply produced that the user can open (a note, a proposal). */
  link: { href: string; label: string } | null;
  focus: { text: string | null; skill: { slug: string; name: string } | null };
}

/** One message from the user: think, apply the actions, save both sides. */
export async function chat(
  client: ModelClient,
  userId: string,
  input: { text: string; day: string; actor: Actor },
): Promise<ChatResult> {
  const text = normalizeText(input.text).slice(0, 4000);
  if (!text) throw new Error("Say something first");
  const state = await stateFor(userId, input.day);
  const history = (await recentMessages(userId, HISTORY_TURNS)).map((m) => ({
    role: m.role,
    content: m.content,
  }));
  const reply = await personaTurn(client, state, history, text);

  const profile = await getProfile(userId);
  const owned = await listSkills(userId);
  const focusSkill = owned.find((s) => s.id === profile.focusSkillId) ?? null;
  let memory = [...profile.memory];
  let focus = profile.focus;
  let focusSkillId = profile.focusSkillId;
  let link: ChatResult["link"] = null;
  const extra: string[] = [];

  for (const action of reply.actions) {
    if (action.type === "remember") {
      if (!memory.some((m) => m.toLowerCase() === action.fact.toLowerCase())) {
        memory = [...memory, action.fact].slice(-MAX_MEMORY);
      }
    } else if (action.type === "note") {
      await db().insert(personaNotes).values({
        userId,
        title: action.title,
        body: action.body,
        source: "chat",
        skillId: focusSkillId,
      });
      link = { href: "/persona", label: "Open your notes" };
    } else if (action.type === "set_focus") {
      focus = action.focus;
      focusSkillId = owned.find((s) => s.slug === action.skill)?.id ?? null;
    } else if (action.type === "answer" && focusSkill) {
      const answers: InterviewAnswers = { ...(focusSkill.interview ?? {}) };
      answers[action.key] = [answers[action.key], redact(action.answer)]
        .filter(Boolean)
        .join("\n\n");
      await saveInterview(focusSkill.id, answers);
      link = { href: `/skills/${focusSkill.slug}/interview`, label: "See your answers" };
    } else if (action.type === "learn" && focusSkill) {
      try {
        link = await teach(client, focusSkill, action.method, input.actor);
      } catch (error) {
        console.error(error);
        extra.push(
          `(I couldn't turn that into a rule change just now: ${(error as Error).message})`,
        );
      }
    }
  }

  await db()
    .update(personaProfiles)
    .set({ memory, focus, focusSkillId, updatedAt: new Date() })
    .where(eq(personaProfiles.userId, userId));

  const saved = await db()
    .insert(personaMessages)
    .values([
      { userId, role: "user", content: text, skillId: focusSkill?.id ?? null },
      {
        userId,
        role: "assistant",
        content: [reply.reply, ...extra].join(" "),
        askedKey: reply.asked ?? null,
        skillId: focusSkillId,
      },
    ])
    .returning();
  // Same timestamp for both rows: keep the user's message first.
  saved.sort((a, b) => (a.role === b.role ? 0 : a.role === "user" ? -1 : 1));

  const focusRow = owned.find((s) => s.id === focusSkillId) ?? null;
  return {
    messages: saved,
    link,
    focus: { text: focus, skill: focusRow ? { slug: focusRow.slug, name: focusRow.name } : null },
  };
}

/**
 * Turns something the user taught (in chat or by letting Persona watch) into
 * a proposed rule change, or into interview notes before rules exist. Names
 * and identifiers are removed first; the skill keeps the method only.
 */
async function teach(
  client: ModelClient,
  skill: {
    id: string;
    slug: string;
    name: string;
    currentVersionId: string | null;
    interview: InterviewAnswers | null;
  },
  method: string,
  actor: Actor,
): Promise<NonNullable<ChatResult["link"]>> {
  const entities = await findNames(client, [method]);
  const [clean] = redactTogether([method], [scanText(method, entities)], entities);
  await audit({
    actor,
    action: "persona.taught",
    entityType: "skill",
    entityId: skill.id,
    skillId: skill.id,
    details: { chars: clean.length },
  });
  if (!skill.currentVersionId) {
    const answers: InterviewAnswers = { ...(skill.interview ?? {}) };
    answers.steps = [answers.steps, clean].filter(Boolean).join("\n\n");
    await saveInterview(skill.id, answers);
    return { href: `/skills/${skill.slug}/interview`, label: "See what I learned" };
  }
  const proposal = await proposeFromMethodNotes(client, skill.id, "companion", clean);
  return { href: `/corrections/${proposal.id}`, label: "Review the proposed change" };
}

/**
 * One look at the window the user chose to share. Steps go into a single
 * "watched" note per session; the frame itself is never stored.
 */
export async function observe(
  client: ModelClient,
  userId: string,
  input: { frame: string; noteId: string | null },
): Promise<{
  say: string | null;
  step: string | null;
  noteId: string | null;
  message: PersonaMessage | null;
}> {
  const profile = await getProfile(userId);
  const note = input.noteId ? await ownedNote(userId, input.noteId) : null;
  const recentSteps = note ? note.body.split("\n").filter(Boolean) : [];
  const seen = await personaObserve(client, {
    name: profile.name,
    focus: profile.focus,
    recentSteps,
    frame: input.frame,
  });

  let noteId = note?.id ?? null;
  const step = seen.step ? redact(seen.step) : null;
  if (step && !recentSteps.includes(step)) {
    if (note) {
      await db()
        .update(personaNotes)
        .set({ body: [...recentSteps, step].join("\n") })
        .where(eq(personaNotes.id, note.id));
    } else {
      const [created] = await db()
        .insert(personaNotes)
        .values({
          userId,
          title: `Watched: ${profile.focus ?? "your screen"}`,
          body: step,
          source: "screen",
          skillId: profile.focusSkillId,
        })
        .returning();
      noteId = created.id;
    }
  }

  let message: PersonaMessage | null = null;
  if (seen.say) {
    [message] = await db()
      .insert(personaMessages)
      .values({ userId, role: "assistant", kind: "observation", content: seen.say })
      .returning();
  }
  return { say: seen.say ?? null, step, noteId, message };
}

/** Teaches the steps from a watched (or any) note to the focus skill. */
export async function teachFromNote(
  client: ModelClient,
  userId: string,
  noteId: string,
  actor: Actor,
) {
  const note = await ownedNote(userId, noteId);
  const profile = await getProfile(userId);
  const skillId = note.skillId ?? profile.focusSkillId;
  if (!skillId) {
    throw new Error("Tell Persona which skill you're working on first (\"I'm working on…\").");
  }
  const skill = await db().query.skills.findFirst({
    where: and(eq(skills.id, skillId), eq(skills.ownerId, userId)),
  });
  if (!skill) throw new NotFoundError("That skill isn't yours");
  const body = note.source === "screen" ? `Steps seen on screen:\n${note.body}` : note.body;
  return teach(client, skill, body, actor);
}

async function ownedNote(userId: string, noteId: string): Promise<PersonaNote> {
  const note = await db().query.personaNotes.findFirst({
    where: and(eq(personaNotes.id, noteId), eq(personaNotes.userId, userId)),
  });
  if (!note) throw new NotFoundError("No such note");
  return note;
}

export async function listNotes(userId: string) {
  return db()
    .select({ note: personaNotes, skillName: skills.name, skillSlug: skills.slug })
    .from(personaNotes)
    .leftJoin(skills, eq(personaNotes.skillId, skills.id))
    .where(eq(personaNotes.userId, userId))
    .orderBy(desc(personaNotes.createdAt));
}

export async function deleteNote(userId: string, noteId: string) {
  await db()
    .delete(personaNotes)
    .where(and(eq(personaNotes.id, noteId), eq(personaNotes.userId, userId)));
}

export async function addNote(userId: string, input: { title: string; body: string }) {
  const profile = await getProfile(userId);
  await db().insert(personaNotes).values({
    userId,
    title: input.title,
    body: input.body,
    skillId: profile.focusSkillId,
  });
}

export async function updateProfile(
  userId: string,
  input: { name?: string; avatar?: string; focus?: string | null },
) {
  await getProfile(userId);
  await db()
    .update(personaProfiles)
    .set({
      ...(input.name !== undefined && { name: input.name }),
      ...(input.avatar !== undefined && { avatar: input.avatar }),
      ...(input.focus !== undefined && {
        focus: input.focus,
        ...(input.focus === null && { focusSkillId: null }),
      }),
      updatedAt: new Date(),
    })
    .where(eq(personaProfiles.userId, userId));
}

export async function forgetFact(userId: string, index: number) {
  const profile = await getProfile(userId);
  await db()
    .update(personaProfiles)
    .set({ memory: profile.memory.filter((_, i) => i !== index), updatedAt: new Date() })
    .where(eq(personaProfiles.userId, userId));
}

export async function clearConversation(userId: string) {
  await db().delete(personaMessages).where(eq(personaMessages.userId, userId));
}
