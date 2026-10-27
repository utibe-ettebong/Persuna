"use client";

/**
 * Persona's voice. Speaking uses the cloud voice when the server has one
 * (POST /api/persona/speak), and otherwise the browser's speech synthesis
 * with the most natural voice available. Listening is hands-free: the microphone stays open,
 * a recording starts when you speak and ends after a short pause, and each
 * utterance is handed back for transcription. Listening pauses while Persona
 * is thinking or talking, so it doesn't hear itself.
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

let generation = 0;
/** Set once the server says it has no cloud voice (or it keeps failing). */
let cloudOff = false;
let cloudFailures = 0;
let playing: HTMLAudioElement | null = null;
let audioCtx: AudioContext | null = null;

/**
 * Says `text`: in the cloud voice when there is one (styled to the user's
 * tone on the server), else the browser's. `onLevel` gets a
 * 0–1 "mouth" value. Resolves when done or cancelled.
 */
export async function speak(text: string, onLevel: (level: number) => void): Promise<void> {
  const mine = ++generation;
  stopAudio();
  if (canSpeak()) speechSynthesis.cancel();
  if (!cloudOff && (await speakInCloud(text, onLevel, mine))) return;
  if (mine === generation) await speakInBrowser(text, onLevel, mine);
}

async function speakInCloud(
  text: string,
  onLevel: (level: number) => void,
  mine: number,
): Promise<boolean> {
  let res: Response;
  try {
    res = await fetch("/api/persona/speak", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ text: speakable(text).join(" ") }),
    });
  } catch {
    return false;
  }
  if (res.status === 204) {
    cloudOff = true;
    return false;
  }
  if (!res.ok) {
    if (++cloudFailures >= 3) cloudOff = true;
    return false;
  }
  cloudFailures = 0;
  const url = URL.createObjectURL(await res.blob());
  if (mine !== generation) {
    URL.revokeObjectURL(url);
    return true;
  }
  const audio = new Audio(url);
  playing = audio;
  // Drive the mouth from the real audio.
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

/**
 * Says `text` sentence by sentence (long single utterances get cut off in
 * some browsers). `onLevel` gets a 0–1 "mouth" value. Resolves when done or
 * cancelled; never hangs, even where no voice is installed.
 */
async function speakInBrowser(
  text: string,
  onLevel: (level: number) => void,
  mine: number,
): Promise<void> {
  if (!canSpeak()) return;
  for (const sentence of speakable(text)) {
    if (mine !== generation) break;
    await new Promise<void>((resolve) => {
      const u = new SpeechSynthesisUtterance(sentence);
      const voice = pickVoice();
      if (voice) u.voice = voice;
      u.rate = 1.03;
      u.pitch = 1.05;
      let pulse = 0;
      const finish = () => {
        clearInterval(pulse);
        clearTimeout(guard);
        onLevel(0);
        resolve();
      };
      u.onstart = () => {
        pulse = window.setInterval(() => onLevel(0.35 + Math.random() * 0.65), 90);
      };
      u.onboundary = () => onLevel(1);
      u.onend = finish;
      u.onerror = finish;
      // Some browsers never fire events (no voices, or blocked before a click).
      const guard = window.setTimeout(finish, 1200 + sentence.split(/\s+/).length * 450);
      speechSynthesis.speak(u);
    });
  }
  onLevel(0);
}

export function stopSpeaking() {
  generation++;
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
/** Talking over Persona needs a clearly louder voice, held, so its own audio doesn't count. */
const BARGE_LEVEL = 0.22;
const BARGE_HOLD_MS = 280;
const SILENCE_MS = 1100;
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
  const stream = await navigator.mediaDevices.getUserMedia({
    audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
  });
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
  let loudSince = 0;
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
      loudSince = level > BARGE_LEVEL ? loudSince || now : 0;
      if (loudSince && now - loudSince >= BARGE_HOLD_MS) {
        loudSince = 0;
        // Persona takes a moment to fall silent; keep this recording meanwhile.
        bargeUntil = now + 1500;
        handlers.onBargeIn();
        begin();
      }
      return;
    }
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
