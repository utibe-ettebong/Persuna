import { describe, expect, it } from "vitest";
import {
  NARRATION_HOLD,
  SPEECH_CPS,
  initialNarration,
  narrationProgress,
  shownSteps,
} from "./narration";

describe("narration pacing", () => {
  it("starts from what's already spoken over the whole reply", () => {
    expect(initialNarration(0, 300)).toBe(0);
    expect(initialNarration(150, 300)).toBe(0.5);
    expect(initialNarration(300, 300)).toBe(1);
  });

  it("clamps a confused count instead of jumping the drawing", () => {
    expect(initialNarration(-20, 300)).toBe(0);
    expect(initialNarration(400, 300)).toBe(1);
    expect(initialNarration(0, 0)).toBe(1);
  });

  it("creeps with the voice, about fifteen chars a second", () => {
    const total = SPEECH_CPS * 10;
    expect(narrationProgress(0, 0, total)).toBe(0);
    expect(narrationProgress(5000, 0, total)).toBeCloseTo(0.5, 5);
    expect(narrationProgress(2000, SPEECH_CPS * 4, total)).toBeCloseTo(0.6, 5);
  });

  it("holds the last step until speech really ends", () => {
    expect(narrationProgress(60_000, 0, 100)).toBe(NARRATION_HOLD);
    expect(narrationProgress(-1000, 10, 100)).toBeCloseTo(0.1, 5);
    expect(narrationProgress(0, 0, 0)).toBe(1);
  });
});

describe("shown steps", () => {
  it("shows the first step straight away and all of them at the end", () => {
    expect(shownSteps(0, 4)).toBe(1);
    expect(shownSteps(0.26, 4)).toBe(2);
    expect(shownSteps(0.99, 4)).toBe(4);
    expect(shownSteps(1, 4)).toBe(4);
  });

  it("never shows none of a drawing, nor more than it has", () => {
    expect(shownSteps(-1, 3)).toBe(1);
    expect(shownSteps(2, 3)).toBe(3);
    expect(shownSteps(0.5, 0)).toBe(0);
  });
});
