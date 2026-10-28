"use client";

/**
 * Persona's voice. Speaking uses the cloud voice when the server has one
 * (POST /api/persona/speak), and otherwise the browser's speech synthesis
 * with the most natural voice available. Listening is hands-free: the microphone stays open,
 * a recording starts when you speak and ends after a short pause, and each
 * utterance is handed back for transcription. While Persona talks it only
 * listens for you talking over it, judged against its own voice's loudness.
 */

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

/** Assumed loudness of the browser's voice, which can't be measured. */
const BROWSER_VOICE_LEVEL = 0.2;

/** How loud Persona's own voice is right now (to tell it apart from yours). */
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

/** Starts one piece of cloud speech; null means "use the browser voice". */
async function fetchSpeech(text: string): Promise<Response | null> {
  try {
    const res = await fetch("/api/persona/speak", {
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

/** A soft two-note chime: Persona is listening (rising) or has stopped (falling). */
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

/** Stops speaking now and drops anything waiting to be said. */
export function stopSpeaking() {
  generation++;
  queue = Promise.resolve();
  lastLevel = 0;
  stopAudio();
  if (canSpeak()) speechSynthesis.cancel();
}

/* ---------- Hands-free listening ---------- */

export interface Conversation {
  stop(): void;
  /** True while the user is mid-utterance. */
  userSpeaking(): boolean;
}

const START_LEVEL = 0.08;
/**
 * Talking over Persona needs a clearly louder voice than Persona's own coming
 * out of the speakers, held for a moment, so its own voice never interrupts it.
 */
const BARGE_LEVEL = 0.3;
const BARGE_OVER_OWN = 1.4;
/** Speech dips between syllables, so "talking over" means loud for most of this window. */
const BARGE_WINDOW_MS = 700;
const BARGE_SHARE = 0.6;
/** A pause this long ends your turn; shorter ones are just you thinking. */
const SILENCE_MS = 1000;
const MIN_SPEECH_MS = 350;
/** Persona cuts in after this much uninterrupted talking. */
export const LONG_TURN_MS = 25_000;

export type UtteranceEnd = "pause" | "long" | "persona";

/**
 * Hands-free conversation, both ways:
 * - you can talk over Persona: a clear, sustained voice while it speaks
 *   stops it (`onBargeIn`) and your words are recorded;
 * - Persona can talk over you: if it starts speaking (an urgent reminder),
 *   or you talk for {@link LONG_TURN_MS}, your turn ends there and what you
 *   said so far is kept, with `end` saying why.
 */
export async function startConversation(handlers: {
  onLevel: (level: number) => void;
  onUtterance: (audio: Blob, end: UtteranceEnd) => void;
  /** Persona is speaking. */
  speaking: () => boolean;
  /** Persona is thinking: don't start a new turn. */
  busy: () => boolean;
  /** You started talking over Persona. */
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
  let chunks: Blob[] = [];
  let speechStart = 0;
  let lastLoud = 0;
  /** Recent moments while Persona speaks: [time, were you louder than it]. */
  let recent: [number, boolean][] = [];
  let bargeUntil = 0;
  let stopped = false;

  const begin = () => {
    chunks = [];
    recorder = new MediaRecorder(stream);
    recorder.ondataavailable = (e) => e.data.size && chunks.push(e.data);
    recorder.start(200);
    speechStart = performance.now();
    lastLoud = speechStart;
  };
  const end = (why: UtteranceEnd) => {
    const rec = recorder;
    recorder = null;
    if (!rec || rec.state === "inactive") return;
    const spoke = lastLoud - speechStart >= MIN_SPEECH_MS || why !== "pause";
    rec.onstop = () => {
      if (!stopped && spoke && chunks.length) {
        handlers.onUtterance(new Blob(chunks, { type: rec.mimeType || "audio/webm" }), why);
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
      // Persona started talking while you were mid-sentence: keep what you said.
      if (recorder) end("persona");
      const over = Math.max(BARGE_LEVEL, ownLevel() * BARGE_OVER_OWN + 0.12);
      recent.push([now, level > over]);
      recent = recent.filter(([t]) => now - t <= BARGE_WINDOW_MS);
      const spanned = recent.length > 0 && now - recent[0][0] >= BARGE_WINDOW_MS * 0.9;
      const share = recent.filter(([, loud]) => loud).length / Math.max(1, recent.length);
      if (spanned && share >= BARGE_SHARE) {
        recent = [];
        // Persona takes a moment to fall silent; keep this recording meanwhile.
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
    if (now - lastLoud > SILENCE_MS) end("pause");
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

const MIC_KEY = "persona.mic";

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
  /** Let go: the recording, or null if it was too short or silent. */
  stop(): Promise<Blob | null>;
  cancel(): void;
}

/** Records for as long as the talk key is held. */
export async function startHoldRecording(onLevel: (level: number) => void): Promise<HoldRecording> {
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
        const long = performance.now() - startedAt >= MIN_HOLD_MS;
        recorder.onstop = () => {
          close();
          resolve(
            long && loudest > START_LEVEL && chunks.length
              ? new Blob(chunks, { type: recorder.mimeType || "audio/webm" })
              : null,
          );
        };
        if (recorder.state === "inactive") recorder.onstop(new Event("stop"));
        else recorder.stop();
      }),
    cancel() {
      recorder.onstop = null;
      if (recorder.state !== "inactive") recorder.stop();
      close();
    },
  };
}
