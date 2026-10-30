/**
 * The text-first turn protocol: the spoken reply streams as plain prose while
 * app actions wait in one fenced block at the end. The old shape answered
 * every turn as a single JSON blob, which forced the voice to wait for the
 * last brace before speaking. This shape lets speech start on the first
 * sentence:
 *
 *   Heard: "their exact words"
 *   Of course, here's what I found...
 *   ```actions
 *   [{"type": "remind", "text": "...", "at": null}]
 *   ```
 *
 * The Heard line captions what was understood; the fence holds the same
 * action objects the JSON protocol used. Turns without actions end after the
 * prose. Malformed tails (unclosed fence, unparseable JSON) are reported, not
 * fatal: the user still hears the reply.
 */
import { z } from "zod";

export const HEARD_PREFIX = "Heard:";
export const ACTIONS_OPEN = "```actions";
export const FENCE_CLOSE = "```";

/** Instructions appended to the turn prompt for streamed turns, spoken or typed. */
export const VOICE_TURN_INSTRUCTIONS = [
  "Answer in two parts. First the spoken reply as plain prose: no JSON, no backticks, no stage directions.",
  `Start with one line: ${HEARD_PREFIX} "their exact words". Then the reply itself.`,
  "Then, only when the turn needs app actions, one fenced block:",
  ACTIONS_OPEN,
  '[{"type": "...", ...}]',
  FENCE_CLOSE,
  "Close the fence. If you asked an interview question, add its key on a line after the fence: Asked: <key>. Otherwise no prose after the fence.",
].join("\n");

export const ASKED_PREFIX = "Asked:";

export type TurnEvent =
  | { type: "heard"; text: string }
  | { type: "prose"; text: string }
  | { type: "actions"; actions: Record<string, unknown>[] }
  | { type: "asked"; key: string }
  | { type: "malformed-tail"; raw: string };

export interface TextTurn {
  heard: string | null;
  prose: string;
  actions: Record<string, unknown>[];
  /** The interview question asked, from the Asked line after the fence. */
  asked: string | null;
  /** The actions fence never closed or never parsed; prose still stands. */
  malformedTail: boolean;
}

const actionSchema = z.object({ type: z.string() }).passthrough();

/** Parses one complete protocol reply. Streaming callers use the splitter. */
export function parseTextTurn(reply: string): TextTurn {
  const turn: TextTurn = { heard: null, prose: "", actions: [], asked: null, malformedTail: false };
  const splitter = createTurnSplitter((event) => {
    if (event.type === "heard") turn.heard = event.text;
    else if (event.type === "prose") turn.prose += event.text;
    else if (event.type === "actions") turn.actions = event.actions;
    else if (event.type === "asked") turn.asked = event.key;
    else turn.malformedTail = true;
  });
  splitter.feed(reply);
  splitter.finish();
  turn.prose = turn.prose.trim();
  return turn;
}

/** A reply with no fence and no Heard line is plain prose, still speakable. */
export function isPlainProse(turn: TextTurn): boolean {
  return turn.heard === null && turn.actions.length === 0 && !turn.malformedTail;
}

interface TurnSplitter {
  feed(chunk: string): void;
  finish(): void;
}

/**
 * Incremental parser: feed stream chunks, get events. Prose flows at once;
 * the Heard line resolves on its newline; actions resolve on the fence close.
 * Everything waits boundedly, so a non-compliant model degrades to prose.
 */
export function createTurnSplitter(onEvent: (event: TurnEvent) => void): TurnSplitter {
  let buf = "";
  let heardDone = false;
  let inActions = false;
  let fenced = false;
  let finished = false;

  const emitProse = (text: string) => {
    if (text) onEvent({ type: "prose", text });
  };

  /** Settles the Heard line once the first line can be judged. */
  const settleHeard = () => {
    buf = buf.replace(/^\s*\n/, "");
    if (!buf || heardDone) return;
    const newline = buf.indexOf("\n");
    if (newline < 0) {
      if (isHeardPrefix(buf) && buf.length <= HEARD_LINE_CAP) return;
      heardDone = true;
      return;
    }
    heardDone = true;
    const line = buf.slice(0, newline).trim();
    buf = buf.slice(newline + 1);
    if (line.startsWith(HEARD_PREFIX)) {
      const text = unquote(line.slice(HEARD_PREFIX.length).trim());
      if (text) onEvent({ type: "heard", text });
    } else {
      buf = `${line}\n${buf}`;
    }
  };

  /** Emits prose up to, but never into, a possibly partial fence opener. */
  const emitProseUpToFence = () => {
    const fence = buf.indexOf(ACTIONS_OPEN);
    if (fence >= 0) {
      emitProse(buf.slice(0, fence));
      buf = buf.slice(fence + ACTIONS_OPEN.length);
      inActions = true;
      return;
    }
    const holdback = ACTIONS_OPEN.length - 1;
    if (buf.length > holdback) {
      emitProse(buf.slice(0, buf.length - holdback));
      buf = buf.slice(buf.length - holdback);
    }
  };

  const closeActions = (body: string, closed: boolean) => {
    const actions = salvageActions(body);
    onEvent({ type: "actions", actions });
    if (!closed) onEvent({ type: "malformed-tail", raw: body });
  };

  /** Reads the Asked line out of the post-fence trailer; the rest stays prose. */
  const emitTrailer = (trailer: string) => {
    const rest: string[] = [];
    for (const line of trailer.split("\n")) {
      if (line.trim().startsWith(ASKED_PREFIX)) {
        const key = line.trim().slice(ASKED_PREFIX.length).trim();
        if (key) onEvent({ type: "asked", key });
      } else {
        rest.push(line);
      }
    }
    const prose = rest.join("\n").trim();
    if (prose) emitProse(prose);
  };

  return {
    feed(chunk) {
      if (finished || !chunk) return;
      buf += chunk;
      // Past the fence, everything waits for finish(): the Asked line must be
      // read out of the trailer, never spoken.
      if (fenced) return;
      if (!heardDone) settleHeard();
      if (!heardDone) return;
      if (inActions) {
        const close = buf.indexOf(FENCE_CLOSE);
        if (close < 0) return;
        const body = buf.slice(0, close);
        buf = buf.slice(close + FENCE_CLOSE.length);
        inActions = false;
        fenced = true;
        closeActions(body, true);
        return;
      }
      emitProseUpToFence();
    },
    finish() {
      if (finished) return;
      finished = true;
      if (!heardDone) {
        if (!buf.includes("\n") && buf.trim().startsWith(HEARD_PREFIX)) {
          const text = unquote(buf.trim().slice(HEARD_PREFIX.length).trim());
          if (text) onEvent({ type: "heard", text });
          buf = "";
        } else {
          settleHeard();
          // Still undecided: the whole reply is one line, treat it as prose.
        }
        heardDone = true;
      }
      if (fenced) {
        emitTrailer(buf);
        buf = "";
        return;
      }
      if (!inActions) {
        const fence = buf.indexOf(ACTIONS_OPEN);
        if (fence >= 0) {
          emitProse(buf.slice(0, fence));
          closeActions(buf.slice(fence + ACTIONS_OPEN.length), false);
        } else {
          emitProse(buf);
        }
        buf = "";
        return;
      }
      const close = buf.indexOf(FENCE_CLOSE);
      if (close >= 0) {
        closeActions(buf.slice(0, close), true);
        emitTrailer(buf.slice(close + FENCE_CLOSE.length));
      } else {
        closeActions(buf, false);
      }
      buf = "";
    },
  };
}

/** A Heard line is one short line; past this, the reply is prose. */
const HEARD_LINE_CAP = 300;

const isHeardPrefix = (text: string) =>
  HEARD_PREFIX.startsWith(text.slice(0, Math.min(text.length, HEARD_PREFIX.length)));

const unquote = (text: string) =>
  text.length >= 2 &&
  ((text.startsWith('"') && text.endsWith('"')) || (text.startsWith("'") && text.endsWith("'")))
    ? text.slice(1, -1)
    : text;

/**
 * Reads the fence body leniently: entries without a string type are dropped,
 * lone objects are wrapped, and anything unparseable yields no actions.
 */
function salvageActions(body: string): Record<string, unknown>[] {
  let json: unknown;
  try {
    json = JSON.parse(body.trim());
  } catch {
    return [];
  }
  const list = Array.isArray(json) ? json : [json];
  const actions: Record<string, unknown>[] = [];
  for (const entry of list) {
    const parsed = actionSchema.safeParse(entry);
    if (parsed.success) actions.push(parsed.data);
  }
  return actions;
}
