/**
 * Per-turn voice timing: how long from the caller speaking to Persuna's first
 * sound, and where the time went. Each turn gets a timer; stages mark it;
 * slice C's measurement reads the summaries. The clock is injectable so tests
 * use a fake and routes use real time.
 */
import { and, eq, isNull } from "drizzle-orm";
import { db, schema } from "@/db/client";
export type TurnMark = "heard" | "first-token" | "first-sentence" | "first-audio" | "end";

export interface TurnSummary {
  /** Total turn time: start to the end mark, in milliseconds. */
  turnMs: number | null;
  heardMs: number | null;
  firstTokenMs: number | null;
  firstSentenceMs: number | null;
  firstAudioMs: number | null;
  malformedTail: boolean;
}

export interface TurnTimer {
  mark(name: TurnMark): void;
  flagMalformedTail(): void;
  summary(): TurnSummary;
}

export function startTurn(now: () => number = () => performance.now()): TurnTimer {
  const t0 = now();
  const marks = new Map<TurnMark, number>();
  let malformedTail = false;
  const at = (name: TurnMark) => {
    const t = marks.get(name);
    return t === undefined ? null : Math.round((t - t0) * 10) / 10;
  };
  return {
    mark(name) {
      if (!marks.has(name)) marks.set(name, now());
    },
    flagMalformedTail() {
      malformedTail = true;
    },
    summary() {
      return {
        turnMs: at("end"),
        heardMs: at("heard"),
        firstTokenMs: at("first-token"),
        firstSentenceMs: at("first-sentence"),
        firstAudioMs: at("first-audio"),
        malformedTail,
      };
    },
  };
}

/** One JSON line per turn; the measurement script scrapes these. */
export function logVoiceTurn(
  route: string,
  timer: TurnTimer,
  extra: Record<string, unknown> = {},
): void {
  console.log(JSON.stringify({ scope: "voice-turn", route, ...timer.summary(), ...extra }));
}

/**
 * The same timing, persisted for the measures page (plan §9). Fire-and-forget:
 * a turn never fails because its metrics didn't save.
 */
export function recordVoiceTurn(
  userId: string,
  route: string,
  timer: TurnTimer,
  spoken: boolean,
  clientTurn?: string | null,
): void {
  try {
    const s = timer.summary();
    void db()
      .insert(schema.voiceTurns)
      .values({
        userId,
        route,
        spoken,
        clientTurn: clientTurn ?? null,
        heardMs: s.heardMs,
        firstTokenMs: s.firstTokenMs,
        firstSentenceMs: s.firstSentenceMs,
        firstAudioMs: s.firstAudioMs,
        turnMs: s.turnMs,
      })
      .catch((error) => console.error("voice-turn not recorded:", error));
  } catch (error) {
    console.error("voice-turn not recorded:", error);
  }
}

/**
 * The client's first-sound report, joined to its turn by the client's own id.
 * Only the turn's owner, only once, and only a sane duration counts — a stray
 * or replayed report is ignored, never an error. Resolves true when a row took it.
 */
export async function reportFirstAudio(
  userId: string,
  clientTurn: string,
  ms: number,
): Promise<boolean> {
  if (!clientTurn || !Number.isFinite(ms) || ms < 0 || ms > 10 * 60_000) return false;
  try {
    const done = await db()
      .update(schema.voiceTurns)
      .set({ firstAudioMs: Math.round(ms * 10) / 10 })
      .where(
        and(
          eq(schema.voiceTurns.userId, userId),
          eq(schema.voiceTurns.clientTurn, clientTurn),
          isNull(schema.voiceTurns.firstAudioMs),
        ),
      )
      .returning({ id: schema.voiceTurns.id });
    return done.length > 0;
  } catch (error) {
    console.error("first-audio not recorded:", error);
    return false;
  }
}
