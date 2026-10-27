import { crc32, deflateSync } from "node:zlib";
import { encodeWav } from "@/lib/audio/wav";

/** A solid-colour PNG, for checking that a model can see images. */
export function solidPng(size: number, [r, g, b]: [number, number, number]): Buffer {
  const chunk = (type: string, data: Buffer) => {
    const head = Buffer.alloc(8);
    head.writeUInt32BE(data.length, 0);
    head.write(type, 4, "ascii");
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(crc32(Buffer.concat([Buffer.from(type, "ascii"), data])) >>> 0, 0);
    return Buffer.concat([head, data, crc]);
  };
  const header = Buffer.alloc(13);
  header.writeUInt32BE(size, 0);
  header.writeUInt32BE(size, 4);
  header.writeUInt8(8, 8); // bit depth
  header.writeUInt8(2, 9); // RGB
  const row = Buffer.concat([Buffer.from([0]), Buffer.from(Array(size).fill([r, g, b]).flat())]);
  const pixels = Buffer.concat(Array(size).fill(row));
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", header),
    chunk("IDAT", deflateSync(pixels)),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

/** One second of a quiet 440 Hz tone as 16 kHz mono WAV, for checking transcription. */
export function toneWav(): Blob {
  const samples = new Float32Array(16_000).map(
    (_, i) => 0.2 * Math.sin((2 * Math.PI * 440 * i) / 16_000),
  );
  return new Blob([encodeWav(samples, 16_000)], { type: "audio/wav" });
}
