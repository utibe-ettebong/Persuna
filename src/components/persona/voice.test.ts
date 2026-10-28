import { describe, expect, it } from "vitest";
import { CLOUD_CHUNK_CHARS, speakable, speechChunks } from "./voice";

describe("speakable", () => {
  it("keeps every sentence, without markdown, links or emoji", () => {
    expect(
      speakable(
        "Here's **your** wrap-up 🎉.\n\n• chase the venue quote\nSee https://x.org now! Done?",
      ),
    ).toEqual(["Here's your wrap-up .", "chase the venue quote See now!", "Done?"]);
  });
});

describe("speechChunks", () => {
  it("says a normal reply in one piece, so there are no gaps", () => {
    expect(speechChunks(["One.", "Two.", "Three."])).toEqual(["One. Two. Three."]);
  });

  it("splits only very long replies, at sentence ends, losing nothing", () => {
    const sentences = Array.from(
      { length: 60 },
      (_, i) => `This is sentence number ${i + 1} of a very long reply.`,
    );
    const chunks = speechChunks(sentences);
    expect(chunks.length).toBeGreaterThan(1);
    expect(chunks.every((c) => c.length <= CLOUD_CHUNK_CHARS)).toBe(true);
    expect(chunks.join(" ")).toBe(sentences.join(" "));
  });
});
