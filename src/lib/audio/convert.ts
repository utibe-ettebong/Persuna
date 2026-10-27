"use client";

import { encodeWav, TARGET_SAMPLE_RATE } from "./wav";

/**
 * Converts any audio the browser can decode (webm, ogg, m4a, mp3, wav) into
 * a 16 kHz mono 16-bit WAV file, entirely in the browser.
 */
export async function toTranscribableWav(input: Blob, name = "recording"): Promise<File> {
  const AudioCtx =
    window.AudioContext ??
    (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
  const context = new AudioCtx();
  try {
    const decoded = await context.decodeAudioData(await input.arrayBuffer());
    const frames = Math.max(1, Math.ceil(decoded.duration * TARGET_SAMPLE_RATE));
    const offline = new OfflineAudioContext(1, frames, TARGET_SAMPLE_RATE);
    const source = offline.createBufferSource();
    source.buffer = decoded; // the offline context downmixes to mono and resamples
    source.connect(offline.destination);
    source.start();
    const rendered = await offline.startRendering();
    const wav = encodeWav(rendered.getChannelData(0), TARGET_SAMPLE_RATE);
    return new File([wav], `${name.replace(/\.[a-z0-9]+$/i, "")}.wav`, { type: "audio/wav" });
  } finally {
    await context.close();
  }
}
