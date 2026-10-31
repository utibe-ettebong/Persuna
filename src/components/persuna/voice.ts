"use client";

/**
 * Persuna's voice. Speaking uses the cloud voice when the server has one
 * (POST /api/persuna/speak), and otherwise the browser's speech synthesis
 * with the most natural voice available. Listening is hands-free: the microphone stays open,
 * a recording starts when you speak and ends after a short pause, and each
 * utterance is handed back for transcription. While Persuna talks it only
 * listens for you talking over it, judged against its own voice's loudness.
 */

import { startLiveHearing, type LiveHearing } from "./live-hearing";

const PREFERRED = [
  /natural/i,
  /neural/i,
  /premium|enhanced/i,
  /google uk english female/i,
  /google us english/i,
  /samantha|ava|serena|allison|zoe/i,
];

let chosen: SpeechSynthesisVoice | null = null;

function pickVoice(): SpeechSynthesisVoice | null {
  if (chosen) return chosen;
  const voices = speechSynthesis.getVoices().filter((v) => /^en(-|_|$)/i.test(v.lang));
  for (const re of PREFERRED) {
    const v = voices.find((x) => re.test(x.name));
    if (v) return (chosen = v);
  }
  return (chosen = voices.find((v) => v.default) ?? voices[0] ?? null);
}

/** Plain sentences for speaking: no markdown, links, bullets or emoji. */
export function speakable(text: string): string[] {
  const plain = text
    .replace(/https?:\/\/\S+/g, "")
    .replace(/[*_`#>|]/g, "")
    .replace(/^\s*[•\-]\s*/gm, "")
    .replace(/\p{Extended_Pictographic}/gu, "")
    .replace(/\s+/g, " ")
    .trim();
  return (
    plain
      .match(/[^.!?]+[.!?]*/g)
      ?.map((s) => s.trim())
      .filter(Boolean) ?? []
  );
}

export function canSpeak(): boolean {
  return typeof window !== "undefined" && "speechSynthesis" in window;
}

/** One cloud request speaks up to this much (the server's limit), so a reply is one take. */
export const CLOUD_CHUNK_CHARS = 1500;

/**
 * Groups sentences for the cloud voice. A normal reply is a single piece, so
 * it's said in one breath, with no gaps or changes of tone between sentences;
 * only very long ones are split, at sentence ends.
 */
export function speechChunks(sentences: string[]): string[] {
  const chunks: string[] = [];
  for (const sentence of sentences) {
    const last = chunks.at(-1);
    if (last && last.length + sentence.length + 1 <= CLOUD_CHUNK_CHARS) {
      chunks[chunks.length - 1] = `${last} ${sentence}`;
    } else chunks.push(sentence);
  }
  return chunks;
}

export interface SpeakHandlers {
  /** 0–1 "mouth" value. */
  onLevel: (level: number) => void;
  /** A piece of the text has just started being spoken: show it now. */
  onSpoken?: (text: string) => void;
}

let generation = 0;
let queue: Promise<void> = Promise.resolve();
let lastLevel = 0;
/** Set once the server says it has no cloud voice (or it keeps failing). */
let cloudOff = false;
let cloudFailures = 0;
let playing: HTMLAudioElement | null = null;
let audioCtx: AudioContext | null = null;
/** Wakes speech queues waiting for their next sentence (see stopSpeaking). */
const queueWaiters = new Set<() => void>();

/** Assumed loudness of the browser's voice, which can't be measured. */
const BROWSER_VOICE_LEVEL = 0.2;

/** How loud Persuna's own voice is right now (to tell it apart from yours). */
export const ownLevel = () => lastLevel;

/**
 * Says `text` in full, after anything already being said (lines queue up
 * instead of cutting each other off). Uses the cloud voice when there is one
 * (styled to the user's tone on the server), else the browser's. Resolves
 * when this line has been spoken, or when speech is stopped.
 */
export function speak(text: string, handlers: SpeakHandlers): Promise<void> {
  const mine = generation;
  const level = (l: number) => {
    lastLevel = l;
    handlers.onLevel(l);
  };
  const run = async () => {
    if (mine !== generation) return;
    const sentences = speakable(text);
    if (!sentences.length) return;
    if (!cloudOff && (await speakInCloud(sentences, { ...handlers, onLevel: level }, mine))) return;
    // The browser voice's mouth movement is animation, not a measurement of how
    // loud it is, so for telling your voice apart assume a moderate level.
    const animated = (l: number) => {
      lastLevel = l > 0 ? BROWSER_VOICE_LEVEL : 0;
      handlers.onLevel(l);
    };
    if (mine === generation)
      await speakInBrowser(sentences, { ...handlers, onLevel: animated }, mine);
  };
  const done = queue.then(run, run);
  queue = done.catch(() => {});
  return done;
}

/** How long a direct connection gets to start sounding before the server route takes over. */
const DIRECT_FIRST_AUDIO_MS = 2500;

/** A connection straight to the voice provider, opened before it's needed. */
let readySocket: WebSocket | null = null;
let warming = false;
/** Set when the server has no direct address, or direct speech keeps failing. */
let directOff = false;
let directFailures = 0;

/**
 * Opens a direct connection ahead of the next line, so speech skips this
 * server and the connection's own set-up time. Safe to call often.
 */
export async function warmVoice(): Promise<void> {
  if (warming || directOff || cloudOff || readySocket?.readyState === WebSocket.OPEN) return;
  warming = true;
  try {
    const res = await fetch("/api/persuna/speak-token", { method: "POST" });
    if (res.status === 204) directOff = true;
    if (!res.ok || res.status === 204) return;
    const { url } = (await res.json()) as { url: string };
    const socket = new WebSocket(url);
    await new Promise<void>((resolve, reject) => {
      socket.onopen = () => resolve();
      socket.onerror = () => reject(new Error("no direct connection"));
    });
    socket.onclose = () => {
      if (readySocket === socket) readySocket = null;
    };
    // The first message opens the stream; nothing is said until there's text.
    socket.send(JSON.stringify({ text: " " }));
    readySocket = socket;
  } catch {
    if (++directFailures >= 3) directOff = true;
  } finally {
    warming = false;
  }
}

/**
 * Speaks `text` over an open connection, as a Response like the server route's
 * so playback is the same. Null when no audio comes in time.
 */
export function speakOverSocket(
  socket: Pick<WebSocket, "send" | "close" | "onmessage" | "onclose">,
  text: string,
  firstAudioMs = DIRECT_FIRST_AUDIO_MS,
): Promise<Response | null> {
  return new Promise((resolve) => {
    let out: ReadableStreamDefaultController<Uint8Array> | null = null;
    let started = false;
    let ended = false;
    const body = new ReadableStream<Uint8Array>({
      start: (controller) => void (out = controller),
      cancel: () => {
        ended = true;
        socket.close();
      },
    });
    const end = () => {
      if (ended) return;
      ended = true;
      window.clearTimeout(timer);
      if (started) out?.close();
      else resolve(null);
      socket.close();
    };
    const timer = window.setTimeout(end, firstAudioMs);
    socket.onmessage = (event) => {
      const message = JSON.parse(event.data as string) as { audio?: string; isFinal?: boolean };
      if (message.audio && !ended) {
        out?.enqueue(Uint8Array.from(atob(message.audio), (c) => c.charCodeAt(0)));
        if (!started) {
          started = true;
          window.clearTimeout(timer);
          resolve(new Response(body, { headers: { "content-type": "audio/mpeg" } }));
        }
      }
      if (message.isFinal) end();
    };
    socket.onclose = end;
    socket.send(JSON.stringify({ text: `${text} ` }));
    // An empty message ends the stream, so the provider finishes and says so.
    socket.send(JSON.stringify({ text: "" }));
  });
}

/** One line over the connection that's ready, if there is one; the next is opened at once. */
async function fetchDirect(text: string): Promise<Response | null> {
  const socket = readySocket;
  if (!socket || socket.readyState !== WebSocket.OPEN) return null;
  readySocket = null;
  void warmVoice();
  const res = await speakOverSocket(socket, text);
  if (res) directFailures = 0;
  else if (++directFailures >= 3) directOff = true;
  return res;
}

/** Starts one piece of cloud speech; null means "use the browser voice". */
async function fetchSpeech(text: string): Promise<Response | null> {
  const direct = await fetchDirect(text);
  if (direct) return direct;
  try {
    const res = await fetch("/api/persuna/speak", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ text }),
    });
    if (res.status === 204) {
      cloudOff = true;
      return null;
    }
    if (!res.ok) {
      if (++cloudFailures >= 3) cloudOff = true;
      return null;
    }
    cloudFailures = 0;
    return res;
  } catch {
    return null;
  }
}

async function speakInCloud(
  sentences: string[],
  handlers: SpeakHandlers,
  mine: number,
): Promise<boolean> {
  const chunks = speechChunks(sentences);
  // Ask for the next piece while the current one plays, so there are no gaps.
  let next = fetchSpeech(chunks[0]);
  for (let i = 0; i < chunks.length; i++) {
    const res = await next;
    if (mine !== generation) {
      void res?.body?.cancel();
      return true;
    }
    if (!res) {
      // The cloud voice failed part-way: say the rest in the browser's voice.
      if (i === 0) return false;
      await speakInBrowser(chunks.slice(i), handlers, mine);
      return true;
    }
    if (i + 1 < chunks.length) next = fetchSpeech(chunks[i + 1]);
    handlers.onSpoken?.(chunks[i]);
    if (!(await play(res, handlers.onLevel, mine))) {
      await speakInBrowser(chunks.slice(i), handlers, mine);
      return true;
    }
  }
  return true;
}

/**
 * An audio element for streamed speech: it starts playing as the first bytes
 * arrive (MediaSource), or, where that isn't available, once it's all here.
 */
async function audioFor(
  res: Response,
  mine: number,
): Promise<{ audio: HTMLAudioElement; url: string }> {
  const type = res.headers.get("content-type") ?? "audio/mpeg";
  const body = res.body;
  if (body && typeof MediaSource !== "undefined" && MediaSource.isTypeSupported(type)) {
    const source = new MediaSource();
    const url = URL.createObjectURL(source);
    source.addEventListener(
      "sourceopen",
      () => {
        const buffer = source.addSourceBuffer(type);
        const appended = () =>
          new Promise<void>((resolve) =>
            buffer.updating
              ? buffer.addEventListener("updateend", () => resolve(), { once: true })
              : resolve(),
          );
        void (async () => {
          const reader = body.getReader();
          try {
            for (;;) {
              const { done, value } = await reader.read();
              if (done || mine !== generation || source.readyState !== "open") break;
              buffer.appendBuffer(value);
              await appended();
            }
          } catch {
            // A dropped connection ends the speech where it got to.
          } finally {
            void reader.cancel().catch(() => {});
            await appended();
            if (source.readyState === "open") source.endOfStream();
          }
        })();
      },
      { once: true },
    );
    return { audio: new Audio(url), url };
  }
  const url = URL.createObjectURL(await res.blob());
  return { audio: new Audio(url), url };
}

/** Plays one piece of speech, driving the mouth from the real sound. */
async function play(res: Response, onLevel: (l: number) => void, mine: number): Promise<boolean> {
  if (mine !== generation) return true;
  const { audio, url } = await audioFor(res, mine);
  playing = audio;
  let meter = 0;
  try {
    audioCtx ??= new AudioContext();
    const analyser = audioCtx.createAnalyser();
    analyser.fftSize = 512;
    audioCtx.createMediaElementSource(audio).connect(analyser);
    analyser.connect(audioCtx.destination);
    const data = new Float32Array(analyser.fftSize);
    meter = window.setInterval(() => {
      analyser.getFloatTimeDomainData(data);
      let sum = 0;
      for (const v of data) sum += v * v;
      onLevel(Math.min(1, Math.sqrt(sum / data.length) * 5));
    }, 50);
  } catch {
    meter = window.setInterval(() => onLevel(0.35 + Math.random() * 0.65), 90);
  }
  try {
    await new Promise<void>((resolve, reject) => {
      audio.onended = () => resolve();
      audio.onpause = () => resolve();
      audio.onerror = () => reject(new Error("playback failed"));
      audio.play().catch(reject);
    });
    return true;
  } catch {
    return false;
  } finally {
    clearInterval(meter);
    onLevel(0);
    URL.revokeObjectURL(url);
    if (playing === audio) playing = null;
  }
}

function stopAudio() {
  if (playing) {
    playing.pause();
    playing = null;
  }
}

/** Longest a single sentence may take before we assume the browser went quiet. */
const SENTENCE_LIMIT_MS = 30_000;

/**
 * Says sentences one at a time in the browser's voice (long utterances get
 * cut off in some browsers). A sentence counts as finished when the browser
 * says so, or, where it never does, once it has stopped speaking: never on a
 * guess while it's still talking.
 */
async function speakInBrowser(
  sentences: string[],
  handlers: SpeakHandlers,
  mine: number,
): Promise<void> {
  if (!canSpeak()) {
    sentences.forEach((s) => handlers.onSpoken?.(s));
    return;
  }
  for (const sentence of sentences) {
    if (mine !== generation) break;
    await new Promise<void>((resolve) => {
      const u = new SpeechSynthesisUtterance(sentence);
      const voice = pickVoice();
      if (voice) u.voice = voice;
      u.rate = 1.03;
      u.pitch = 1.05;
      let pulse = 0;
      let shown = false;
      const show = () => {
        if (shown) return;
        shown = true;
        handlers.onSpoken?.(sentence);
      };
      const finish = () => {
        clearInterval(pulse);
        clearInterval(watch);
        handlers.onLevel(0);
        show();
        resolve();
      };
      u.onstart = () => {
        show();
        pulse = window.setInterval(() => handlers.onLevel(0.35 + Math.random() * 0.65), 90);
      };
      u.onboundary = () => handlers.onLevel(1);
      u.onend = finish;
      u.onerror = finish;
      // Some browsers never fire events (no voices, or blocked before a click).
      // Wait at least a sensible time, then until the browser is quiet.
      const started = Date.now();
      const atLeast = 1200 + sentence.split(/\s+/).length * 450;
      const watch = window.setInterval(() => {
        const elapsed = Date.now() - started;
        if (mine !== generation) return finish();
        if (elapsed < atLeast) return;
        if (!speechSynthesis.speaking || elapsed > SENTENCE_LIMIT_MS) finish();
      }, 200);
      speechSynthesis.speak(u);
    });
  }
  handlers.onLevel(0);
}

/** A soft two-note chime: Persuna is listening (rising) or has stopped (falling). */
export function chime(up = true) {
  try {
    audioCtx ??= new AudioContext();
    const ctx = audioCtx;
    const notes = up ? [660, 990] : [880, 590];
    notes.forEach((freq, i) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      const at = ctx.currentTime + i * 0.09;
      osc.frequency.value = freq;
      gain.gain.setValueAtTime(0.0001, at);
      gain.gain.exponentialRampToValueAtTime(0.08, at + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, at + 0.16);
      osc.connect(gain).connect(ctx.destination);
      osc.start(at);
      osc.stop(at + 0.18);
    });
  } catch {
    // No audio output: the orb's colour still shows it's listening.
  }
}

/** A soft tick the moment you finish talking: heard, on the way. No network involved. */
export function ackTick() {
  try {
    audioCtx ??= new AudioContext();
    const ctx = audioCtx;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    const at = ctx.currentTime;
    osc.frequency.value = 1180;
    gain.gain.setValueAtTime(0.0001, at);
    gain.gain.exponentialRampToValueAtTime(0.06, at + 0.008);
    gain.gain.exponentialRampToValueAtTime(0.0001, at + 0.07);
    osc.connect(gain).connect(ctx.destination);
    osc.start(at);
    osc.stop(at + 0.08);
  } catch {
    // No audio output: the island still changes straight away.
  }
}

/** Stops speaking now and drops anything waiting to be said. */
export function stopSpeaking() {
  generation++;
  queue = Promise.resolve();
  lastLevel = 0;
  stopAudio();
  if (canSpeak()) speechSynthesis.cancel();
  for (const wake of queueWaiters) wake();
  queueWaiters.clear();
}

/* ---------- Streaming speech ---------- */

export interface SpeechQueue {
  /** Hands one sentence to the queue, in order. */
  push(sentence: string): void;
  /** No more sentences: resolves when the queue has spoken them all. */
  finish(): Promise<void>;
}

/**
 * Speaks sentences as they arrive over the stream: the first is fetched as
 * soon as it's written, each next one while the previous plays, so streamed
 * replies sound continuous. Falls back to the browser's voice exactly like
 * {@link speak} when the cloud voice is off or fails. Stopped by
 * {@link stopSpeaking}, like anything being said.
 */
export function createSpeechQueue(
  handlers: SpeakHandlers,
  deps: {
    fetchSpeech?: (text: string) => Promise<Response | null>;
    playSpeech?: (
      res: Response,
      onLevel: (level: number) => void,
      mine: number,
    ) => Promise<boolean>;
    speakBrowser?: (sentences: string[], handlers: SpeakHandlers, mine: number) => Promise<void>;
  } = {},
): SpeechQueue {
  const mine = generation;
  const fetchAudio = deps.fetchSpeech ?? fetchSpeech;
  const playAudio = deps.playSpeech ?? play;
  const speakIn = deps.speakBrowser ?? speakInBrowser;
  const pending: string[] = [];
  let done = false;
  let waiter: (() => void) | null = null;
  const wake = () => {
    const woken = waiter;
    waiter = null;
    woken?.();
  };
  queueWaiters.add(wake);
  const take = (): Promise<string | null> => {
    const next = pending.shift();
    if (next !== undefined) return Promise.resolve(next);
    if (done || mine !== generation) return Promise.resolve(null);
    return new Promise((resolve) => {
      waiter = () => resolve(take());
    });
  };
  const finished = (async () => {
    try {
      if (cloudOff) {
        for (let text = await take(); text !== null; text = await take()) {
          if (mine !== generation) return;
          await speakIn([text], handlers, mine);
        }
        return;
      }
      let current = await take();
      if (current === null || mine !== generation) return;
      let res = await fetchAudio(current);
      for (;;) {
        if (mine !== generation) {
          void res?.body?.cancel();
          return;
        }
        if (!res) {
          // The cloud voice failed: the rest goes in the browser's voice.
          for (let text: string | null = current; text !== null; text = await take()) {
            if (mine !== generation) return;
            await speakIn([text], handlers, mine);
          }
          return;
        }
        const following = take();
        handlers.onSpoken?.(current);
        const played = playAudio(res, handlers.onLevel, mine);
        const nextText = await following;
        const nextFetch = nextText === null ? null : fetchAudio(nextText);
        if (!(await played)) {
          // Playback failed: current and everything after it in the browser's voice.
          const rest = nextText === null ? [] : [nextText];
          for (;;) {
            const text = await take();
            if (text === null) break;
            rest.push(text);
          }
          await speakIn([current, ...rest], handlers, mine);
          return;
        }
        if (nextText === null || mine !== generation) {
          void nextFetch?.then((r) => r?.body?.cancel());
          return;
        }
        current = nextText;
        res = await nextFetch;
      }
    } finally {
      queueWaiters.delete(wake);
    }
  })();
  return {
    push(sentence) {
      pending.push(sentence);
      wake();
    },
    finish() {
      done = true;
      wake();
      return finished;
    },
  };
}

/* ---------- Streamed turns ---------- */

/** One event from the streamed voice turn (POST /api/persuna/chat-stream). */
export type StreamEvent<T = unknown> =
  | { name: "heard"; text: string }
  | { name: "sentence"; text: string }
  | { name: "done"; result: T }
  | { name: "error"; message: string }
  | { name: "look-closer"; heard: string; said: string };

/** Reads one SSE event block; null when it isn't one of ours. */
export function parseStreamEvent<T = unknown>(raw: string): StreamEvent<T> | null {
  const name = /^event: ([\w-]+)$/m.exec(raw)?.[1];
  const data = /^data: (.*)$/m.exec(raw)?.[1];
  if (!name || data === undefined) return null;
  try {
    const json = JSON.parse(data) as {
      text?: unknown;
      message?: unknown;
      heard?: unknown;
      said?: unknown;
    };
    if (name === "done") return { name, result: json as T };
    if (name === "look-closer" && typeof json.heard === "string")
      return { name, heard: json.heard, said: typeof json.said === "string" ? json.said : "" };
    if (name === "error")
      return {
        name,
        message: typeof json.message === "string" ? json.message : "Something went wrong.",
      };
    if ((name === "heard" || name === "sentence") && typeof json.text === "string")
      return { name, text: json.text };
    return null;
  } catch {
    return null;
  }
}

/** How a streamed turn ended: saved, failed, or asking for the screenshot held back. */
export interface TurnOutcome<T> {
  result: T | null;
  failed: string | null;
  closer: { heard: string; said: string } | null;
}

/** Reads one turn's Server-Sent Events, reporting words as they arrive. */
export async function readTurnStream<T>(
  body: ReadableStream<Uint8Array>,
  on: { heard: (text: string) => void; sentence: (text: string) => void },
): Promise<TurnOutcome<T>> {
  const outcome: TurnOutcome<T> = { result: null, failed: null, closer: null };
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buf = "";
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (value) buf += decoder.decode(value, { stream: true });
      if (done) buf += decoder.decode();
      let idx: number;
      while ((idx = buf.indexOf("\n\n")) >= 0) {
        const event = parseStreamEvent<T>(buf.slice(0, idx));
        buf = buf.slice(idx + 2);
        if (event?.name === "sentence") on.sentence(event.text);
        else if (event?.name === "heard") on.heard(event.text);
        else if (event?.name === "done") outcome.result = event.result;
        else if (event?.name === "error") outcome.failed = event.message;
        else if (event?.name === "look-closer")
          outcome.closer = { heard: event.heard, said: event.said };
      }
      if (done) break;
    }
  } finally {
    reader.releaseLock();
  }
  return outcome;
}

/* ---------- Hands-free listening ---------- */

export interface Conversation {
  stop(): void;
  /** True while the user is mid-utterance. */
  userSpeaking(): boolean;
}

const START_LEVEL = 0.08;
/**
 * Talking over Persuna needs a clearly louder voice than Persuna's own coming
 * out of the speakers, held for a moment, so its own voice never interrupts it.
 */
const BARGE_LEVEL = 0.3;
const BARGE_OVER_OWN = 1.4;
/** Speech dips between syllables, so "talking over" means loud for most of this window. */
const BARGE_WINDOW_MS = 700;
const BARGE_SHARE = 0.6;
/** A pause this long ends your turn; shorter ones are just you thinking. */
const SILENCE_MS = 1000;
/**
 * A finished-sounding sentence needs only this much quiet to end your turn:
 * the rest of the hush is detection lag, not thinking. Without live words
 * (or a sentence still going) the full hush stays the backstop.
 */
export const EARLY_SILENCE_MS = 450;

/**
 * Whether what's been heard so far sounds finished: ends with a full stop,
 * question or exclamation mark, past any closing quotes. Streaming
 * transcripts punctuate as they go; without punctuation nothing is assumed.
 */
export function utteranceComplete(soFar: string): boolean {
  return /[.!?…]["'”’)\]]*\s*$/.test(soFar.trim()) && soFar.trim().length > 1;
}
const MIN_SPEECH_MS = 350;
/** Persuna cuts in after this much uninterrupted talking. */
export const LONG_TURN_MS = 25_000;

export type UtteranceEnd = "pause" | "long" | "persuna";

/**
 * Hands-free conversation, both ways:
 * - you can talk over Persuna: a clear, sustained voice while it speaks
 *   stops it (`onBargeIn`) and your words are recorded;
 * - Persuna can talk over you: if it starts speaking (an urgent reminder),
 *   or you talk for {@link LONG_TURN_MS}, your turn ends there and what you
 *   said so far is kept, with `end` saying why.
 */
export async function startConversation(handlers: {
  onLevel: (level: number) => void;
  /**
   * An utterance, with when the speech itself ended: the last loud moment for
   * a pause (detection lags it by the hush), now when Persuna cut in. Turn
   * timing counts from there, not from when the pause was noticed.
   */
  onUtterance: (
    audio: Blob,
    end: UtteranceEnd,
    words: Promise<string | null> | null,
    speechEnd: number,
  ) => void;
  /** What's been understood so far, as you talk. */
  onWords?: (soFar: string) => void;
  /** Persuna is speaking. */
  speaking: () => boolean;
  /** Persuna is thinking: don't start a new turn. */
  busy: () => boolean;
  /** You started talking over Persuna. */
  onBargeIn: () => void;
}): Promise<Conversation> {
  const stream = await navigator.mediaDevices.getUserMedia({ audio: micConstraints() });
  const ctx = new AudioContext();
  const source = ctx.createMediaStreamSource(stream);
  const analyser = ctx.createAnalyser();
  analyser.fftSize = 1024;
  source.connect(analyser);
  const data = new Float32Array(analyser.fftSize);

  let recorder: MediaRecorder | null = null;
  let hearing: LiveHearing | null = null;
  let chunks: Blob[] = [];
  let speechStart = 0;
  let lastLoud = 0;
  /** What's been understood so far this utterance, for ending it early. */
  let soFar = "";
  /** Recent moments while Persuna speaks: [time, were you louder than it]. */
  let recent: [number, boolean][] = [];
  let bargeUntil = 0;
  let stopped = false;

  const begin = () => {
    chunks = [];
    soFar = "";
    recorder = new MediaRecorder(stream);
    recorder.ondataavailable = (e) => e.data.size && chunks.push(e.data);
    recorder.start(200);
    hearing = startLiveHearing(stream, (text) => {
      soFar = text;
      handlers.onWords?.(text);
    });
    speechStart = performance.now();
    lastLoud = speechStart;
  };
  const end = (why: UtteranceEnd) => {
    const rec = recorder;
    recorder = null;
    if (!rec || rec.state === "inactive") return;
    const spoke = lastLoud - speechStart >= MIN_SPEECH_MS || why !== "pause";
    const live = hearing;
    hearing = null;
    const words = spoke && !stopped ? (live?.finish() ?? null) : null;
    if (!words) live?.cancel();
    const speechEnd = why === "pause" ? lastLoud : performance.now();
    rec.onstop = () => {
      if (!stopped && spoke && chunks.length) {
        handlers.onUtterance(
          new Blob(chunks, { type: rec.mimeType || "audio/webm" }),
          why,
          words,
          speechEnd,
        );
      }
    };
    rec.stop();
  };

  const timer = window.setInterval(() => {
    analyser.getFloatTimeDomainData(data);
    let sum = 0;
    for (const v of data) sum += v * v;
    const level = Math.min(1, Math.sqrt(sum / data.length) * 6);
    const now = performance.now();

    if (handlers.speaking() && now > bargeUntil) {
      // Persuna started talking while you were mid-sentence: keep what you said.
      if (recorder) end("persuna");
      const over = Math.max(BARGE_LEVEL, ownLevel() * BARGE_OVER_OWN + 0.12);
      recent.push([now, level > over]);
      recent = recent.filter(([t]) => now - t <= BARGE_WINDOW_MS);
      const spanned = recent.length > 0 && now - recent[0][0] >= BARGE_WINDOW_MS * 0.9;
      const share = recent.filter(([, loud]) => loud).length / Math.max(1, recent.length);
      if (spanned && share >= BARGE_SHARE) {
        recent = [];
        // Persuna takes a moment to fall silent; keep this recording meanwhile.
        bargeUntil = now + 1500;
        handlers.onBargeIn();
        begin();
      }
      return;
    }
    recent = [];
    handlers.onLevel(level);
    if (handlers.busy() && !recorder) return;
    if (level > START_LEVEL) {
      lastLoud = now;
      if (!recorder) begin();
    }
    if (!recorder) return;
    const hush = now - lastLoud;
    if (hush > SILENCE_MS) end("pause");
    else if (hush > EARLY_SILENCE_MS && utteranceComplete(soFar)) end("pause");
    else if (now - speechStart > LONG_TURN_MS) end("long");
  }, 33);

  return {
    stop() {
      stopped = true;
      clearInterval(timer);
      end("pause");
      stream.getTracks().forEach((t) => t.stop());
      void ctx.close();
      handlers.onLevel(0);
    },
    userSpeaking: () => Boolean(recorder),
  };
}

/* ---------- Choosing the microphone ---------- */

const MIC_KEY = "persuna.mic";

/** The microphone picked during setup (remembered in this browser or app), or the default. */
export function preferredMic(): string | null {
  try {
    return localStorage.getItem(MIC_KEY);
  } catch {
    return null;
  }
}

export function setPreferredMic(deviceId: string | null) {
  try {
    if (deviceId) localStorage.setItem(MIC_KEY, deviceId);
    else localStorage.removeItem(MIC_KEY);
  } catch {
    // Private window: the default microphone it is.
  }
}

export function micConstraints(deviceId = preferredMic()): MediaTrackConstraints {
  return {
    echoCancellation: true,
    noiseSuppression: true,
    autoGainControl: true,
    ...(deviceId && { deviceId: { ideal: deviceId } }),
  };
}

/**
 * A live level from the microphone (0–1), for the setup's mic test.
 * Returns a stop function.
 */
export async function meterMic(
  deviceId: string | null,
  onLevel: (level: number) => void,
): Promise<() => void> {
  const stream = await navigator.mediaDevices.getUserMedia({ audio: micConstraints(deviceId) });
  const ctx = new AudioContext();
  const analyser = ctx.createAnalyser();
  analyser.fftSize = 1024;
  ctx.createMediaStreamSource(stream).connect(analyser);
  const data = new Float32Array(analyser.fftSize);
  const timer = window.setInterval(() => {
    analyser.getFloatTimeDomainData(data);
    let sum = 0;
    for (const v of data) sum += v * v;
    onLevel(Math.min(1, Math.sqrt(sum / data.length) * 6));
  }, 50);
  return () => {
    clearInterval(timer);
    stream.getTracks().forEach((t) => t.stop());
    void ctx.close();
    onLevel(0);
  };
}

/* ---------- Hold to talk ---------- */

/** Shorter than this, or with no voice in it, a hold is ignored. */
export const MIN_HOLD_MS = 350;

export interface HoldRecording {
  /**
   * Let go: the recording and the words heard live (which arrive a moment
   * later), or null if it was too short or silent.
   */
  stop(): Promise<{ audio: Blob; words: Promise<string | null> | null } | null>;
  cancel(): void;
}

/** Records for as long as the talk key is held, hearing the words as they're said. */
export async function startHoldRecording(
  onLevel: (level: number) => void,
  onWords?: (soFar: string) => void,
): Promise<HoldRecording> {
  const stream = await navigator.mediaDevices.getUserMedia({ audio: micConstraints() });
  const ctx = new AudioContext();
  const analyser = ctx.createAnalyser();
  analyser.fftSize = 1024;
  ctx.createMediaStreamSource(stream).connect(analyser);
  const data = new Float32Array(analyser.fftSize);
  const chunks: Blob[] = [];
  const recorder = new MediaRecorder(stream);
  recorder.ondataavailable = (e) => e.data.size && chunks.push(e.data);
  recorder.start(200);
  const live = startLiveHearing(stream, (soFar) => onWords?.(soFar));
  const startedAt = performance.now();
  let loudest = 0;
  const timer = window.setInterval(() => {
    analyser.getFloatTimeDomainData(data);
    let sum = 0;
    for (const v of data) sum += v * v;
    const level = Math.min(1, Math.sqrt(sum / data.length) * 6);
    loudest = Math.max(loudest, level);
    onLevel(level);
  }, 33);
  const close = () => {
    clearInterval(timer);
    stream.getTracks().forEach((t) => t.stop());
    void ctx.close();
    onLevel(0);
  };
  return {
    stop: () =>
      new Promise((resolve) => {
        const heardVoice = performance.now() - startedAt >= MIN_HOLD_MS && loudest > START_LEVEL;
        const words = heardVoice ? (live?.finish() ?? null) : null;
        if (!heardVoice) live?.cancel();
        recorder.onstop = () => {
          close();
          resolve(
            heardVoice && chunks.length
              ? { audio: new Blob(chunks, { type: recorder.mimeType || "audio/webm" }), words }
              : null,
          );
        };
        if (recorder.state === "inactive") recorder.onstop(new Event("stop"));
        else recorder.stop();
      }),
    cancel() {
      recorder.onstop = null;
      if (recorder.state !== "inactive") recorder.stop();
      live?.cancel();
      close();
    },
  };
}
