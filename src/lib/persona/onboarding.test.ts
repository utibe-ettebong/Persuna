import { describe, expect, it } from "vitest";
import {
  describeSkill,
  freeSlug,
  introFacts,
  parseFirstTask,
  parseLook,
  parseName,
  suggestedSkill,
} from "./onboarding";

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

describe("getting to know you", () => {
  it("keeps the answers as facts in the user's words, skipping blanks", () => {
    expect(
      introFacts({ work: "I run   a design studio", current: "", timeSink: "Client proposals" }),
    ).toEqual(["Work: I run a design studio", "Takes the most time: Client proposals"]);
    expect(introFacts({ work: "x".repeat(400) })[0].length).toBeLessThanOrEqual(166);
  });

  it("suggests a first skill from what takes the most time", () => {
    expect(suggestedSkill("Writing client proposals, honestly")).toBe("Writing client proposals");
    expect(suggestedSkill("um, probably meeting minutes and follow-ups")).toBe("Meeting minutes");
    expect(suggestedSkill("Emails")).toBeNull();
    expect(suggestedSkill(undefined)).toBeNull();
  });
});

describe("picking several skills at setup", () => {
  it("describes common and custom skills", () => {
    expect(describeSkill("email replies")).toMatch(/reply in my voice/);
    expect(describeSkill("Podcast show notes")).toBe("Podcast show notes, done the way I do it.");
  });

  it("finds a free slug", () => {
    expect(freeSlug("minutes", new Set())).toBe("minutes");
    expect(freeSlug("minutes", new Set(["minutes", "minutes-2"]))).toBe("minutes-3");
  });
});
