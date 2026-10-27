/**
 * Mono 16-bit PCM WAV: the format Meta's Muse Voice Transcribe accepts
 * (16 or 24 kHz). Pure functions, so they run in the browser (to convert
 * recordings before upload) and on the server (to check uploads).
 */
export const TARGET_SAMPLE_RATE = 16_000;
export const MAX_AUDIO_SECONDS = 600; // Meta's limit per request

export function encodeWav(samples: Float32Array, sampleRate: number): ArrayBuffer {
  const dataBytes = samples.length * 2;
  const buffer = new ArrayBuffer(44 + dataBytes);
  const view = new DataView(buffer);
  const ascii = (offset: number, text: string) =>
    [...text].forEach((c, i) => view.setUint8(offset + i, c.charCodeAt(0)));

  ascii(0, "RIFF");
  view.setUint32(4, 36 + dataBytes, true);
  ascii(8, "WAVE");
  ascii(12, "fmt ");
  view.setUint32(16, 16, true); // fmt chunk size
  view.setUint16(20, 1, true); // PCM
  view.setUint16(22, 1, true); // mono
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true); // byte rate
  view.setUint16(32, 2, true); // block align
  view.setUint16(34, 16, true); // bits per sample
  ascii(36, "data");
  view.setUint32(40, dataBytes, true);

  for (let i = 0; i < samples.length; i++) {
    const s = Math.max(-1, Math.min(1, samples[i]));
    view.setInt16(44 + i * 2, s < 0 ? s * 0x8000 : s * 0x7fff, true);
  }
  return buffer;
}

export interface WavInfo {
  channels: number;
  sampleRate: number;
  bitsPerSample: number;
  format: number;
  seconds: number;
}

/** Reads a WAV header, or returns null when the bytes aren't a RIFF/WAVE file. */
export function parseWav(buffer: ArrayBuffer): WavInfo | null {
  if (buffer.byteLength < 44) return null;
  const view = new DataView(buffer);
  const tag = (offset: number) =>
    String.fromCharCode(...new Uint8Array(buffer.slice(offset, offset + 4)));
  if (tag(0) !== "RIFF" || tag(8) !== "WAVE") return null;

  let offset = 12;
  let info: Omit<WavInfo, "seconds"> | null = null;
  while (offset + 8 <= buffer.byteLength) {
    const id = tag(offset);
    const size = view.getUint32(offset + 4, true);
    if (id === "fmt ") {
      info = {
        format: view.getUint16(offset + 8, true),
        channels: view.getUint16(offset + 10, true),
        sampleRate: view.getUint32(offset + 12, true),
        bitsPerSample: view.getUint16(offset + 22, true),
      };
    } else if (id === "data" && info) {
      const bytesPerSecond = info.sampleRate * info.channels * (info.bitsPerSample / 8);
      return { ...info, seconds: bytesPerSecond ? size / bytesPerSecond : 0 };
    }
    offset += 8 + size + (size % 2);
  }
  return null;
}

/** Why a WAV can't go to Meta's transcription API, or null when it can. */
export function metaWavProblem(info: WavInfo | null): string | null {
  if (!info)
    return "The recording isn't a WAV file. Record again, or re-upload it here so it's converted.";
  if (info.format !== 1 || info.bitsPerSample !== 16) return "The WAV must be 16-bit PCM.";
  if (info.channels !== 1) return "The WAV must be mono.";
  if (info.sampleRate !== 16_000 && info.sampleRate !== 24_000)
    return "The WAV must be 16 or 24 kHz.";
  if (info.seconds > MAX_AUDIO_SECONDS) return "Recordings must be 10 minutes or shorter.";
  return null;
}
