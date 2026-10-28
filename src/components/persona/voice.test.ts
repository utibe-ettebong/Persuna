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
  it("starts with the first sentence alone, so speech begins quickly", () => {
    const chunks = speechChunks(["One.", "Two.", "Three."]);
    expect(chunks[0]).toBe("One.");
    expect(chunks.join(" ")).toBe("One. Two. Three.");
  });

  it("covers a long reply in pieces under the limit, losing nothing", () => {
    const sentences = Array.from(
      { length: 30 },
      (_, i) => `This is sentence number ${i + 1} of a long reply.`,
    );
    const chunks = speechChunks(sentences);
    expect(chunks.length).toBeGreaterThan(2);
    expect(chunks.every((c) => c.length <= CLOUD_CHUNK_CHARS)).toBe(true);
    expect(chunks.join(" ")).toBe(sentences.join(" "));
  });
});
