"use client";

/**
 * Persona's voice. Speaking uses the browser's speech synthesis with the most
 * natural voice available. Listening is hands-free: the microphone stays open,
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

/**
 * Says `text` sentence by sentence (long single utterances get cut off in
 * some browsers). `onLevel` gets a 0–1 "mouth" value. Resolves when done or
 * cancelled; never hangs, even where no voice is installed.
 */
export async function speak(text: string, onLevel: (level: number) => void): Promise<void> {
  if (!canSpeak()) return;
  const mine = ++generation;
  speechSynthesis.cancel();
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
  if (canSpeak()) speechSynthesis.cancel();
}

/* ---------- Hands-free listening ---------- */

export interface Conversation {
  stop(): void;
}

const START_LEVEL = 0.08;
const SILENCE_MS = 1100;
const MIN_SPEECH_MS = 350;
const MAX_UTTERANCE_MS = 30_000;

export async function startConversation(handlers: {
  /** 0–1 loudness, about 30 times a second. */
  onLevel: (level: number) => void;
  /** A finished utterance (the browser's recording format). */
  onUtterance: (audio: Blob) => void;
  /** True while Persona is thinking or talking: don't record then. */
  paused: () => boolean;
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
  let stopped = false;

  const begin = () => {
    chunks = [];
    recorder = new MediaRecorder(stream);
    recorder.ondataavailable = (e) => e.data.size && chunks.push(e.data);
    const rec = recorder;
    rec.onstop = () => {
      const long = performance.now() - speechStart - SILENCE_MS >= MIN_SPEECH_MS;
      if (!stopped && long && chunks.length) {
        handlers.onUtterance(new Blob(chunks, { type: rec.mimeType || "audio/webm" }));
      }
    };
    recorder.start(200);
    speechStart = performance.now();
  };
  const end = () => {
    if (recorder && recorder.state !== "inactive") recorder.stop();
    recorder = null;
  };

  const timer = window.setInterval(() => {
    analyser.getFloatTimeDomainData(data);
    let sum = 0;
    for (const v of data) sum += v * v;
    const level = Math.min(1, Math.sqrt(sum / data.length) * 6);
    const now = performance.now();
    if (handlers.paused()) {
      handlers.onLevel(0);
      if (recorder) {
        stopped = true; // drop a half-said utterance cut off by Persona talking
        end();
        stopped = false;
      }
      return;
    }
    handlers.onLevel(level);
    if (level > START_LEVEL) {
      lastLoud = now;
      if (!recorder) begin();
    }
    if (recorder && (now - lastLoud > SILENCE_MS || now - speechStart > MAX_UTTERANCE_MS)) end();
  }, 33);

  return {
    stop() {
      stopped = true;
      clearInterval(timer);
      end();
      stream.getTracks().forEach((t) => t.stop());
      void ctx.close();
      handlers.onLevel(0);
    },
  };
}
