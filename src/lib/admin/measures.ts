/**
 * The plan's measures (§9), read off tables the app already keeps: voice
 * timing per week, episodes per active user, proposals accepted versus
 * rejected, six-layer coverage, jobs delivered without correction by trust
 * level, calls per active user against the daily allowance, and screen reads
 * outside Work or Look (which must be zero).
 */
import { and, count, desc, eq, gte, isNotNull, ne, sql } from "drizzle-orm";
import { db, schema } from "@/db/client";
import { answeredLayers } from "@/lib/skill/interview";

const { auditEvents, corrections, episodes, jobs, modelUsage, skills, voiceTurns } = schema;

/** Nearest-rank percentile of ascending samples, or null without any. */
export function percentile(samples: number[], p: number): number | null {
  if (samples.length === 0) return null;
  const sorted = [...samples].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1)] ?? null;
}

export interface LatencySummary {
  p50: number | null;
  p95: number | null;
  n: number;
}

/** p50/p95 over the turns that marked a stage; unmarked turns don't count. */
export function latencySummary(values: (number | null)[]): LatencySummary {
  const marked = values.filter((value): value is number => value !== null);
  return { p50: percentile(marked, 50), p95: percentile(marked, 95), n: marked.length };
}

/** The Monday (UTC, YYYY-MM-DD) of the week a date falls in. */
export function weekOf(at: Date): string {
  const monday = new Date(Date.UTC(at.getUTCFullYear(), at.getUTCMonth(), at.getUTCDate()));
  monday.setUTCDate(monday.getUTCDate() - ((monday.getUTCDay() + 6) % 7));
  return monday.toISOString().slice(0, 10);
}

/** Usage roles fall into model, voice or transcription spend. */
export function categoryOf(role: string): "model" | "voice" | "transcription" {
  if (role === "speech") return "voice";
  if (role === "transcribe") return "transcription";
  return "model";
}

export interface WeeklyLatency {
  week: string;
  firstToken: LatencySummary;
  firstSentence: LatencySummary;
  firstAudio: LatencySummary;
  turns: number;
}

/** Voice timing per week: first token, first sentence, first sound. */
export async function weeklyVoiceLatency(weeks = 8): Promise<WeeklyLatency[]> {
  const since = new Date(Date.now() - weeks * 7 * 86_400_000);
  const rows = await db()
    .select({
      at: voiceTurns.createdAt,
      firstTokenMs: voiceTurns.firstTokenMs,
      firstSentenceMs: voiceTurns.firstSentenceMs,
      firstAudioMs: voiceTurns.firstAudioMs,
    })
    .from(voiceTurns)
    .where(gte(voiceTurns.createdAt, since))
    .orderBy(desc(voiceTurns.createdAt))
    .limit(5000);
  const byWeek = new Map<string, typeof rows>();
  for (const row of rows) {
    const week = weekOf(row.at);
    byWeek.set(week, [...(byWeek.get(week) ?? []), row]);
  }
  return [...byWeek.entries()]
    .sort(([a], [b]) => (a < b ? 1 : -1))
    .map(([week, weekRows]) => ({
      week,
      firstToken: latencySummary(weekRows.map((row) => row.firstTokenMs)),
      firstSentence: latencySummary(weekRows.map((row) => row.firstSentenceMs)),
      firstAudio: latencySummary(weekRows.map((row) => row.firstAudioMs)),
      turns: weekRows.length,
    }));
}

export interface WeeklyEpisodes {
  week: string;
  episodes: number;
  users: number;
  perUser: number | null;
}

/** Episodes recorded per active user per week (active: recorded one). */
export async function weeklyEpisodes(weeks = 8): Promise<WeeklyEpisodes[]> {
  const since = new Date(Date.now() - weeks * 7 * 86_400_000);
  const rows = await db()
    .select({ at: episodes.startedAt, userId: episodes.userId })
    .from(episodes)
    .where(gte(episodes.startedAt, since));
  const byWeek = new Map<string, { episodes: number; users: Set<string> }>();
  for (const row of rows) {
    const entry = byWeek.get(weekOf(row.at)) ?? { episodes: 0, users: new Set<string>() };
    entry.episodes += 1;
    entry.users.add(row.userId);
    byWeek.set(weekOf(row.at), entry);
  }
  return [...byWeek.entries()]
    .sort(([a], [b]) => (a < b ? 1 : -1))
    .map(([week, entry]) => ({
      week,
      episodes: entry.episodes,
      users: entry.users.size,
      perUser: Math.round((entry.episodes / entry.users.size) * 10) / 10,
    }));
}

/** Learning proposals accepted versus rejected (pending excluded). */
export async function proposalOutcomes(): Promise<{ accepted: number; rejected: number }> {
  const rows = await db()
    .select({ status: corrections.status, n: count() })
    .from(corrections)
    .where(ne(corrections.status, "pending"))
    .groupBy(corrections.status);
  return {
    accepted: rows.find((row) => row.status === "accepted")?.n ?? 0,
    rejected: rows.find((row) => row.status === "rejected")?.n ?? 0,
  };
}

/** Published skills whose interview answers cover all six layers. */
export async function sixLayerShare(): Promise<{ full: number; published: number }> {
  const rows = await db()
    .select({ interview: skills.interview })
    .from(skills)
    .where(isNotNull(skills.publishedVersionId));
  return {
    full: rows.filter((row) => answeredLayers(row.interview).length === 6).length,
    published: rows.length,
  };
}

export interface TrustClean {
  trustLevel: number;
  delivered: number;
  withoutCorrection: number;
}

/** Jobs delivered without correction, by the skill's trust level. */
export async function jobsWithoutCorrectionByTrust(): Promise<TrustClean[]> {
  const rows = await db()
    .select({
      id: jobs.id,
      trustLevel: skills.trustLevel,
      correctionId: corrections.id,
    })
    .from(jobs)
    .innerJoin(skills, eq(jobs.skillId, skills.id))
    .leftJoin(corrections, and(eq(corrections.jobId, jobs.id), eq(corrections.source, "job")))
    .where(eq(jobs.status, "approved"));
  const byTrust = new Map<number, TrustClean>();
  for (const row of rows) {
    const entry = byTrust.get(row.trustLevel) ?? {
      trustLevel: row.trustLevel,
      delivered: 0,
      withoutCorrection: 0,
    };
    entry.delivered += 1;
    if (!row.correctionId) entry.withoutCorrection += 1;
    byTrust.set(row.trustLevel, entry);
  }
  return [...byTrust.values()].sort((a, b) => a.trustLevel - b.trustLevel);
}

export interface DayCalls {
  day: string;
  model: number;
  voice: number;
  transcription: number;
  users: number;
}

/** Calls per active user per day, split into model, voice and transcription. */
export async function dailyCallsPerUser(days = 14): Promise<DayCalls[]> {
  const since = new Date(Date.now() - days * 86_400_000);
  const rows = await db()
    .select({ at: modelUsage.at, role: modelUsage.role, userId: modelUsage.userId })
    .from(modelUsage)
    .where(gte(modelUsage.at, since));
  const byDay = new Map<string, DayCalls & { userIds: Set<string> }>();
  for (const row of rows) {
    const day = row.at.toISOString().slice(0, 10);
    const entry = byDay.get(day) ?? {
      day,
      model: 0,
      voice: 0,
      transcription: 0,
      users: 0,
      userIds: new Set<string>(),
    };
    entry[categoryOf(row.role)] += 1;
    entry.userIds.add(row.userId);
    byDay.set(day, entry);
  }
  return [...byDay.values()]
    .sort((a, b) => (a.day < b.day ? 1 : -1))
    .map(({ userIds, ...day }) => ({ ...day, users: userIds.size }));
}

export interface ScreenReadViolation {
  at: Date;
  actor: string;
  mode: unknown;
}

/**
 * Screen reads outside Work or Look mode, from the audit log. Must be zero:
 * anything here is a privacy bug, listed, not counted away.
 */
export async function screenReadsOutside(): Promise<ScreenReadViolation[]> {
  const rows = await db()
    .select({ at: auditEvents.at, actor: auditEvents.actor, details: auditEvents.details })
    .from(auditEvents)
    .where(
      and(
        eq(auditEvents.action, "screen.read"),
        sql`${auditEvents.details}->>'mode' not in ('work', 'look')`,
      ),
    )
    .orderBy(desc(auditEvents.at))
    .limit(50);
  return rows.map((row) => ({
    at: row.at,
    actor: row.actor,
    mode: (row.details as Record<string, unknown>).mode ?? null,
  }));
}
