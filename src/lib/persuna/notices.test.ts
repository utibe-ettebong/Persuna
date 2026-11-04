import { describe, expect, it } from "vitest";
import { MAX_QUEUED_NOTICES, queueNotice, shouldSpeakNotice } from "./notices";

const idle = {
  quiet: false,
  talking: false,
  speaking: false,
  busy: false,
  userSpeaking: false,
  holding: false,
};

describe("shouldSpeakNotice", () => {
  it("speaks when idle, never over speech, thought, or listening", () => {
    expect(shouldSpeakNotice(idle)).toBe(true);
    for (const state of [
      { ...idle, quiet: true },
      { ...idle, talking: true },
      { ...idle, speaking: true },
      { ...idle, busy: true },
      { ...idle, userSpeaking: true },
      { ...idle, holding: true },
    ]) {
      expect(shouldSpeakNotice(state)).toBe(false);
    }
  });
});

describe("queueNotice", () => {
  it("holds lines for the next idle moment, oldest dropped past the cap", () => {
    let queue: string[] = [];
    for (let i = 1; i <= MAX_QUEUED_NOTICES + 2; i++) {
      queue = queueNotice(queue, `Notice ${i}`);
    }
    expect(queue).toHaveLength(MAX_QUEUED_NOTICES);
    expect(queue[0]).toBe("Notice 3");
  });
});
