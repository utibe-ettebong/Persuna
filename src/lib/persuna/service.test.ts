import { describe, expect, it } from "vitest";
import { MAX_MEMORY, observe, withFact } from "./service";

describe("withFact", () => {
  it("adds a fact unless it's already kept", () => {
    expect(withFact([], "likes 24h times")).toEqual(["likes 24h times"]);
    expect(withFact(["likes 24h times"], "Likes 24H Times")).toEqual(["likes 24h times"]);
    expect(withFact(["a"], "b")).toEqual(["a", "b"]);
  });

  it("keeps only the latest memory", () => {
    const full = Array.from({ length: MAX_MEMORY }, (_, i) => `fact ${i}`);
    const next = withFact(full, "newest");
    expect(next).toHaveLength(MAX_MEMORY);
    expect(next.at(-1)).toBe("newest");
    expect(next).not.toContain("fact 0");
  });
});

describe("observe", () => {
  it("refuses frames outside Work mode", async () => {
    await expect(
      observe({} as never, "user-1", {
        frame: "data:image/jpeg;base64,AAAA",
        noteId: null,
        mode: "talk",
      }),
    ).rejects.toThrow("Work mode");
    await expect(
      observe({} as never, "user-1", {
        frame: "data:image/jpeg;base64,AAAA",
        noteId: null,
        mode: "look",
      }),
    ).rejects.toThrow("Work mode");
  });
});
