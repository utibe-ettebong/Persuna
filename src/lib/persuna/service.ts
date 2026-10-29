/**
 * Persuna's storage: the profile (name, avatar, memory, today's focus), the
 * conversation and the notes. Applies the actions the brain returns. Learning
 * goes through the skill service, so taught rules arrive as proposals the
 * owner reviews, with names and identifiers removed first.
 */
import { and, asc, desc, eq, gte, inArray, isNotNull, isNull, lte, ne } from "drizzle-orm";
import { db, schema } from "@/db/client";
import type { PersunaMessage, PersunaNote } from "@/db/schema";
import { audit, type Actor } from "@/lib/audit";
import type { ModelClient } from "@/lib/models/gateway";
import type { Transcriber } from "@/lib/models/transcribe";
import { confirmAppAction, doAppTask, type AppConfirm } from "@/lib/connections/service";
import { confirmMcpCall, listMcpServers, proposeMcpCall, type McpConfirm } from "@/lib/mcp/service";
import { UsageLimitError } from "@/lib/models/usage";
import { findNames } from "@/lib/skill/engine";
import { INTERVIEW_QUESTIONS, type InterviewAnswers } from "@/lib/skill/interview";
import { redact, redactTogether, scanText } from "@/lib/skill/redact";
import { slugify } from "@/lib/action-state";
import {
  NotFoundError,
  createSampleSkill,
  createSkill,
  addPair,
  extractVersion,
  getVersion,
  latestScore,
  publishVersion,
  runEval,
  scanPair,
  listSkills,
  proposeFromMethodNotes,
  publishedScore,
  saveInterview,
  splitPairs,
} from "@/lib/skill/service";
import { normalizeText } from "@/lib/text";
import { env, modelProvider, voiceMode } from "@/env";
import { createJob, getJob, reviewJob } from "@/lib/jobs/service";
import {
  persunaObserve,
  persunaTurn,
  persunaWorkLook,
  HISTORY_TURNS,
  type PersunaFile,
} from "./brain";
import { coachSkill, suggestTestSplit, type SkillStats } from "./coach";
import { localToUtc, startOfLocalDay, utcToLocal, type OffsetMinutes } from "./when";
import { notices, unseen } from "./notices";
import {
  applyToneChange,
  effectiveTone,
  inferTone,
  toneFromMessage,
  toneInstruction,
  voiceStyle,
  type Tone,
} from "./tone";
import { buildWrapUp } from "./wrapup";
import {
  MAX_FIRST_SKILLS,
  describeSkill,
  freeSlug,
  introFacts,
  type IntroAnswers,
} from "./onboarding";
import type { Flow, PersunaReply, PersunaState } from "./types";
import { createLocator } from "@/lib/models/sam";
import { samSpot, sceneIsThin, spotOf, wantsPicture, type Scene, type Spot } from "./scene";
import { confidentialSkills } from "@/lib/teams/confidential";
import { withoutConfidential } from "@/lib/teams/rules";
import { activeOnboardingNote } from "@/lib/teams/service";

/** What Persuna may see with a message: the list of the screen, and a screenshot. */
export interface Sight {
  scene: Scene | null;
  image: string | null;
  /** The user circled part of the screen: the scene and picture are cropped to it. */
  circled?: boolean;
}

const { persunaProfiles, persunaMessages, persunaNotes, persunaReminders, skills, jobs, listings } =
  schema;

export const MAX_MEMORY = 30;
export { LOOK_IDS as AVATARS } from "./looks";

export async function getProfile(userId: string) {
  await db().insert(persunaProfiles).values({ userId }).onConflictDoNothing();
  const profile = await db().query.persunaProfiles.findFirst({
    where: eq(persunaProfiles.userId, userId),
  });
  if (!profile) throw new Error("Couldn't load your Persuna");
  // The assistant was once called "Persuna" by default; it's "Persuna" now.
  if (profile.name === "Persuna") {
    await db()
      .update(persunaProfiles)
      .set({ name: "Persuna" })
      .where(eq(persunaProfiles.userId, userId));
    return { ...profile, name: "Persuna" };
  }
  return profile;
}

export async function recentMessages(userId: string, limit = 40): Promise<PersunaMessage[]> {
  const rows = await db()
    .select()
    .from(persunaMessages)
    .where(eq(persunaMessages.userId, userId))
    // A turn's two rows share a timestamp: newest first, reply before question,
    // so that reversed, each question comes before its reply.
    .orderBy(desc(persunaMessages.createdAt), asc(persunaMessages.role))
    .limit(limit);
  return rows.reverse();
}

/** Everything the companion needs on first render. */
export async function companion(userId: string) {
  const [profile, messages] = await Promise.all([getProfile(userId), recentMessages(userId)]);
  const focusSkill = profile.focusSkillId
    ? await db().query.skills.findFirst({ where: eq(skills.id, profile.focusSkillId) })
    : null;
  const owned = await listSkills(userId);
  return {
    profile,
    messages,
    focusSkill: focusSkill ? { slug: focusSkill.slug, name: focusSkill.name } : null,
    skills: owned.map((s) => ({
      slug: s.slug,
      name: s.name,
      published: Boolean(s.publishedVersionId),
    })),
  };
}

/**
 * The daily check-in. Once per day (the user's local date), Persuna asks what
 * you're working on. No model call: it's the same question every morning.
 */
export async function checkIn(userId: string, day: string): Promise<PersunaMessage | null> {
  const profile = await getProfile(userId);
  if (profile.checkinDay === day) return null;
  const claimed = await db()
    .update(persunaProfiles)
    .set({ checkinDay: day, updatedAt: new Date() })
    .where(eq(persunaProfiles.userId, userId))
    .returning();
  if (!claimed.length) return null;
  const greeting = profile.focus
    ? `Good to see you. Yesterday we were on ${profile.focus}. What are we working on today?`
    : "Hi, I'm here. What are we working on today?";
  const [message] = await db()
    .insert(persunaMessages)
    .values({ userId, role: "assistant", kind: "checkin", content: greeting })
    .returning();
  return message;
}

/** The user's explicit tone, filled in with what Persuna noticed in their recent messages. */
async function toneFor(userId: string, explicit: Tone): Promise<Tone> {
  const recent = await db()
    .select({ content: persunaMessages.content })
    .from(persunaMessages)
    .where(and(eq(persunaMessages.userId, userId), eq(persunaMessages.role, "user")))
    .orderBy(desc(persunaMessages.createdAt))
    .limit(20);
  return effectiveTone(explicit, inferTone(recent.map((r) => r.content).reverse()));
}

/** The user's clock, sent by the browser: local day, local time and UTC offset. */
export interface Clock {
  day: string;
  now: string;
  offset: OffsetMinutes;
}

async function stateFor(userId: string, clock: Clock): Promise<PersunaState> {
  const profile = await getProfile(userId);
  const owned = await listSkills(userId);
  const todos = await openReminders(userId);
  const focus = owned.find((s) => s.id === profile.focusSkillId) ?? null;
  const focusStats = focus ? await skillStats(focus) : null;
  const [last] = await db()
    .select()
    .from(persunaMessages)
    .where(eq(persunaMessages.userId, userId))
    .orderBy(desc(persunaMessages.createdAt), asc(persunaMessages.role))
    .limit(1);
  return {
    today: clock.day,
    tone: await toneFor(userId, profile.tone),
    now: clock.now,
    name: profile.name,
    memory: profile.memory,
    focus: profile.focus,
    focusSkill: focus
      ? {
          slug: focus.slug,
          name: focus.name,
          task: focus.taskDescription,
          hasRules: Boolean(focus.currentVersionId),
          published: Boolean(focus.publishedVersionId),
          trainExamples: focusStats?.trainPairs ?? 0,
          testExamples: focusStats?.testPairs ?? 0,
          score: focusStats?.score ?? null,
          unanswered: INTERVIEW_QUESTIONS.filter((q) => !focus.interview?.[q.key]?.trim()).map(
            (q) => ({ key: q.key, question: q.question }),
          ),
        }
      : null,
    skills: owned.map((s) => ({
      slug: s.slug,
      name: s.name,
      published: Boolean(s.publishedVersionId),
    })),
    todos: todos.slice(0, 20).map((t) => t.text),
    mcpServers: (await listMcpServers(userId).catch(() => [])).slice(0, 8).map((s) => ({
      name: s.name,
      tools: s.tools.slice(0, 12).map((t) => ({
        name: t.name,
        description: t.description.slice(0, 120),
      })),
    })),
    lastAsked:
      last?.role === "assistant" && last.askedKey && !last.askedKey.startsWith(SWITCH)
        ? (last.askedKey as PersunaState["lastAsked"])
        : null,
    pendingSwitch: (() => {
      if (last?.role !== "assistant" || !last.askedKey?.startsWith(SWITCH)) return null;
      const other = owned.find((s) => s.slug === last.askedKey!.slice(SWITCH.length));
      return other ? { slug: other.slug, name: other.name } : null;
    })(),
    onboarding: await activeOnboardingNote(userId),
  };
}

/** askedKey prefix marking "Persuna asked whether to switch to this skill". */
const SWITCH = "switch:";

export interface ChatResult {
  messages: PersunaMessage[];
  /** Something the reply produced that the user can open (a note, a proposal). */
  link: { href: string; label: string } | null;
  focus: { text: string | null; skill: { slug: string; name: string } | null };
  /** Set when Persuna should ask for a task's input: the skill to run, if one was named. */
  task: { skill: string | null } | null;
  /** True when a reminder was set, so the browser can ask to show notifications. */
  reminderSet: boolean;
  /** A page Persuna should take the user to. */
  navigate: string | null;
  /** Persuna wants an example for this skill: the app shows the example card. */
  example: { skill: { slug: string; name: string } } | null;
  /** Something the user must confirm before it happens (publishing). */
  confirm: PublishConfirm | null;
  /** Persuna asked whether to switch to this skill. */
  switchTo: { slug: string; name: string } | null;
  /** Start or stop watching the screen (starting still asks the user's permission). */
  watch: "start" | "stop" | null;
  /** A send or create in the user's apps, waiting for their OK. */
  appConfirm: AppConfirm | null;
  /** A tool call on one of the user's MCP servers, waiting for their OK. */
  mcpConfirm: McpConfirm | null;
  /** Where on screen to show the user something (Persuna Desktop draws it). */
  point: Spot | null;
  /** Text to copy, or to paste where the user's cursor is. */
  clipboard: { op: "copy" | "paste"; text: string } | null;
  /** Something to draw over the screen: numbered notes on things, and/or a diagram. */
  drawing: Drawing | null;
  /** A file Persuna made, to preview, copy and save. */
  file: MadeFile | null;
}

export interface Drawing {
  title: string | null;
  marks: { n: number; note: string; spot: Spot }[];
  flow: Flow | null;
}

export interface MadeFile {
  kind: "document" | "table" | "flow";
  title: string;
  body: string;
  flow: Flow | null;
}

export interface PublishConfirm {
  kind: "publish";
  skill: { slug: string; name: string };
  versionId: string;
  version: number;
  score: number;
  /** The published version scores higher: publishing this one lowers quality. */
  lowerThan: number | null;
}

/** The listening model couldn't hear or answer a recording; nothing was saved or done. */
export class NotHeardError extends Error {
  constructor(readonly reason: unknown) {
    super("I couldn't make that out. Try again?");
    this.name = "NotHeardError";
  }
}

/**
 * A spoken message. With VOICE_MODE=listen (the default) the listening model
 * hears the recording itself and answers in one call; if it can't, or with
 * VOICE_MODE=transcribe or the offline mock, it's transcribed first.
 */
export async function chatFromVoice(
  client: ModelClient,
  transcriber: Transcriber,
  userId: string,
  input: { audio: File; clock: Clock; actor: Actor; sight?: Sight | null },
): Promise<ChatResult> {
  if (voiceMode() !== "transcribe" && modelProvider() !== "mock") {
    try {
      const audio = Buffer.from(await input.audio.arrayBuffer()).toString("base64");
      return await chat(client, userId, {
        audio,
        clock: input.clock,
        actor: input.actor,
        sight: input.sight,
      });
    } catch (error) {
      if (!(error instanceof NotHeardError)) throw error;
      console.warn(`[persuna] listening failed, transcribing instead: ${String(error.reason)}`);
    }
  }
  const { text } = await transcriber.transcribe(input.audio, input.audio.name);
  if (!text.trim()) throw new Error("I couldn't make that out. Try again?");
  return chat(client, userId, {
    text,
    clock: input.clock,
    actor: input.actor,
    sight: input.sight,
  });
}

/** One message from the user: think, apply the actions, save both sides. */
export async function chat(
  client: ModelClient,
  userId: string,
  input: ({ text: string } | { audio: string }) & {
    clock: Clock;
    actor: Actor;
    /**
     * What's on the user's screen right now, when Persuna may look: the list
     * of it read on their computer (desktop) and/or a screenshot.
     */
    sight?: Sight | null;
    /** A file handed over with the message. Its contents are read for this turn only. */
    file?: PersunaFile | null;
    /** The user pressed "Show me": the reply must show, not just tell. */
    show?: boolean;
  },
): Promise<ChatResult> {
  const spoken = "audio" in input;
  const typed = spoken ? "" : normalizeText(input.text).slice(0, 4000);
  if (!spoken && !typed) throw new Error("Say something first");
  const state = await stateFor(userId, input.clock);
  const history = (await recentMessages(userId, HISTORY_TURNS)).map((m) => ({
    role: m.role,
    content: m.content,
  }));
  const sight = input.sight ?? null;
  // The list of what's on screen is quicker for the model than a picture, and
  // exact about where things are: send the picture only when the list is thin
  // (a photo, a canvas) or the question is about how something looks.
  const picture = Boolean(
    sight?.image &&
    (sight.circled || !sight.scene || sceneIsThin(sight.scene) || (!spoken && wantsPicture(typed))),
  );
  const file = input.file ?? null;
  const message = spoken ? { audio: input.audio } : typed;
  let reply: PersunaReply;
  const turnStarted = performance.now();
  try {
    reply = await persunaTurn(
      client,
      state,
      history,
      message,
      sight && { scene: sight.scene, image: picture ? sight.image : null, circled: sight.circled },
      file,
      input.show ?? false,
    );
    // It needed the picture after all: once more, with it.
    if (sight?.image && !picture && reply.actions.some((a) => a.type === "look_closer")) {
      reply = await persunaTurn(client, state, history, message, sight, file, input.show ?? false);
    }
  } catch (error) {
    if (spoken && !(error instanceof UsageLimitError)) throw new NotHeardError(error);
    throw error;
  }
  // How long the thinking took, so slowness is a number, not a feeling.
  console.info(
    `[persuna] turn ${spoken ? "voice" : "text"} model=${Math.round(performance.now() - turnStarted)}ms sight=${sight ? "yes" : "no"} picture=${picture}`,
  );
  // A recording: the model wrote down what it heard. Nothing heard, nothing done.
  const text = spoken ? normalizeText(reply.heard ?? "").slice(0, 4000) : typed;
  if (!text) throw spoken ? new NotHeardError(null) : new Error("Say something first");

  const profile = await getProfile(userId);
  const owned = await listSkills(userId);
  const focusSkill = owned.find((s) => s.id === profile.focusSkillId) ?? null;
  let memory = [...profile.memory];
  let tone = profile.tone;
  let focus = profile.focus;
  let focusSkillId = profile.focusSkillId;
  let link: ChatResult["link"] = null;
  const extra: string[] = [];
  let task: ChatResult["task"] = null;
  let example: ChatResult["example"] = null;
  let confirm: ChatResult["confirm"] = null;
  let switchTo: ChatResult["switchTo"] = null;
  let asked: string | null = reply.asked ?? null;
  // The skill an action means: the one named, else today's.
  const target = (slug: string | null | undefined) =>
    owned.find((s) => s.slug === slug) ?? owned.find((s) => s.id === focusSkillId) ?? null;
  let reminderSet = false;
  let navigate: string | null = null;
  let watch: ChatResult["watch"] = null;
  let appConfirm: ChatResult["appConfirm"] = null;
  let mcpConfirm: ChatResult["mcpConfirm"] = null;
  let point: ChatResult["point"] = null;
  let clipboard: ChatResult["clipboard"] = null;
  let drawing: ChatResult["drawing"] = null;
  let made: ChatResult["file"] = null;

  for (const action of reply.actions) {
    if (action.type === "remember") {
      if (!memory.some((m) => m.toLowerCase() === action.fact.toLowerCase())) {
        memory = [...memory, action.fact].slice(-MAX_MEMORY);
      }
    } else if (action.type === "note") {
      await db().insert(persunaNotes).values({
        userId,
        title: action.title,
        body: action.body,
        source: "chat",
        skillId: focusSkillId,
      });
      link = { href: "/persuna", label: "Open your notes" };
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
    } else if (action.type === "remind") {
      const dueAt = action.at ? localToUtc(action.at, input.clock.offset) : null;
      await db()
        .insert(persunaReminders)
        .values({ userId, text: action.text, dueAt: dueAt && dueAt > new Date() ? dueAt : null });
      reminderSet ||= Boolean(dueAt);
      link = { href: "/persuna#todos", label: "See your to-dos" };
    } else if (action.type === "create_skill") {
      const created = await createSkill(
        {
          slug: slugify(action.name) || "my-task",
          name: action.name,
          taskDescription: action.task,
          inputType: action.input || "text",
          outputType: action.output || "text",
        },
        userId,
        input.actor,
      );
      owned.push(created);
      focus = created.name;
      focusSkillId = created.id;
      link = { href: `/skills/${created.slug}`, label: `Open ${created.name}` };
    } else if (action.type === "add_example") {
      const skill = target(action.skill);
      if (skill) example = { skill: { slug: skill.slug, name: skill.name } };
      else extra.push("Tell me which task first: say what you're working on, or name a new one.");
    } else if (action.type === "train_skill") {
      const skill = target(action.skill);
      if (!skill) {
        extra.push("Which task should I learn? Tell me what you're working on first.");
      } else if ((await skillStats(skill)).trainPairs === 0) {
        extra.push(`I need at least one example of ${skill.name} first. Say "add an example".`);
      } else {
        const version = await extractVersion(client, skill.slug);
        extra.push(
          `Done: I learned ${version.sheet.rules.length} rules for ${skill.name} (version ${version.version}). Next, say "test yourself" and I'll score my drafts against your examples.`,
        );
        link = { href: `/skills/${skill.slug}/rules`, label: "See the rules" };
      }
    } else if (action.type === "test_skill") {
      const skill = target(action.skill);
      const stats = skill ? await skillStats(skill) : null;
      if (!skill?.currentVersionId) {
        extra.push(
          `I haven't learned any rules for ${skill?.name ?? "that"} yet. Say "train yourself" first.`,
        );
      } else if (!stats?.testPairs) {
        extra.push(
          'Hold back at least one example for testing: add one and tick "use this to test me".',
        );
      } else {
        const run = await runEval(client, skill.currentVersionId);
        const score = run.meanScore === null ? null : Math.round(run.meanScore);
        const advice = coachSkill(await skillStats(skill));
        extra.push(
          score === null
            ? "The test run didn't produce a score. Have a look at it."
            : `I scored ${score} out of 100 against your held-back examples. ${advice.stage === "publish" || advice.stage === "list" ? 'Say "publish it" when you\'re happy.' : advice.message}`,
        );
        link = { href: `/runs/${run.id}`, label: "See the test run" };
      }
    } else if (action.type === "publish_skill") {
      const skill = target(action.skill);
      if (!skill?.currentVersionId) {
        extra.push(`There's nothing to publish for ${skill?.name ?? "that"} yet. Train me first.`);
      } else {
        const version = await getVersion(skill.currentVersionId);
        const score = await latestScore(version.id);
        const published = await publishedScore(skill);
        if (score === null) {
          extra.push(`Test this version first: say "test yourself".`);
        } else if (skill.publishedVersionId === version.id) {
          extra.push(`${skill.name} version ${version.version} is already the published one.`);
        } else {
          confirm = {
            kind: "publish",
            skill: { slug: skill.slug, name: skill.name },
            versionId: version.id,
            version: version.version,
            score: Math.round(score),
            lowerThan: published !== null && score < published ? Math.round(published) : null,
          };
        }
      }
    } else if (action.type === "suggest_switch") {
      const other = owned.find((s) => s.slug === action.skill);
      if (other && other.id !== focusSkillId) {
        switchTo = { slug: other.slug, name: other.name };
        asked = `${SWITCH}${other.slug}`;
      }
    } else if (action.type === "run_task") {
      const named = owned.find((s) => s.slug === action.skill);
      const fallback = owned.find((s) => s.id === focusSkillId);
      const pick = [named, fallback].find((s) => s?.publishedVersionId);
      task = { skill: pick?.slug ?? null };
      if (!owned.some((s) => s.publishedVersionId)) {
        task = null;
        extra.push(
          "You don't have a published skill yet, so I can't do the work for you. Train one and publish it first.",
        );
      }
    } else if (action.type === "coach") {
      const target =
        owned.find((s) => s.slug === action.skill) ??
        owned.find((s) => s.id === focusSkillId) ??
        owned[0];
      if (!target) {
        extra.push("You have no skills yet. Tell me a task you do and I'll help you set one up.");
      } else {
        const advice = coachSkill(await skillStats(target));
        extra.push(advice.message);
        link = { href: advice.href, label: advice.action };
      }
    } else if (action.type === "open_page") {
      const skill = owned.find((s) => s.slug === action.skill);
      navigate =
        action.page === "skill" && skill
          ? `/skills/${skill.slug}`
          : {
              persuna: "/persuna",
              todos: "/persuna#todos",
              skills: "/skills",
              skill: "/skills",
              jobs: "/jobs",
              market: "/market",
              earnings: "/earnings",
              audit: "/audit",
            }[action.page];
    } else if (action.type === "set_tone") {
      tone = applyToneChange(tone, {
        length: action.length ?? undefined,
        formality: action.formality ?? undefined,
        playful: action.playful ?? undefined,
        note: action.note ?? undefined,
      });
    } else if (action.type === "app_task") {
      const done = await doAppTask(client, userId, {
        goal: action.goal,
        now: input.clock.now,
        offset: input.clock.offset,
        name: profile.name,
        actor: input.actor,
      });
      extra.push(`\n\n${done.reply}`);
      appConfirm = done.confirm;
      if (done.needsConnecting) link = { href: "/persuna#apps", label: "Connect your apps" };
    } else if (action.type === "mcp") {
      // Propose only: the call runs when the user approves the card.
      const servers = await listMcpServers(userId).catch(() => []);
      const server = servers.find((s) => s.name === action.server);
      if (server?.tools.some((t) => t.name === action.tool)) {
        mcpConfirm = proposeMcpCall(userId, server, action.tool, action.arguments ?? {});
      }
    } else if (action.type === "point" && sight?.scene) {
      if (action.item) point = spotOf(sight.scene, action.item);
      else if (action.thing && sight.image) {
        // Not in the list: SAM 3.1 finds it in the picture.
        const box = await createLocator()
          ?.locate(sight.image, action.thing)
          .catch(() => null);
        if (box) point = samSpot(box, sight.scene, action.thing);
      }
    } else if (action.type === "clipboard") {
      clipboard = { op: action.op, text: action.text };
    } else if (action.type === "draw") {
      const marks = (action.marks ?? []).flatMap((m, i) => {
        const spot = sight?.scene ? spotOf(sight.scene, m.item) : null;
        return spot ? [{ n: i + 1, note: m.note, spot }] : [];
      });
      if (marks.length || action.flow) {
        drawing = { title: action.title ?? null, marks, flow: action.flow ?? null };
      }
    } else if (action.type === "make_file") {
      made = {
        kind: action.kind,
        title: action.title,
        body: action.body,
        flow: action.flow ?? null,
      };
      // Documents are also kept with their notes, so nothing is lost when the card closes.
      if (action.kind === "document") {
        await db()
          .insert(persunaNotes)
          .values({
            userId,
            title: action.title,
            body: action.body.slice(0, 20_000),
            source: "chat",
            skillId: focusSkillId,
          });
        link = { href: "/persuna", label: "Open your notes" };
      }
    } else if (action.type === "watch_screen") {
      watch = action.on ? "start" : "stop";
    } else if (action.type === "wrap_up") {
      extra.push(`\n\n${await wrapUpText(userId, input.clock)}`);
      await db()
        .update(persunaProfiles)
        .set({ wrapupDay: input.clock.day })
        .where(eq(persunaProfiles.userId, userId));
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
    .update(persunaProfiles)
    .set({ memory, focus, focusSkillId, tone, updatedAt: new Date() })
    .where(eq(persunaProfiles.userId, userId));

  const saved = await db()
    .insert(persunaMessages)
    .values([
      {
        userId,
        role: "user",
        // The file's name only: its contents were for this turn.
        content: file ? `${text}\n\n(${file.name})` : text,
        skillId: focusSkill?.id ?? null,
      },
      {
        userId,
        role: "assistant",
        content: [reply.reply, ...extra].join(" ").replace(/ \n/g, "\n"),
        askedKey: asked,
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
    task,
    reminderSet,
    navigate,
    example,
    confirm,
    switchTo,
    watch,
    appConfirm,
    mcpConfirm,
    point,
    clipboard,
    drawing,
    file: made,
  };
}

/**
 * Turns something the user taught (in chat or by letting Persuna watch) into
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
    action: "persuna.taught",
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
  /** What the user seems to be doing when it isn't today's focus. */
  offFocus: string | null;
  say: string | null;
  step: string | null;
  noteId: string | null;
  message: PersunaMessage | null;
}> {
  const profile = await getProfile(userId);
  const note = input.noteId ? await ownedNote(userId, input.noteId) : null;
  const recentSteps = note ? note.body.split("\n").filter(Boolean) : [];
  const seen = await persunaObserve(client, {
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
        .update(persunaNotes)
        .set({ body: [...recentSteps, step].join("\n") })
        .where(eq(persunaNotes.id, note.id));
    } else {
      const [created] = await db()
        .insert(persunaNotes)
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

  let message: PersunaMessage | null = null;
  if (seen.say) {
    [message] = await db()
      .insert(persunaMessages)
      .values({ userId, role: "assistant", kind: "observation", content: seen.say })
      .returning();
  }
  return { say: seen.say ?? null, step, noteId, message, offFocus: seen.offFocus ?? null };
}

/** Work mode notes collect the steps Persuna learns while you work, one note per day. */
const WORK_NOTE = "Work mode";

/**
 * Work mode: one look at what the user is doing (read on their computer) and
 * whether to step in. Learned steps go into a "Work mode" note, names and
 * figures removed; the screen itself is never stored. What Persuna says is
 * kept in the conversation as an observation.
 */
export async function workLook(
  client: ModelClient,
  userId: string,
  input: {
    clock: Clock;
    scene: Scene;
    image: string | null;
    trail: string[];
    mayInterrupt: boolean;
    pointer?: { x: number; y: number; still: number } | null;
  },
): Promise<{
  mode: "quiet" | "follow" | "guide" | "lead" | "ask" | "explain" | "correct";
  /** How the work compares with their usual way: the colour of the dot. */
  fit: "on_track" | "unsure" | "off" | null;
  message: PersunaMessage | null;
  point: Spot | null;
  offer: string | null;
  noteId: string | null;
  /** The work looks like another of their skills: offer to switch the focus to it. */
  switchTo: { slug: string; name: string } | null;
  /** Enough new steps to teach today's skill: offer to (the user decides). */
  teachOffer: { noteId: string; skill: string; steps: number } | null;
}> {
  const state = await stateFor(userId, input.clock);
  const title = `${WORK_NOTE}: ${input.clock.day}`;
  const note = await db().query.persunaNotes.findFirst({
    where: and(eq(persunaNotes.userId, userId), eq(persunaNotes.title, title)),
  });
  const recentSteps = note ? note.body.split("\n").filter(Boolean) : [];
  const seen = await persunaWorkLook(client, {
    state,
    scene: input.scene,
    image: input.scene && !sceneIsThin(input.scene) ? null : input.image,
    trail: input.trail,
    recentSteps,
    mayInterrupt: input.mayInterrupt,
    pointer: input.pointer ?? null,
  });

  let noteId = note?.id ?? null;
  const step = seen.step ? redact(seen.step) : null;
  let steps = recentSteps.length;
  if (step && !recentSteps.includes(step)) {
    steps += 1;
    if (note) {
      await db()
        .update(persunaNotes)
        .set({ body: [...recentSteps, step].join("\n") })
        .where(eq(persunaNotes.id, note.id));
    } else {
      const profile = await getProfile(userId);
      const [created] = await db()
        .insert(persunaNotes)
        .values({ userId, title, body: step, source: "screen", skillId: profile.focusSkillId })
        .returning();
      noteId = created.id;
    }
  }

  let message: PersunaMessage | null = null;
  if (seen.say && seen.mode !== "quiet" && seen.mode !== "follow") {
    [message] = await db()
      .insert(persunaMessages)
      .values({ userId, role: "assistant", kind: "observation", content: seen.say })
      .returning();
  }
  const focusSlug = state.focusSkill?.slug ?? null;
  const other =
    seen.skill && seen.skill !== focusSlug ? state.skills.find((s) => s.slug === seen.skill) : null;
  // Every few new steps, offer to teach them to today's skill.
  const teachOffer =
    noteId && state.focusSkill && step && steps > 0 && steps % TEACH_EVERY_STEPS === 0
      ? { noteId, skill: state.focusSkill.name, steps }
      : null;
  return {
    mode: seen.mode,
    fit: seen.fit ?? null,
    message,
    point: seen.point ? spotOf(input.scene, seen.point) : null,
    offer: seen.offer ?? null,
    noteId,
    switchTo: other ? { slug: other.slug, name: other.name } : null,
    teachOffer,
  };
}

/** Work mode offers to teach what it learned to today's skill after this many new steps. */
const TEACH_EVERY_STEPS = 5;

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
    throw new Error("Tell your Persuna which skill you're working on first (\"I'm working on…\").");
  }
  const skill = await db().query.skills.findFirst({
    where: and(eq(skills.id, skillId), eq(skills.ownerId, userId)),
  });
  if (!skill) throw new NotFoundError("That skill isn't yours");
  const body = note.source === "screen" ? `Steps seen on screen:\n${note.body}` : note.body;
  return teach(client, skill, body, actor);
}

async function ownedNote(userId: string, noteId: string): Promise<PersunaNote> {
  const note = await db().query.persunaNotes.findFirst({
    where: and(eq(persunaNotes.id, noteId), eq(persunaNotes.userId, userId)),
  });
  if (!note) throw new NotFoundError("No such note");
  return note;
}

export async function listNotes(userId: string) {
  return db()
    .select({ note: persunaNotes, skillName: skills.name, skillSlug: skills.slug })
    .from(persunaNotes)
    .leftJoin(skills, eq(persunaNotes.skillId, skills.id))
    .where(eq(persunaNotes.userId, userId))
    .orderBy(desc(persunaNotes.createdAt));
}

export async function deleteNote(userId: string, noteId: string) {
  await db()
    .delete(persunaNotes)
    .where(and(eq(persunaNotes.id, noteId), eq(persunaNotes.userId, userId)));
}

export async function addNote(userId: string, input: { title: string; body: string }) {
  const profile = await getProfile(userId);
  await db().insert(persunaNotes).values({
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
    .update(persunaProfiles)
    .set({
      ...(input.name !== undefined && { name: input.name }),
      ...(input.avatar !== undefined && { avatar: input.avatar }),
      ...(input.focus !== undefined && {
        focus: input.focus,
        ...(input.focus === null && { focusSkillId: null }),
      }),
      updatedAt: new Date(),
    })
    .where(eq(persunaProfiles.userId, userId));
}

export async function forgetFact(userId: string, index: number) {
  const profile = await getProfile(userId);
  await db()
    .update(persunaProfiles)
    .set({ memory: profile.memory.filter((_, i) => i !== index), updatedAt: new Date() })
    .where(eq(persunaProfiles.userId, userId));
}

export async function clearConversation(userId: string) {
  await db().delete(persunaMessages).where(eq(persunaMessages.userId, userId));
}

/* ---------- First meeting ---------- */

export type FirstTask =
  | { kind: "existing"; slug: string }
  | { kind: "sample" }
  | { kind: "new"; name: string; description: string }
  /** Several at once (setup's list): new ones are created, the first becomes the focus. */
  | { kind: "many"; skills: { name: string; description?: string }[] }
  | { kind: "skip" };

/**
 * The first-meeting setup: a name, an avatar, and the first task to learn,
 * which becomes today's focus. Returns where to go next.
 */
export async function completeSetup(
  userId: string,
  input: { name: string; avatar: string; task: FirstTask; actor: Actor },
): Promise<{ href: string | null; message: PersunaMessage }> {
  await getProfile(userId);
  let skill: { id: string; slug: string; name: string } | null = null;
  let manyNames: string[] = [];
  if (input.task.kind === "existing") {
    const slug = input.task.slug;
    skill = (await listSkills(userId)).find((s) => s.slug === slug) ?? null;
    if (!skill) throw new NotFoundError("That skill isn't yours");
  } else if (input.task.kind === "sample") {
    skill = await createSampleSkill(userId, input.actor);
  } else if (input.task.kind === "many") {
    const existing = await listSkills(userId);
    const taken = new Set(existing.map((s) => s.slug));
    const created: { id: string; slug: string; name: string }[] = [];
    for (const want of input.task.skills.slice(0, MAX_FIRST_SKILLS)) {
      const name = want.name.trim();
      const already = existing.find((s) => s.name.toLowerCase() === name.toLowerCase());
      if (already) {
        created.push(already);
        continue;
      }
      const slug = freeSlug(slugify(name), taken);
      taken.add(slug);
      created.push(
        await createSkill(
          {
            slug,
            name,
            taskDescription: want.description?.trim() || describeSkill(name),
            inputType: "text",
            outputType: "text",
          },
          userId,
          input.actor,
        ),
      );
    }
    skill = created[0] ?? null;
    manyNames = created.map((s) => s.name);
  } else if (input.task.kind === "new") {
    const name = input.task.name.trim();
    skill = await createSkill(
      {
        slug: slugify(name) || "my-task",
        name,
        taskDescription: input.task.description.trim(),
        inputType: "text",
        outputType: "text",
      },
      userId,
      input.actor,
    );
  }
  await db()
    .update(persunaProfiles)
    .set({
      name: input.name,
      avatar: input.avatar,
      setupDone: true,
      ...(skill && { focus: skill.name, focusSkillId: skill.id }),
      updatedAt: new Date(),
    })
    .where(eq(persunaProfiles.userId, userId));
  await ensureHandle(userId);

  const content =
    manyNames.length > 1
      ? `Nice to meet you. I'm ${input.name}. I'll learn ${manyNames.length} skills with you: ${manyNames.join(", ")}. We'll start with ${skill!.name}. Say "teach me", or turn on Work mode and I'll learn while you work.`
      : skill
        ? `Nice to meet you. I'm ${input.name}. First up: ${skill.name}. Say "teach me" and I'll ask how you do it, one question at a time. You can also add before-and-after examples on the skill's page.`
        : `Nice to meet you. I'm ${input.name}. Tell me what you're working on whenever you're ready.`;
  const [message] = await db()
    .insert(persunaMessages)
    .values({ userId, role: "assistant", content, skillId: skill?.id ?? null })
    .returning();
  return { href: skill ? `/skills/${skill.slug}` : null, message };
}

/** Gives the persuna a public address the first time it needs one. */
export async function ensureHandle(userId: string): Promise<string> {
  const profile = await getProfile(userId);
  if (profile.handle) return profile.handle;
  const base = slugify(profile.name).slice(0, 30) || "persuna";
  for (let i = 0; i < 20; i++) {
    const handle = `${base}-${Math.random().toString(36).slice(2, 7)}`;
    const [row] = await db()
      .update(persunaProfiles)
      .set({ handle })
      .where(and(eq(persunaProfiles.userId, userId), isNull(persunaProfiles.handle)))
      .returning()
      .catch(() => []);
    if (row) return handle;
    const again = await getProfile(userId);
    if (again.handle) return again.handle;
  }
  throw new Error("Couldn't create a public address for your Persuna");
}

/* ---------- Doing work from the chat ---------- */

export async function publishedSkills(userId: string) {
  return (await listSkills(userId))
    .filter((s) => s.publishedVersionId)
    .map((s) => ({ slug: s.slug, name: s.name }));
}

/**
 * Runs a published skill on the user's input as an owner job. The input and
 * draft live in `jobs` (purged after retention); the chat only records that a
 * task ran and points at the job.
 */
export async function runTask(
  client: ModelClient,
  user: { id: string; name: string },
  input: { slug: string; text: string },
) {
  const skill = (await listSkills(user.id)).find((s) => s.slug === input.slug);
  if (!skill) throw new NotFoundError("That skill isn't yours");
  if (!skill.publishedVersionId) throw new Error(`Publish ${skill.name} before I can use it`);
  const job = await createJob(client, {
    skillId: skill.id,
    origin: "owner",
    requesterName: user.name,
    requesterUserId: user.id,
    input: input.text,
  });
  const saved = await db()
    .insert(persunaMessages)
    .values([
      {
        userId: user.id,
        role: "user",
        kind: "task",
        content: `Sent ${skill.name} something to do.`,
        skillId: skill.id,
      },
      {
        userId: user.id,
        role: "assistant",
        kind: "job",
        content:
          job.status === "approved"
            ? `Done with ${skill.name}. Your trust level let me approve it; it's below if you want to check.`
            : `Here's the ${skill.name} draft. Approve it, edit it, or send it back.`,
        skillId: skill.id,
        jobId: job.id,
      },
    ])
    .returning();
  saved.sort((a, b) => (a.role === b.role ? 0 : a.role === "user" ? -1 : 1));
  return { messages: saved, job: chatJob(job, skill.name) };
}

function chatJob(job: Awaited<ReturnType<typeof getJob>>, skillName: string) {
  return {
    id: job.id,
    skillName,
    status: job.status,
    draft: job.finalOutput ?? job.draft,
    flags: job.flags.map((f) => f.message),
  };
}
export type ChatJob = ReturnType<typeof chatJob>;

export async function jobForChat(userId: string, jobId: string): Promise<ChatJob> {
  const job = await getJob(jobId);
  const skill = await db().query.skills.findFirst({
    where: and(eq(skills.id, job.skillId), eq(skills.ownerId, userId)),
  });
  if (!skill || job.origin !== "owner") throw new NotFoundError("No such job");
  return chatJob(job, skill.name);
}

export async function reviewFromChat(
  userId: string,
  jobId: string,
  decision: "approve" | "reject",
  finalOutput?: string,
) {
  await jobForChat(userId, jobId);
  await reviewJob(jobId, decision, finalOutput);
  return jobForChat(userId, jobId);
}

/* ---------- To-dos and reminders ---------- */

export async function openReminders(userId: string) {
  return db()
    .select()
    .from(persunaReminders)
    .where(and(eq(persunaReminders.userId, userId), isNull(persunaReminders.doneAt)))
    .orderBy(asc(persunaReminders.dueAt), asc(persunaReminders.createdAt));
}

export async function listReminders(userId: string) {
  const open = await openReminders(userId);
  const done = await db()
    .select()
    .from(persunaReminders)
    .where(and(eq(persunaReminders.userId, userId), isNotNull(persunaReminders.doneAt)))
    .orderBy(desc(persunaReminders.doneAt))
    .limit(10);
  return { open, done };
}

/** Reminders that are due and not yet shown. Marks them shown, so each fires once. */
export async function takeDueReminders(userId: string, now = new Date()) {
  return db()
    .update(persunaReminders)
    .set({ notifiedAt: now })
    .where(
      and(
        eq(persunaReminders.userId, userId),
        isNull(persunaReminders.doneAt),
        isNull(persunaReminders.notifiedAt),
        lte(persunaReminders.dueAt, now),
      ),
    )
    .returning();
}

export async function setReminderDone(userId: string, id: string, done: boolean) {
  await db()
    .update(persunaReminders)
    .set({ doneAt: done ? new Date() : null })
    .where(and(eq(persunaReminders.id, id), eq(persunaReminders.userId, userId)));
}

export async function deleteReminder(userId: string, id: string) {
  await db()
    .delete(persunaReminders)
    .where(and(eq(persunaReminders.id, id), eq(persunaReminders.userId, userId)));
}

export async function addTodo(userId: string, text: string) {
  await db().insert(persunaReminders).values({ userId, text });
}

/** A reminder with a time, from the companion's fast path (no model call). */
export async function addReminder(userId: string, input: { text: string; due: Date | null }) {
  await db().insert(persunaReminders).values({ userId, text: input.text, dueAt: input.due });
}

/* ---------- Coaching ---------- */

export async function skillStats(skill: {
  id: string;
  slug: string;
  name: string;
  interview: InterviewAnswers | null;
  currentVersionId: string | null;
  publishedVersionId: string | null;
}): Promise<SkillStats> {
  const pairs = await splitPairs(skill.id);
  const score = skill.publishedVersionId
    ? await publishedScore(skill)
    : skill.currentVersionId
      ? await latestScore(skill.currentVersionId)
      : null;
  const listing = await db().query.listings.findFirst({ where: eq(listings.skillId, skill.id) });
  return {
    name: skill.name,
    slug: skill.slug,
    answered: INTERVIEW_QUESTIONS.filter((q) => skill.interview?.[q.key]?.trim()).length,
    totalQuestions: INTERVIEW_QUESTIONS.length,
    trainPairs: pairs.train.length,
    testPairs: pairs.test.length,
    hasRules: Boolean(skill.currentVersionId),
    published: Boolean(skill.publishedVersionId),
    score,
    minScore: env().LISTING_MIN_SCORE,
    listed: Boolean(listing?.active),
  };
}

export async function coachingForAll(userId: string) {
  const owned = await listSkills(userId);
  return Promise.all(owned.map(async (s) => coachSkill(await skillStats(s))));
}

/* ---------- End of day ---------- */

async function wrapUpText(userId: string, clock: Clock): Promise<string> {
  const now = new Date();
  const since = startOfLocalDay(now, clock.offset);
  const profile = await getProfile(userId);
  const [messages, notes, todaysJobs, done, open] = await Promise.all([
    db()
      .select({ id: persunaMessages.id })
      .from(persunaMessages)
      .where(
        and(
          eq(persunaMessages.userId, userId),
          eq(persunaMessages.role, "user"),
          gte(persunaMessages.createdAt, since),
        ),
      ),
    db()
      .select({ title: persunaNotes.title })
      .from(persunaNotes)
      .where(and(eq(persunaNotes.userId, userId), gte(persunaNotes.createdAt, since))),
    db()
      .select({ status: jobs.status, skill: skills.name })
      .from(jobs)
      .innerJoin(skills, eq(jobs.skillId, skills.id))
      .where(
        and(eq(jobs.requesterUserId, userId), eq(jobs.origin, "owner"), gte(jobs.createdAt, since)),
      ),
    db()
      .select({ text: persunaReminders.text })
      .from(persunaReminders)
      .where(and(eq(persunaReminders.userId, userId), gte(persunaReminders.doneAt, since))),
    openReminders(userId),
  ]);
  return buildWrapUp({
    name: profile.name,
    focus: profile.focus,
    messages: messages.length,
    notes: notes.map((n) => n.title),
    jobs: todaysJobs,
    done: done.map((d) => d.text),
    open: open.map((o) => ({
      text: o.text,
      due: o.dueAt ? dueLabel(utcToLocal(o.dueAt, clock.offset), clock.day) : null,
    })),
  });
}

/** "16:00" today, "2026-10-28 09:00" on another day. */
function dueLabel(local: string, today: string) {
  return local.startsWith(today) ? local.slice(11) : local.replace("T", " ");
}

/* ---------- Public profile ---------- */

/**
 * What anyone can see about a persuna: its name and avatar, the owner's first
 * name, listed skills with scores and trust, how many people rent it, and
 * renters' ratings. Never the owner's memory, notes or chats.
 */
export async function publicProfile(handle: string) {
  const profile = await db().query.persunaProfiles.findFirst({
    where: eq(persunaProfiles.handle, handle),
  });
  if (!profile) throw new NotFoundError("No such persuna");
  const owner = await db().query.authUsers.findFirst({
    where: eq(schema.authUsers.id, profile.userId),
  });
  const live = await db()
    .select({ skill: skills, listing: listings })
    .from(listings)
    .innerJoin(skills, eq(listings.skillId, skills.id))
    .where(
      and(
        eq(skills.ownerId, profile.userId),
        eq(listings.active, true),
        eq(listings.visibility, "public"),
      ),
    );
  // Company know-how never appears on a public profile.
  const listed = withoutConfidential(
    live,
    (l) => l.skill.id,
    await confidentialSkills(live.map((l) => l.skill.id)),
  );
  const skillIds = listed.map((l) => l.skill.id);
  const since = new Date(Date.now() - 30 * 86_400_000);
  const renterJobs = skillIds.length
    ? await db()
        .select({
          skillId: jobs.skillId,
          renter: jobs.requesterUserId,
          renterName: jobs.requesterName,
          status: jobs.status,
          rating: jobs.rating,
          comment: jobs.ratingComment,
          createdAt: jobs.createdAt,
        })
        .from(jobs)
        .where(and(inArray(jobs.skillId, skillIds), eq(jobs.origin, "renter")))
        .orderBy(desc(jobs.createdAt))
    : [];
  const renterKey = (j: (typeof renterJobs)[number]) => j.renter ?? j.renterName;
  const activeRenters = new Set(renterJobs.filter((j) => j.createdAt >= since).map(renterKey)).size;
  const rated = renterJobs.filter((j) => j.rating !== null);
  const skillName = new Map(listed.map((l) => [l.skill.id, l.listing.title]));

  return {
    name: profile.name,
    avatar: profile.avatar,
    ownerFirstName: owner?.name.split(/\s+/)[0] || "Its owner",
    activeRenters,
    jobsDone: renterJobs.filter((j) => j.status === "approved").length,
    averageRating: rated.length
      ? Math.round((rated.reduce((n, j) => n + j.rating!, 0) / rated.length) * 10) / 10
      : null,
    skills: await Promise.all(
      listed.map(async ({ skill, listing }) => ({
        listingId: listing.id,
        title: listing.title,
        description: listing.description,
        priceCents: listing.priceCents,
        turnaroundHours: listing.turnaroundHours,
        trustLevel: skill.trustLevel,
        score: await publishedScore(skill),
        renters: new Set(
          renterJobs.filter((j) => j.skillId === skill.id && j.createdAt >= since).map(renterKey),
        ).size,
      })),
    ),
    reviews: rated.slice(0, 12).map((j) => ({
      rating: j.rating!,
      comment: j.comment,
      skill: skillName.get(j.skillId) ?? "",
      date: j.createdAt,
      renter: j.renterName.split(/\s+/)[0],
    })),
  };
}

/** The persuna behind each skill owner, for marketplace cards. */
export async function persunasByOwner(ownerIds: string[]) {
  if (!ownerIds.length)
    return new Map<string, { name: string; avatar: string; handle: string | null }>();
  const rows = await db()
    .select()
    .from(persunaProfiles)
    .where(inArray(persunaProfiles.userId, ownerIds));
  return new Map(rows.map((r) => [r.userId, { name: r.name, avatar: r.avatar, handle: r.handle }]));
}

/* ---------- Getting to know you (Persuna Desktop's first run) ---------- */

/**
 * The four "get to know you" answers: what they do, what they're on and what
 * takes their time go into memory (in their words); what they're on becomes
 * today's focus if there isn't one; how they want to be spoken to sets the tone.
 */
export async function saveIntro(userId: string, answers: IntroAnswers) {
  const profile = await getProfile(userId);
  let memory = [...profile.memory];
  for (const fact of introFacts(answers)) {
    if (!memory.some((m) => m.toLowerCase() === fact.toLowerCase())) memory.push(fact);
  }
  memory = memory.slice(-MAX_MEMORY);
  const change = answers.style ? toneFromMessage(answers.style) : null;
  const current = answers.current?.replace(/\s+/g, " ").trim().slice(0, 200);
  await db()
    .update(persunaProfiles)
    .set({
      memory,
      ...(change && { tone: applyToneChange(profile.tone, change) }),
      ...(current && !profile.focus && { focus: current }),
      updatedAt: new Date(),
    })
    .where(eq(persunaProfiles.userId, userId));
  return { remembered: memory.length - profile.memory.length };
}

/* ---------- Tone ---------- */

export async function setTone(userId: string, tone: Tone) {
  await getProfile(userId);
  await db()
    .update(persunaProfiles)
    .set({ tone, updatedAt: new Date() })
    .where(eq(persunaProfiles.userId, userId));
}

/** What the user chose, and what Persuna is going by (choices plus what it noticed). */
export async function toneSummary(userId: string) {
  const profile = await getProfile(userId);
  const effective = await toneFor(userId, profile.tone);
  return { explicit: profile.tone, instruction: toneInstruction(effective) };
}

/** How the voice should sound for this user right now. */
export async function speakingStyle(userId: string): Promise<string> {
  const profile = await getProfile(userId);
  return voiceStyle(await toneFor(userId, profile.tone));
}

/* ---------- Speaking up: notices and reminders ---------- */

export const MAX_NOTICE_KEYS = 300;

/**
 * Called every half minute by the companion: reminders that came due, plus
 * anything worth saying unprompted (work waiting, scores moving, new
 * orders, the job on screen). Each notice is said once; it's also kept in
 * the conversation.
 */
export async function pulse(userId: string, input: { clock: Clock; path: string }) {
  const reminders = await takeDueReminders(userId);
  const profile = await getProfile(userId);
  const owned = await listSkills(userId);
  const ids = owned.map((s) => s.id);
  const name = new Map(owned.map((s) => [s.id, s]));
  const now = new Date();

  const [waiting, runs, orders] = ids.length
    ? await Promise.all([
        db()
          .select({
            id: jobs.id,
            skillId: jobs.skillId,
            createdAt: jobs.createdAt,
            flags: jobs.flags,
            origin: jobs.origin,
          })
          .from(jobs)
          .where(and(inArray(jobs.skillId, ids), eq(jobs.status, "review"))),
        db()
          .select({
            id: schema.evalRuns.id,
            skillId: schema.skillVersions.skillId,
            score: schema.evalRuns.meanScore,
          })
          .from(schema.evalRuns)
          .innerJoin(
            schema.skillVersions,
            eq(schema.evalRuns.skillVersionId, schema.skillVersions.id),
          )
          .where(
            and(
              inArray(schema.skillVersions.skillId, ids),
              eq(schema.evalRuns.status, "complete"),
              isNotNull(schema.evalRuns.meanScore),
            ),
          )
          .orderBy(desc(schema.evalRuns.createdAt)),
        db()
          .select({
            id: jobs.id,
            skillId: jobs.skillId,
            renter: jobs.requesterName,
            createdAt: jobs.createdAt,
          })
          .from(jobs)
          .where(
            and(
              inArray(jobs.skillId, ids),
              eq(jobs.origin, "renter"),
              ne(jobs.status, "awaiting_payment"),
              gte(jobs.createdAt, new Date(now.getTime() - 7 * 86_400_000)),
            ),
          ),
      ])
    : [[], [], []];

  const scores = ids.flatMap((id) => {
    const [latest, previous] = runs.filter((r) => r.skillId === id);
    return latest && previous
      ? [
          {
            slug: name.get(id)!.slug,
            skill: name.get(id)!.name,
            runId: latest.id,
            latest: latest.score!,
            previous: previous.score!,
          },
        ]
      : [];
  });
  const viewing = /^\/jobs\/([0-9a-f-]{36})/.exec(input.path)?.[1] ?? null;
  const fresh = unseen(
    notices({
      now,
      day: input.clock.day,
      waiting: waiting.map((j) => ({
        id: j.id,
        skill: name.get(j.skillId)!.name,
        createdAt: j.createdAt,
        flags: j.flags.length,
        origin: j.origin,
      })),
      scores,
      orders: orders.map((o) => ({
        id: o.id,
        skill: name.get(o.skillId)!.name,
        renter: o.renter,
        createdAt: o.createdAt,
      })),
      viewingJobId: viewing,
    }),
    profile.noticeKeys,
  );

  let said: PersunaMessage[] = [];
  if (fresh.length) {
    await db()
      .update(persunaProfiles)
      .set({
        noticeKeys: [...profile.noticeKeys, ...fresh.map((n) => n.key)].slice(-MAX_NOTICE_KEYS),
      })
      .where(eq(persunaProfiles.userId, userId));
    said = await db()
      .insert(persunaMessages)
      .values(
        fresh.map((n) => ({ userId, role: "assistant" as const, kind: "notice", content: n.text })),
      )
      .returning();
  }
  return {
    reminders: reminders.map((r) => ({ id: r.id, text: r.text })),
    notices: said.map((m, i) => ({ message: m, href: fresh[i].href })),
  };
}

/* ---------- Building a skill by conversation ---------- */

/**
 * An example given to Persuna (what the user started with, and their finished
 * version). Names and identifiers are replaced with placeholders before it's
 * kept, since skills hold method, never material.
 */
export async function addExampleFromChat(
  client: ModelClient,
  userId: string,
  input: { slug: string; before: string; after: string; test: boolean | null; actor: Actor },
) {
  const skill = (await listSkills(userId)).find((s) => s.slug === input.slug);
  if (!skill) throw new NotFoundError("That skill isn't yours");
  const before = normalizeText(input.before);
  const after = normalizeText(input.after);
  if (!before || !after)
    throw new Error("Add both what you started with and your finished version.");
  const scan = await scanPair(client, before, after);
  const replaced = scan.inputFindings.length + scan.outputFindings.length;
  const stats = await skillStats(skill);
  const test = input.test ?? suggestTestSplit(stats.trainPairs, stats.testPairs);
  const base = slugify(scan.redactedInput.split("\n")[0] ?? "") || "example";
  let saved = false;
  for (let n = 1; !saved && n <= 20; n++) {
    try {
      await addPair(skill.id, {
        slug: n === 1 ? base : `${base}-${n}`,
        split: test ? "test" : "train",
        input: scan.redactedInput,
        output: scan.redactedOutput,
        redacted: replaced > 0,
      });
      saved = true;
    } catch (error) {
      if (!/already exists/.test((error as Error).message)) throw error;
    }
  }
  const now = await skillStats(skill);
  const next = !now.trainPairs
    ? "Add one more to learn from."
    : !now.hasRules
      ? 'Say "train yourself" when you\'re ready, or add more.'
      : 'Say "train yourself" to learn from it, then "test yourself".';
  const content = `Saved that ${test ? "for testing me" : "to learn from"}${
    replaced
      ? `, with ${replaced} name${replaced === 1 ? "" : "s"} and details replaced by placeholders`
      : ""
  }. ${skill.name} now has ${now.trainPairs} to learn from and ${now.testPairs} to test me. ${next}`;
  const [message] = await db()
    .insert(persunaMessages)
    .values({ userId, role: "assistant", content, skillId: skill.id })
    .returning();
  return { message, link: { href: `/skills/${skill.slug}/examples`, label: "See the examples" } };
}

/** Publishes after the user confirmed in the chat. */
/** The user OK'd a send or create in their apps: do it, and say so in the conversation. */
export async function confirmAppFromChat(userId: string, token: string, actor: Actor) {
  const done = await confirmAppAction(userId, token, actor);
  const [message] = await db()
    .insert(persunaMessages)
    .values({ userId, role: "assistant", content: done.message })
    .returning();
  return { message, link: done.href ? { href: done.href, label: "Open it" } : null };
}

/** The user OK'd a tool call on one of their MCP servers: run it, and say so in the conversation. */
export async function confirmMcpFromChat(userId: string, token: string, actor: Actor) {
  const done = await confirmMcpCall(userId, token, actor);
  const output = done.output.length > 2000 ? `${done.output.slice(0, 2000)}…` : done.output;
  const [message] = await db()
    .insert(persunaMessages)
    .values({ userId, role: "assistant", content: `${done.message}\n\n${output}` })
    .returning();
  return { message, link: null };
}

export async function publishFromChat(
  userId: string,
  input: { slug: string; versionId: string; confirmLower: boolean },
) {
  const skill = (await listSkills(userId)).find((s) => s.slug === input.slug);
  if (!skill) throw new NotFoundError("That skill isn't yours");
  const version = await getVersion(input.versionId);
  if (version.skillId !== skill.id) throw new NotFoundError("No such version");
  await publishVersion(skill.id, version.id, input.confirmLower);
  const content =
    `Published ${skill.name} version ${version.version}. Real jobs now use it, starting at trust level 0 (I'll send you everything to approve). ${
      skill.trustLevel > 0 ? "Its trust level went back to 0 for the new version." : ""
    }`.trim();
  const [message] = await db()
    .insert(persunaMessages)
    .values({ userId, role: "assistant", content, skillId: skill.id })
    .returning();
  return {
    message,
    link: { href: `/skills/${skill.slug}/listing`, label: "List it in the marketplace" },
  };
}

/**
 * Persuna tells the user something on its own initiative (an agent's skill
 * finished training, a project needs them). It appears in their conversation
 * like any other reply. Ids, names and scores only: never job or project text.
 */
export async function sayToUser(userId: string, content: string, skillId?: string | null) {
  const [message] = await db()
    .insert(persunaMessages)
    .values({ userId, role: "assistant", kind: "notice", content, skillId: skillId ?? null })
    .returning();
  return message;
}
