import { describe, expect, it } from "vitest";
import { dotLine, islandQuiet, talkStatus } from "./dot-talk";

describe("islandQuiet", () => {
  it("quiets the island only once setup is done and Work mode is on", () => {
    expect(islandQuiet(true, true)).toBe(true);
    expect(islandQuiet(true, false)).toBe(false);
    expect(islandQuiet(false, true)).toBe(false);
  });
});

describe("talkStatus", () => {
  it("names each talk phase for the dot", () => {
    expect(talkStatus(true, "idle")).toBe("Listening…");
    expect(talkStatus(false, "hearing")).toBe("Hearing you…");
    expect(talkStatus(false, "thinking")).toBe("Thinking…");
    expect(talkStatus(false, "idle")).toBe(null);
  });

  it("prefers listening over thinking when both are true", () => {
    expect(talkStatus(true, "thinking")).toBe("Listening…");
  });
});

describe("dotLine", () => {
  it("off Work mode, the dot only shows Work mode's own messages", () => {
    expect(
      dotLine({ quiet: false, status: "Listening…", talk: "a reply", bubble: "a nudge" }),
    ).toBe("a nudge");
  });

  it("prefers the live status, then the reply, then the nudge", () => {
    expect(dotLine({ quiet: true, status: "Listening…", talk: "a reply", bubble: "a nudge" })).toBe(
      "Listening…",
    );
    expect(dotLine({ quiet: true, status: null, talk: "a reply", bubble: "a nudge" })).toBe(
      "a reply",
    );
    expect(dotLine({ quiet: true, status: null, talk: null, bubble: "a nudge" })).toBe("a nudge");
    expect(dotLine({ quiet: true, status: null, talk: null, bubble: null })).toBe(null);
  });
});
