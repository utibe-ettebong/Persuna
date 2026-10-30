"use client";

/**
 * Hearing you while you talk: the microphone streams to the transcriber as you
 * speak, so your words are known the moment you stop and no recording has to
 * travel. The recording still runs alongside; if this fails, it's the fallback.
 */

const SAMPLE_RATE = 16_000;
/** Samples per chunk sent, about an eighth of a second. */
const CHUNK_SAMPLES = 2048;
/** How long the final words get after you stop, before the recording is used instead. */
const FINAL_WORDS_MS = 2500;
/** Addresses hold a token that expires after 15 minutes. */
const ADDRESS_LIFE_MS = 14 * 60_000;

export interface LiveHearing {
  /** You've finished: your words, or null if the recording should be used. */
  finish(): Promise<string | null>;
  cancel(): void;
}

/** 32-bit float samples as base64 of 16-bit little-endian PCM, as the transcriber takes them. */
export function pcmBase64(samples: Float32Array): string {
  const bytes = new Uint8Array(samples.length * 2);
  const view = new DataView(bytes.buffer);
  samples.forEach((sample, i) => {
    const clipped = Math.max(-1, Math.min(1, sample));
    view.setInt16(i * 2, clipped < 0 ? clipped * 0x8000 : clipped * 0x7fff, true);
  });
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

/**
 * One utterance over a connection. Audio waits here until the connection is
 * open, so words said while it connects aren't lost.
 */
export function hearingSession(
  socket: Pick<WebSocket, "send" | "close" | "readyState" | "onopen" | "onmessage" | "onclose">,
  onWords: (soFar: string) => void,
  finalWordsMs = FINAL_WORDS_MS,
): { audio(base64: string): void; finish(): Promise<string | null>; cancel(): void } {
  const waiting: string[] = [];
  let finishing = false;
  let settled = false;
  let settle: (words: string | null) => void = () => {};
  const frame = (audio: string, commit: boolean) =>
    JSON.stringify({
      message_type: "input_audio_chunk",
      audio_base_64: audio,
      commit,
      sample_rate: SAMPLE_RATE,
    });
  const commit = () => socket.send(frame("", true));
  const end = (words: string | null) => {
    if (settled) return;
    settled = true;
    socket.close();
    settle(words);
  };
  socket.onopen = () => {
    for (const audio of waiting.splice(0)) socket.send(frame(audio, false));
    if (finishing) commit();
  };
  socket.onmessage = (event) => {
    const message = JSON.parse(event.data as string) as { message_type?: string; text?: string };
    const kind = message.message_type ?? "";
    if (kind === "partial_transcript" && message.text) onWords(message.text);
    else if (kind.startsWith("committed_transcript")) end(message.text?.trim() || null);
    else if (/error/i.test(kind)) end(null);
  };
  socket.onclose = () => end(null);
  return {
    audio(base64) {
      if (finishing || settled) return;
      if (socket.readyState === WebSocket.OPEN) socket.send(frame(base64, false));
      else waiting.push(base64);
    },
    finish() {
      if (settled) return Promise.resolve(null);
      finishing = true;
      if (socket.readyState === WebSocket.OPEN) commit();
      return new Promise((resolve) => {
        const timer = window.setTimeout(() => end(null), finalWordsMs);
        settle = (words) => {
          window.clearTimeout(timer);
          resolve(words);
        };
      });
    },
    cancel: () => end(null),
  };
}

let ready: { url: string; at: number } | null = null;
let fetching: Promise<void> | null = null;
/** Set when this voice has no live hearing, or it keeps failing. */
let hearingOff = false;
let hearingFailures = 0;

/** Fetches the next address ahead of time, so talking doesn't wait for it. Safe to call often. */
export function warmHearing(): Promise<void> {
  if (hearingOff) return Promise.resolve();
  if (ready && Date.now() - ready.at < ADDRESS_LIFE_MS) return Promise.resolve();
  fetching ??= (async () => {
    try {
      const res = await fetch("/api/persuna/hear-token", { method: "POST" });
      if (res.status === 204) hearingOff = true;
      if (res.status !== 200) return;
      const { url } = (await res.json()) as { url: string };
      ready = { url, at: Date.now() };
    } catch {
      // No address: the recording does the job.
    } finally {
      fetching = null;
    }
  })();
  return fetching;
}

/**
 * Starts hearing the microphone. `words` reports what's understood so far.
 * Returns null when live hearing isn't available, and the recording is used.
 */
export function startLiveHearing(
  stream: MediaStream,
  words: (soFar: string) => void,
): LiveHearing | null {
  if (hearingOff) return null;
  let session: ReturnType<typeof hearingSession> | null = null;
  let cancelled = false;
  let listening = true;
  const held: string[] = [];
  let ctx: AudioContext | null = null;
  const stopAudio = () => {
    listening = false;
    void ctx?.close();
    ctx = null;
  };
  try {
    ctx = new AudioContext({ sampleRate: SAMPLE_RATE });
    const source = ctx.createMediaStreamSource(stream);
    // ScriptProcessor hands over samples at once with no module to load, so
    // the first words of a turn aren't lost. Its output stays silent.
    const tap = ctx.createScriptProcessor(CHUNK_SAMPLES, 1, 1);
    tap.onaudioprocess = (event) => {
      if (!listening) return;
      const audio = pcmBase64(event.inputBuffer.getChannelData(0));
      if (session) session.audio(audio);
      else held.push(audio);
    };
    source.connect(tap);
    tap.connect(ctx.destination);
  } catch {
    stopAudio();
    return null;
  }
  const connected = (async () => {
    await warmHearing();
    const address = ready;
    if (!address || cancelled) return false;
    ready = null;
    session = hearingSession(new WebSocket(address.url), words);
    for (const audio of held.splice(0)) session.audio(audio);
    // The next turn's address, ahead of time.
    void warmHearing();
    return true;
  })();
  return {
    async finish() {
      stopAudio();
      if (!(await connected) || !session) return null;
      const said = await session.finish();
      if (said) hearingFailures = 0;
      else if (++hearingFailures >= 3) hearingOff = true;
      return said;
    },
    cancel() {
      cancelled = true;
      stopAudio();
      void connected.then(() => session?.cancel());
    },
  };
}
