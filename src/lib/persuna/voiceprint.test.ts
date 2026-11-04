import { describe, expect, it } from "vitest";
import {
  PRINT_RATE,
  fingerprint,
  handsFreeListener,
  matchVoiceprint,
  similarity,
} from "./voiceprint";

/** Recordings are decoded at this rate before they're printed. */
const RATE = PRINT_RATE;
/** A few seconds of a harmonic tone: a stand-in voice with a pitch. */
const voice = (pitch: number, seconds = 3) => {
  const n = Math.floor(RATE * seconds);
  const out = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const t = i / RATE;
    out[i] =
      0.3 * Math.sin(2 * Math.PI * pitch * t) +
      0.15 * Math.sin(2 * Math.PI * pitch * 2 * t) +
      0.07 * Math.sin(2 * Math.PI * pitch * 3 * t);
  }
  return out;
};

describe("fingerprint", () => {
  it("reads the same voice the same way twice", () => {
    const a = fingerprint(voice(140), RATE);
    const b = fingerprint(voice(140), RATE);
    expect(a && b && similarity(a.mean, b.mean)).toBeGreaterThan(0.99);
  });

  it("reads each voice's pitch", () => {
    expect(fingerprint(voice(140), RATE)?.pitch).toBeCloseTo(140, 0);
    expect(fingerprint(voice(260), RATE)?.pitch).toBeCloseTo(260, 0);
  });

  it("finds nothing to keep in silence", () => {
    expect(fingerprint(new Float32Array(RATE * 2), RATE)).toBeNull();
    expect(fingerprint(new Float32Array(100), RATE)).toBeNull();
  });
});

describe("matchVoiceprint", () => {
  it("accepts the enrolled voice and refuses a different pitch", () => {
    const owner = fingerprint(voice(140), RATE)!;
    const same = fingerprint(voice(140), RATE)!;
    const other = fingerprint(voice(260), RATE)!;
    const near = fingerprint(voice(180), RATE)!;
    expect(matchVoiceprint(same, owner).match).toBe(true);
    expect(matchVoiceprint(other, owner).match).toBe(false);
    expect(matchVoiceprint(near, owner).match).toBe(false);
    expect(matchVoiceprint(same, owner).score).toBeGreaterThan(matchVoiceprint(other, owner).score);
  });
});

describe("handsFreeListener", () => {
  const ready = { agentMode: true, agentReady: true, setupDone: true, ownerOnly: false };

  it("uses the agent when it's set up and any voice may talk", () => {
    expect(handsFreeListener(ready)).toBe("agent");
  });

  it("listens on the page when only the owner's voice may talk, so each utterance is checked", () => {
    expect(handsFreeListener({ ...ready, ownerOnly: true })).toBe("page");
  });

  it("listens on the page when the agent isn't available", () => {
    expect(handsFreeListener({ ...ready, agentReady: false })).toBe("page");
    expect(handsFreeListener({ ...ready, agentMode: false })).toBe("page");
    expect(handsFreeListener({ ...ready, setupDone: false })).toBe("page");
  });
});
