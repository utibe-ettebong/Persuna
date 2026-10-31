import { readFileSync, writeFileSync } from "node:fs";

/** Minimal PCM WAV reader/writer (mono 16-bit) for the trial measurer. */

export function readWavMono16(path: string): { pcm: Int16Array; sampleRate: number } {
  const bytes = readFileSync(path);
  if (bytes.toString("ascii", 0, 4) !== "RIFF" || bytes.toString("ascii", 8, 12) !== "WAVE") {
    throw new Error(`${path}: not a WAV file`);
  }
  let offset = 12;
  let sampleRate = 0;
  let data: Buffer | null = null;
  while (offset + 8 <= bytes.length) {
    const id = bytes.toString("ascii", offset, offset + 4);
    const size = bytes.readUInt32LE(offset + 4);
    const body = offset + 8;
    if (id === "fmt ") {
      const format = bytes.readUInt16LE(body);
      const channels = bytes.readUInt16LE(body + 2);
      if (format !== 1 || channels !== 1) throw new Error(`${path}: need mono PCM16`);
      sampleRate = bytes.readUInt32LE(body + 4);
    } else if (id === "data") {
      data = bytes.subarray(body, body + size);
    }
    offset = body + size + (size % 2);
  }
  if (!sampleRate || !data) throw new Error(`${path}: missing fmt or data chunk`);
  const pcm = new Int16Array(data.length / 2);
  for (let i = 0; i < pcm.length; i++) pcm[i] = data.readInt16LE(i * 2);
  return { pcm, sampleRate };
}

export function writeWavMono16(path: string, pcm: Int16Array, sampleRate: number) {
  const header = Buffer.alloc(44);
  header.write("RIFF", 0);
  header.writeUInt32LE(36 + pcm.length * 2, 4);
  header.write("WAVE", 8);
  header.write("fmt ", 12);
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20);
  header.writeUInt16LE(1, 22);
  header.writeUInt32LE(sampleRate, 24);
  header.writeUInt32LE(sampleRate * 2, 28);
  header.writeUInt16LE(2, 32);
  header.writeUInt16LE(16, 34);
  header.write("data", 36);
  header.writeUInt32LE(pcm.length * 2, 40);
  const body = Buffer.alloc(pcm.length * 2);
  for (let i = 0; i < pcm.length; i++) body.writeInt16LE(pcm[i]!, i * 2);
  writeFileSync(path, Buffer.concat([header, body]));
}

/** RMS of int16 samples: speech sits far above comfort noise. */
export function rms(samples: Int16Array): number {
  if (samples.length === 0) return 0;
  let sum = 0;
  for (let i = 0; i < samples.length; i++) sum += samples[i]! * samples[i]!;
  return Math.sqrt(sum / samples.length);
}
