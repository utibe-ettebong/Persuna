import { describe, expect, it } from "vitest";
import { parseFirstTask, parseLook, parseName } from "./onboarding";

describe("parseName", () => {
  it("pulls the name out of how people say it", () => {
    expect(parseName("Nova")).toBe("Nova");
    expect(parseName("let's call you nova!")).toBe("Nova");
    expect(parseName("Um, I'd like to call you Ada Lovelace.")).toBe("Ada Lovelace");
    expect(parseName("how about Kemi")).toBe("Kemi");
  });
  it("leaves it to Persona when asked", () => {
    expect(parseName("you choose")).toBeNull();
    expect(parseName("   ")).toBeNull();
  });
});

describe("parseLook", () => {
  it("maps colours and names to looks", () => {
    expect(parseLook("something blue please")).toBe("lagoon");
    expect(parseLook("Aurora")).toBe("aurora");
    expect(parseLook("purple")).toBe("plum");
    expect(parseLook("surprise me")).toBe("plum");
    expect(parseLook("hmm")).toBeNull();
  });
});

describe("parseFirstTask", () => {
  const skills = [{ slug: "meeting-notes", name: "Meeting notes into minutes" }];
  it("finds an existing skill, the sample, or skipping", () => {
    expect(parseFirstTask("the minutes one", skills)).toEqual({
      kind: "existing",
      slug: "meeting-notes",
    });
    expect(parseFirstTask("let's try the sample", [])).toEqual({ kind: "sample" });
    expect(parseFirstTask("later", skills)).toEqual({ kind: "skip" });
  });
  it("names a new task from what they said", () => {
    expect(parseFirstTask("I'd like you to learn writing SEO briefs for clients.", skills)).toEqual(
      {
        kind: "new",
        name: "Writing SEO briefs for clients",
      },
    );
  });
});
