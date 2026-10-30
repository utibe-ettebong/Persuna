/**
 * Per-turn voice timing: how long from the caller speaking to Persuna's first
 * sound, and where the time went. Each turn gets a timer; stages mark it;
 * slice C's measurement reads the summaries. The clock is injectable so tests
 * use a fake and routes use real time.
 */
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

/** One JSON line per turn; the measurement gate in slice C scrapes these. */
export function logVoiceTurn(route: string, timer: TurnTimer): void {
  console.log(JSON.stringify({ scope: "voice-turn", route, ...timer.summary() }));
}
