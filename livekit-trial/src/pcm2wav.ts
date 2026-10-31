/** Wrap raw s16le mono PCM as a 48kHz WAV (naive upsample when needed). */
import { readFileSync } from "node:fs";
import { writeWavMono16 } from "./wav.js";

const [input, output, rateArg] = process.argv.slice(2);
if (!input || !output || !rateArg) throw new Error("usage: pcm2wav <in.pcm> <out.wav> <rate>");
const rate = Number(rateArg);
const raw = readFileSync(input);
const pcm = new Int16Array(raw.length / 2);
for (let i = 0; i < pcm.length; i++) pcm[i] = raw.readInt16LE(i * 2);
const factor = 48000 / rate;
if (!Number.isInteger(factor)) throw new Error(`pcm2wav: rate ${rate} doesn't divide 48000`);
const upsampled = new Int16Array(pcm.length * factor);
for (let i = 0; i < pcm.length; i++) {
  for (let k = 0; k < factor; k++) upsampled[i * factor + k] = pcm[i]!;
}
writeWavMono16(output, upsampled, 48000);
console.log(`${output}: ${(upsampled.length / 48000).toFixed(1)}s`);
