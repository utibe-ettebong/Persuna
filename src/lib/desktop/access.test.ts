import { describe, expect, it } from "vitest";
import { accessContinues } from "./access";

describe("accessContinues", () => {
  it("lets a Mac continue with microphone and Accessibility, screen optional", () => {
    expect(accessContinues(true, { mic: "granted", keyboard: "granted", screen: "denied" })).toBe(
      true,
    );
    expect(accessContinues(true, { mic: "granted", keyboard: "granted" })).toBe(true);
    expect(accessContinues(true, { mic: "denied", keyboard: "granted" })).toBe(false);
    expect(accessContinues(true, { mic: "granted", keyboard: "denied" })).toBe(false);
  });

  it("holds Windows setup until the microphone, talk key and screen all work", () => {
    const all = { mic: "granted", keyboard: "granted", screen: "granted" } as const;
    expect(accessContinues(false, all)).toBe(true);
    // Setup used to call itself ready here: mic alone let Windows through.
    expect(accessContinues(false, { ...all, screen: "denied" })).toBe(false);
    expect(accessContinues(false, { ...all, keyboard: "denied" })).toBe(false);
    expect(accessContinues(false, { ...all, mic: "denied" })).toBe(false);
  });

  it("holds while anything is still unknown", () => {
    expect(accessContinues(false, {})).toBe(false);
    expect(accessContinues(true, { mic: "granted" })).toBe(false);
    expect(accessContinues(false, { mic: "granted", keyboard: "granted", screen: "unknown" })).toBe(
      false,
    );
  });
});
