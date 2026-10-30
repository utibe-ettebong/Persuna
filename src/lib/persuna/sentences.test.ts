import { describe, expect, it } from "vitest";
import { createSentenceSplitter, splitSentences } from "./sentences";

describe("splitSentences", () => {
  it("splits on end punctuation", () => {
    expect(splitSentences("Hello there. How are you? Fine!")).toEqual([
      "Hello there.",
      "How are you?",
      "Fine!",
    ]);
  });

  it("keeps decimals, abbreviations and initials together", () => {
    expect(splitSentences("I scored 85.5 out of 100. Mr. Smith met Dr. Jones.")).toEqual([
      "I scored 85.5 out of 100.",
      "Mr. Smith met Dr. Jones.",
    ]);
    expect(splitSentences("As e.g. Smith showed, it works.")).toEqual([
      "As e.g. Smith showed, it works.",
    ]);
  });

  it("splits paragraphs and quoted starts", () => {
    expect(splitSentences('First thought.\n\nSecond thought.\n"He said so." Yes.')).toEqual([
      "First thought.",
      "Second thought.",
      '"He said so."',
      "Yes.",
    ]);
  });

  it("says nothing for blank text", () => {
    expect(splitSentences("  \n ")).toEqual([]);
  });

  it("keeps list numbers with their items", () => {
    expect(splitSentences("Three steps. 1. Export it. 2. Pick a format.")).toEqual([
      "Three steps.",
      "1. Export it.",
      "2. Pick a format.",
    ]);
  });
});

describe("createSentenceSplitter", () => {
  it("emits completed sentences across pushes and flushes the tail", () => {
    const splitter = createSentenceSplitter();
    expect(splitter.push("Hello the")).toEqual([]);
    expect(splitter.push("re. How are")).toEqual(["Hello there."]);
    expect(splitter.push(" you?")).toEqual([]);
    expect(splitter.finish()).toEqual(["How are you?"]);
  });

  it("matches whole-text splitting when fed a character at a time", () => {
    const text = "I scored 85.5! Mr. Smith agreed. Done.";
    const splitter = createSentenceSplitter();
    const out = text.split("").flatMap((c) => splitter.push(c));
    expect([...out, ...splitter.finish()]).toEqual(splitSentences(text));
  });

  it("holds an abbreviation across the chunk edge", () => {
    const splitter = createSentenceSplitter();
    expect(splitter.push("Meet Dr")).toEqual([]);
    expect(splitter.push(". Jones today. Bye.")).toEqual(["Meet Dr. Jones today."]);
    expect(splitter.finish()).toEqual(["Bye."]);
  });
});
