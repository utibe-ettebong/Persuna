import { describe, expect, it } from "vitest";
import { appendInterviewAnswer, type InterviewAnswers } from "./interview";

describe("appendInterviewAnswer", () => {
  it("keeps answers to several questions gathered in one turn", () => {
    let answers: InterviewAnswers = { tone: "formal" };
    answers = appendInterviewAnswer(answers, "steps", "I read the notes first");
    answers = appendInterviewAnswer(answers, "tone", "third person, past tense");
    answers = appendInterviewAnswer(answers, "handoff", "I send the PDF to the chair");
    expect(answers).toEqual({
      tone: "formal\n\nthird person, past tense",
      steps: "I read the notes first",
      handoff: "I send the PDF to the chair",
    });
  });

  it("ignores an empty addition instead of wiping the answer", () => {
    expect(appendInterviewAnswer({ steps: "kept" }, "steps", "")).toEqual({ steps: "kept" });
  });
});
