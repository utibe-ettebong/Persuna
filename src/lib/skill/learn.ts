import { and, asc, count, desc, eq, lt } from "drizzle-orm";
import { z } from "zod";
import { db, schema } from "@/db/client";
import type { Episode, SkillStep } from "@/db/schema";
import { audit, type Actor } from "@/lib/audit";
import type { ModelClient } from "@/lib/models/gateway";
import { screenField } from "@/lib/persuna/fields";
import { describeScreens, findNames } from "./engine";
import { recordEvidence, touchedRuleIds } from "./evidence";
import { fitnessOf, mergeSteps, stepsFromEvents, type EpisodeEventInput } from "./episodes";
import { redactTogether, scanText } from "./redact";
import { NotFoundError, proposeFromMethodNotes, saveInterview } from "./service";

const { episodeEvents, episodeFrames, episodes, skills, skillSteps, skillVersions } = schema;

/** What the desktop stream may report: a change, never a value. */
export const episodeEventField = z.object({
  app: z.string().trim().min(1).max(200),
  window: z.string().trim().max(300).default(""),
  action: z.enum(["switch", "focus", "select", "open", "close"]),
  role: z.string().trim().max(100).default(""),
  label: z.string().trim().max(300).default(""),
  at: z.coerce.date(),
});

export const episodeEventsField = z.array(episodeEventField).min(1).max(200);

/** Screenshots ride along only at step changes; this caps a runaway recorder. */
const MAX_FRAMES_PER_EPISODE = 120;

async function ownedSkill(userId: string, skillId: string) {
  const [skill] = await db()
    .select()
    .from(skills)
    .where(and(eq(skills.id, skillId), eq(skills.ownerId, userId)))
    .limit(1);
  if (!skill) throw new NotFoundError("No such skill");
  return skill;
}

async function ownedEpisode(userId: string, episodeId: string) {
  const [episode] = await db()
    .select()
    .from(episodes)
    .where(and(eq(episodes.id, episodeId), eq(episodes.userId, userId)))
    .limit(1);
  if (!episode) throw new NotFoundError("No such episode");
  return episode;
}

/**
 * Starts recording an episode for a skill. One recording at a time: starting
 * the same skill again resumes (the client reattaches its stream); a
 * different skill has to wait for this one to stop.
 */
export async function startEpisode(userId: string, actor: Actor, skillId: string) {
  const skill = await ownedSkill(userId, skillId);
  await sweepAbandonedEpisodes(userId);
  const [recording] = await db()
    .select()
    .from(episodes)
    .where(and(eq(episodes.userId, userId), eq(episodes.status, "recording")))
    .limit(1);
  if (recording) {
    if (recording.skillId !== skillId) {
      const [other] = await db()
        .select({ name: skills.name })
        .from(skills)
        .where(eq(skills.id, recording.skillId))
        .limit(1);
      throw new Error(`Already recording ${other?.name ?? "another skill"} — say "done" first.`);
    }
    return { episode: recording, resumed: true as const };
  }
  const [episode] = await db().insert(episodes).values({ userId, skillId }).returning();
  await audit({
    actor,
    action: "episode.started",
    entityType: "skill",
    entityId: skillId,
    skillId,
    details: { episodeId: episode.id, skill: skill.name },
  });
  return { episode, resumed: false as const };
}

/** Appends a batch of observed actions to a recording episode. */
export async function appendEpisodeEvents(
  userId: string,
  episodeId: string,
  events: EpisodeEventInput[],
) {
  const episode = await ownedEpisode(userId, episodeId);
  if (episode.status !== "recording") throw new Error("This episode already ended.");
  await db()
    .insert(episodeEvents)
    .values(
      events.map((event) => ({
        episodeId,
        app: event.app,
        window: event.window,
        action: event.action,
        role: event.role,
        label: event.label,
        at: event.at,
      })),
    );
  return { inserted: events.length };
}

/** Keeps one screenshot at a step change, until the extraction pass deletes it. */
export async function appendEpisodeFrame(
  userId: string,
  episodeId: string,
  frame: string,
  at: Date,
) {
  const episode = await ownedEpisode(userId, episodeId);
  if (episode.status !== "recording") throw new Error("This episode already ended.");
  const image = screenField.parse(frame);
  if (!image) throw new Error("That frame couldn't be read");
  const [{ frames }] = await db()
    .select({ frames: count() })
    .from(episodeFrames)
    .where(eq(episodeFrames.episodeId, episodeId));
  if (frames >= MAX_FRAMES_PER_EPISODE) throw new Error("This episode has enough frames.");
  await db().insert(episodeFrames).values({ episodeId, at, image });
}

/** A recording episode's events, oldest first. */
export async function episodeEventsOf(episodeId: string) {
  return db()
    .select()
    .from(episodeEvents)
    .where(eq(episodeEvents.episodeId, episodeId))
    .orderBy(asc(episodeEvents.at));
}

const narrationField = z.string().trim().max(4000);

/**
 * Stops a recording episode (no model call, so the brain can do it mid-turn).
 * Learning runs when the client finalizes with its narration, or on the next
 * periodic pass for episodes that never finalize.
 */
export async function stopEpisode(userId: string, actor: Actor, episodeId: string) {
  const episode = await ownedEpisode(userId, episodeId);
  if (episode.status !== "recording") throw new Error("This episode already ended.");
  const events = await episodeEventsOf(episodeId);
  const apps = [...new Set(events.map((event) => event.app))];
  await db()
    .update(episodes)
    .set({ status: "done", endedAt: new Date(), apps })
    .where(eq(episodes.id, episodeId));
  await audit({
    actor,
    action: "episode.stopped",
    entityType: "skill",
    entityId: episode.skillId,
    skillId: episode.skillId,
    details: { episodeId, events: events.length, apps: apps.length },
  });
  return episode;
}

/** The user's recording episode, if one is running. */
export async function recordingEpisode(userId: string) {
  const [episode] = await db()
    .select()
    .from(episodes)
    .where(and(eq(episodes.userId, userId), eq(episodes.status, "recording")))
    .limit(1);
  return episode ?? null;
}

/**
 * The client stopped recording and hands over what was said while doing it:
 * now the episode is learned from (steps merge, rules proposed, screenshots
 * deleted).
 */
export async function finalizeEpisode(
  client: ModelClient,
  userId: string,
  actor: Actor,
  episodeId: string,
  narration: string,
) {
  const episode = await ownedEpisode(userId, episodeId);
  if (episode.status !== "done") throw new Error("This episode isn't ready to learn from.");
  await db()
    .update(episodes)
    .set({ narration: narrationField.parse(narration) })
    .where(eq(episodes.id, episodeId));
  try {
    return await extractEpisode(client, episodeId, actor);
  } catch (error) {
    await failEpisode(episodeId);
    throw error;
  }
}

/** A recording left running this long was abandoned (the app closed, the Mac slept). */
const ABANDONED_AFTER_MS = 6 * 60 * 60_000;

/** Screenshots are for one extraction: a failed episode doesn't keep them. */
async function failEpisode(episodeId: string) {
  await db().update(episodes).set({ status: "failed" }).where(eq(episodes.id, episodeId));
  await db().delete(episodeFrames).where(eq(episodeFrames.episodeId, episodeId));
}

/** Recordings nobody finished: closes them and drops their screenshots. */
async function sweepAbandonedEpisodes(userId?: string) {
  const cutoff = new Date(Date.now() - ABANDONED_AFTER_MS);
  const stale = await db()
    .select({ id: episodes.id })
    .from(episodes)
    .where(
      and(
        eq(episodes.status, "recording"),
        lt(episodes.startedAt, cutoff),
        userId ? eq(episodes.userId, userId) : undefined,
      ),
    );
  for (const { id } of stale) await failEpisode(id);
}

/** Strips names from stored labels, windows and narration (one pass, then kept clean). */
async function redactEpisode(
  client: ModelClient,
  episodeId: string,
  events: { id: string; window: string; label: string }[],
  narration: string,
) {
  const items = [
    ...events.map((event) => ({ id: event.id, text: `${event.window}\n${event.label}` })),
    { id: null as string | null, text: narration },
  ];
  const dirty = items.filter((item) => item.text.trim().length > 0);
  if (dirty.length === 0) return narration;
  const entities = await findNames(
    client,
    dirty.map((item) => item.text),
  );
  const cleaned = redactTogether(
    dirty.map((item) => item.text),
    dirty.map((item) => scanText(item.text, entities)),
    entities,
  );
  let cleanNarration = narration;
  for (const [index, item] of dirty.entries()) {
    const clean = cleaned[index] ?? "";
    if (item.id === null) {
      cleanNarration = clean;
      continue;
    }
    const [window, ...label] = clean.split("\n");
    await db()
      .update(episodeEvents)
      .set({ window: window ?? "", label: label.join("\n") })
      .where(eq(episodeEvents.id, item.id));
  }
  await db().update(episodes).set({ narration: cleanNarration }).where(eq(episodes.id, episodeId));
  return cleanNarration;
}

function renderEvents(
  events: { at: Date; app: string; window: string; action: string; role: string; label: string }[],
) {
  return events
    .map((event) => {
      const at = event.at.toISOString().slice(11, 19);
      const what = [event.role, event.label].filter(Boolean).join(" ");
      const where = event.window ? ` (${event.window.slice(0, 80)})` : "";
      return `${at} ${event.app}${where} — ${event.action}${what ? `: ${what}` : ""}`;
    })
    .join("\n");
}

/**
 * The learning pass over one episode: steps merge into the procedure
 * (observations, kept freely), rules go through the corrections flow with
 * this episode as evidence, and the screenshots are deleted. Nothing to
 * learn from (no events, frames or narration) ends the episode quietly.
 */
export async function extractEpisode(client: ModelClient, episodeId: string, actor: Actor) {
  const [episode] = await db().select().from(episodes).where(eq(episodes.id, episodeId)).limit(1);
  if (!episode) throw new NotFoundError("No such episode");
  if (episode.status !== "done") throw new Error("This episode isn't ready to learn from.");
  const skill = await ownedSkill(episode.userId, episode.skillId);
  const frames = await db()
    .select()
    .from(episodeFrames)
    .where(eq(episodeFrames.episodeId, episodeId))
    .orderBy(asc(episodeFrames.at));
  const narration = await redactEpisode(
    client,
    episodeId,
    await episodeEventsOf(episodeId),
    episode.narration,
  );
  const events = await episodeEventsOf(episodeId);
  if (events.length === 0 && frames.length === 0 && !narration) {
    await db().update(episodes).set({ status: "extracted" }).where(eq(episodes.id, episodeId));
    return { proposalId: null as string | null, steps: 0, newSteps: 0 };
  }

  // Steps first: what was seen, merged into the procedure in order.
  const observed = stepsFromEvents(events);
  const current = await db()
    .select()
    .from(skillSteps)
    .where(eq(skillSteps.skillId, skill.id))
    .orderBy(asc(skillSteps.seq));
  const { updates, inserts } = mergeSteps(current, observed, episodeId);
  for (const update of updates) {
    await db()
      .update(skillSteps)
      .set({
        seq: update.seq,
        evidenceCount: update.evidenceCount,
        episodeIds: update.episodeIds,
        ...(update.decisionKey !== undefined ? { decisionKey: update.decisionKey } : {}),
        ...(update.branchLabel !== undefined ? { branchLabel: update.branchLabel } : {}),
      })
      .where(eq(skillSteps.id, update.id));
  }
  if (inserts.length > 0) {
    await db()
      .insert(skillSteps)
      .values(
        inserts.map((insert) => ({
          skillId: skill.id,
          seq: insert.seq,
          app: insert.app,
          action: insert.action,
          targetRole: insert.targetRole,
          targetLabel: insert.targetLabel,
          decisionKey: insert.decisionKey ?? null,
          branchLabel: insert.branchLabel ?? null,
          episodeIds: [episodeId],
        })),
      );
  }

  // Rules next: events plus screenshots plus narration, the way the screen
  // walkthrough does it — proposed, never applied, with evidence attached.
  const seen =
    frames.length > 0
      ? await describeScreens(
          client,
          skill,
          narration,
          frames.map((frame) => frame.image),
        )
      : "";
  const notes = [
    events.length > 0 && `Steps seen on screen:\n${renderEvents(events)}`,
    seen && `What the screenshots show:\n${seen}`,
    narration && `What they said:\n${narration}`,
  ]
    .filter((part): part is string => typeof part === "string" && part.length > 0)
    .join("\n\n");
  let proposalId: string | null = null;
  if (skill.currentVersionId) {
    const proposal = await proposeFromMethodNotes(client, skill.id, "episode", notes);
    const fromVersion = await db().query.skillVersions.findFirst({
      where: eq(skillVersions.id, skill.currentVersionId),
    });
    if (!fromVersion) throw new NotFoundError("No such skill version");
    const { added, updated } = touchedRuleIds(
      proposal.ruleOps,
      fromVersion.sheet,
      proposal.proposedSheet,
    );
    await recordEvidence(skill.id, [...added, ...updated], "episode", episodeId);
    proposalId = proposal.id;
  } else {
    const answers = { ...(skill.interview ?? {}) };
    answers.steps = [answers.steps, notes].filter(Boolean).join("\n\n");
    await saveInterview(skill.id, answers);
  }

  await db().delete(episodeFrames).where(eq(episodeFrames.episodeId, episodeId));
  await db().update(episodes).set({ status: "extracted" }).where(eq(episodes.id, episodeId));
  await audit({
    actor,
    action: "episode.extracted",
    entityType: "skill",
    entityId: skill.id,
    skillId: skill.id,
    details: {
      episodeId,
      steps: current.length + inserts.length,
      newSteps: inserts.length,
      proposalId,
    },
  });
  return { proposalId, steps: current.length + inserts.length, newSteps: inserts.length };
}

/**
 * The periodic pass: every stopped episode that hasn't been learned from yet
 * goes through extraction. One bad episode never stops the rest.
 */
export async function learnPass(client: ModelClient) {
  await sweepAbandonedEpisodes();
  const pending = await db()
    .select({ id: episodes.id })
    .from(episodes)
    .where(eq(episodes.status, "done"))
    .orderBy(asc(episodes.endedAt))
    .limit(20);
  const extracted: string[] = [];
  const failed: { id: string; error: string }[] = [];
  for (const { id } of pending) {
    try {
      await extractEpisode(client, id, "system");
      extracted.push(id);
    } catch (error) {
      await failEpisode(id);
      failed.push({ id, error: error instanceof Error ? error.message : "Something went wrong." });
    }
  }
  return { extracted, failed };
}

/** The skill's procedure, in order. */
export async function listSkillSteps(skillId: string): Promise<SkillStep[]> {
  return db()
    .select()
    .from(skillSteps)
    .where(eq(skillSteps.skillId, skillId))
    .orderBy(asc(skillSteps.seq));
}

/** Removes one observed step (a misread, or a step the method outgrew). */
export async function removeSkillStep(userId: string, stepId: string) {
  const [step] = await db().select().from(skillSteps).where(eq(skillSteps.id, stepId)).limit(1);
  if (!step) throw new NotFoundError("No such step");
  await ownedSkill(userId, step.skillId);
  await db().delete(skillSteps).where(eq(skillSteps.id, stepId));
  const rest = await listSkillSteps(step.skillId);
  for (const [index, remaining] of rest.entries()) {
    if (remaining.seq !== index + 1) {
      await db()
        .update(skillSteps)
        .set({ seq: index + 1 })
        .where(eq(skillSteps.id, remaining.id));
    }
  }
  await audit({
    actor: `user:${userId}`,
    action: "step.removed",
    entityType: "skill",
    entityId: step.skillId,
    skillId: step.skillId,
    details: { stepId },
  });
}

/** How well the procedure explains one episode (plan §4.4 fitness). */
export async function episodeFitness(userId: string, episodeId: string) {
  const episode = await ownedEpisode(userId, episodeId);
  const [steps, events] = await Promise.all([
    listSkillSteps(episode.skillId),
    episodeEventsOf(episodeId),
  ]);
  return fitnessOf(steps, stepsFromEvents(events));
}

/** A skill's episodes, newest first. */
export async function listEpisodes(userId: string, skillId: string): Promise<Episode[]> {
  await ownedSkill(userId, skillId);
  return db()
    .select()
    .from(episodes)
    .where(and(eq(episodes.userId, userId), eq(episodes.skillId, skillId)))
    .orderBy(desc(episodes.startedAt))
    .limit(50);
}
