import { describe, expect, it } from "vitest";
import { wantsSight } from "./sight-gate";

describe("wantsSight", () => {
  it("sends the screen for questions about what's on it", () => {
    for (const text of [
      "What is this error?",
      "What's that button?",
      "Where's the save button?",
      "Show me how to export",
      "Look at my screen and tell me what's wrong",
      "Read this page back to me",
      "Explain this form",
      "Why is this page blank?",
      "Summarize this page",
      "Point to the settings icon",
    ]) {
      expect(wantsSight(text), text).toBe(true);
    }
  });

  it("skips the capture for plain chat", () => {
    for (const text of [
      "Remind me to call Ada at 4",
      "Draft an email to the team about Friday",
      "What's my focus today?",
      "What is this week looking like?",
      "Tell me a joke",
      "Teach me how you do it",
      "Add a todo: book flights",
      "What did we work on yesterday?",
    ]) {
      expect(wantsSight(text), text).toBe(false);
    }
  });
});
