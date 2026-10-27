import { describe, expect, it } from "vitest";
import { encodeWav, metaWavProblem, parseWav } from "./wav";

describe("WAV encoding", () => {
  it("writes mono 16-bit PCM that reads back with the right header", () => {
    const samples = new Float32Array(16_000).map((_, i) => Math.sin(i / 10));
    const buffer = encodeWav(samples, 16_000);
    expect(buffer.byteLength).toBe(44 + 32_000);
    const info = parseWav(buffer)!;
    expect(info).toMatchObject({ channels: 1, sampleRate: 16_000, bitsPerSample: 16, format: 1 });
    expect(info.seconds).toBeCloseTo(1, 5);
    expect(metaWavProblem(info)).toBeNull();
  });

  it("clamps samples outside -1..1", () => {
    const view = new DataView(encodeWav(new Float32Array([2, -2]), 16_000));
    expect(view.getInt16(44, true)).toBe(0x7fff);
    expect(view.getInt16(46, true)).toBe(-0x8000);
  });

  it("rejects non-WAV bytes and formats Meta won't take", () => {
    expect(
      parseWav(new TextEncoder().encode("not audio at all, definitely not riff").buffer),
    ).toBeNull();
    expect(metaWavProblem(null)).toMatch(/isn't a WAV/);
    const base = { format: 1, channels: 1, sampleRate: 16_000, bitsPerSample: 16, seconds: 5 };
    expect(metaWavProblem({ ...base, channels: 2 })).toMatch(/mono/);
    expect(metaWavProblem({ ...base, sampleRate: 44_100 })).toMatch(/16 or 24 kHz/);
    expect(metaWavProblem({ ...base, seconds: 601 })).toMatch(/10 minutes/);
    expect(metaWavProblem({ ...base, sampleRate: 24_000 })).toBeNull();
  });
});
