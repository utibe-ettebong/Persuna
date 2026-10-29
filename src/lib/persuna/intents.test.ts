import { describe, expect, it } from "vitest";
import { parseFastIntent } from "./intents";

// Fixed "now": Thursday 15 Jan 2026, 10:00 local time.
const NOW = new Date(2026, 0, 15, 10, 0, 0);

describe("reminders", () => {
  it("reads 'remind me to X at 4' with the bare-hour rule", () => {
    // At 10:00, 4am has passed but 4pm is ahead, so it means 16:00 today.
    expect(parseFastIntent("remind me to call Sam at 4", NOW)).toEqual({
      kind: "reminder",
      text: "call Sam",
      due: new Date(2026, 0, 15, 16, 0),
    });
  });

  it("reads 'remind me at 4:30pm to X'", () => {
    expect(parseFastIntent("remind me at 4:30pm to call Sam", NOW)).toEqual({
      kind: "reminder",
      text: "call Sam",
      due: new Date(2026, 0, 15, 16, 30),
    });
  });

  it("reads 'remind me X tomorrow at 9' as AM tomorrow", () => {
    expect(parseFastIntent("remind me call Sam tomorrow at 9", NOW)).toEqual({
      kind: "reminder",
      text: "call Sam",
      due: new Date(2026, 0, 16, 9, 0),
    });
  });

  it("reads 'remind me in 20 minutes to X'", () => {
    expect(parseFastIntent("remind me in 20 minutes to call Sam", NOW)).toEqual({
      kind: "reminder",
      text: "call Sam",
      due: new Date(2026, 0, 15, 10, 20),
    });
  });

  it("reads 'remind me X in 2 hours'", () => {
    expect(parseFastIntent("remind me call Sam in 2 hours", NOW)).toEqual({
      kind: "reminder",
      text: "call Sam",
      due: new Date(2026, 0, 15, 12, 0),
    });
  });

  it("reads 'reminder: X at 6pm'", () => {
    expect(parseFastIntent("reminder: call Sam at 6pm", NOW)).toEqual({
      kind: "reminder",
      text: "call Sam",
      due: new Date(2026, 0, 15, 18, 0),
    });
  });

  it("honours explicit am, and rolls a passed explicit time to tomorrow", () => {
    expect(parseFastIntent("remind me to call Sam at 11am", NOW)).toEqual({
      kind: "reminder",
      text: "call Sam",
      due: new Date(2026, 0, 15, 11, 0),
    });
    expect(parseFastIntent("remind me to call Sam at 9am", NOW)).toEqual({
      kind: "reminder",
      text: "call Sam",
      due: new Date(2026, 0, 16, 9, 0),
    });
  });

  it("applies the bare-hour rule: AM if ahead, else PM if ahead, else AM tomorrow", () => {
    // AM still ahead today.
    expect(parseFastIntent("remind me to call Sam at 11", NOW)).toEqual({
      kind: "reminder",
      text: "call Sam",
      due: new Date(2026, 0, 15, 11, 0),
    });
    // AM passed, PM ahead (also covered above), and PM also passed.
    const evening = new Date(2026, 0, 15, 17, 30);
    expect(parseFastIntent("remind me to call Sam at 4", evening)).toEqual({
      kind: "reminder",
      text: "call Sam",
      due: new Date(2026, 0, 16, 4, 0),
    });
  });

  it("reads bare 13-23 as a 24-hour time", () => {
    expect(parseFastIntent("remind me to call Sam at 14", NOW)).toEqual({
      kind: "reminder",
      text: "call Sam",
      due: new Date(2026, 0, 15, 14, 0),
    });
    expect(parseFastIntent("remind me to call Sam at 14:05", NOW)).toEqual({
      kind: "reminder",
      text: "call Sam",
      due: new Date(2026, 0, 15, 14, 5),
    });
  });

  it("needs an explicit time and some text", () => {
    expect(parseFastIntent("remind me to tell you about the report", NOW)).toBeNull();
    expect(parseFastIntent("remind me at 4", NOW)).toBeNull();
    expect(parseFastIntent("remind me to call Sam tomorrow", NOW)).toBeNull();
  });
});

describe("notes and todos", () => {
  it("reads 'todo: X' with the first sentence as the title", () => {
    expect(parseFastIntent("todo: Buy milk. Also get eggs", NOW)).toEqual({
      kind: "note",
      title: "Buy milk",
      body: "Buy milk. Also get eggs",
    });
  });

  it("reads note and add-a-todo lead-ins", () => {
    expect(parseFastIntent("note: Call the plumber", NOW)).toEqual({
      kind: "note",
      title: "Call the plumber",
      body: "Call the plumber",
    });
    expect(parseFastIntent("add a todo: Water the plants", NOW)).toEqual({
      kind: "note",
      title: "Water the plants",
      body: "Water the plants",
    });
    expect(parseFastIntent("add a note: The gate code is 1234", NOW)).toEqual({
      kind: "note",
      title: "The gate code is 1234",
      body: "The gate code is 1234",
    });
    expect(parseFastIntent("to-do: File the receipts", NOW)?.kind).toBe("note");
    expect(parseFastIntent("add todo File the receipts", NOW)).toEqual({
      kind: "note",
      title: "File the receipts",
      body: "File the receipts",
    });
  });

  it("caps the title at 60 characters and rejects an empty body", () => {
    const body = "a".repeat(80);
    expect(parseFastIntent(`note: ${body}`, NOW)).toEqual({
      kind: "note",
      title: "a".repeat(60),
      body,
    });
    expect(parseFastIntent("todo:   ", NOW)).toBeNull();
    expect(parseFastIntent("note:", NOW)).toBeNull();
  });
});

describe("copy", () => {
  it("reads the bare copy phrases, any case, optional trailing period", () => {
    expect(parseFastIntent("copy that", NOW)).toEqual({ kind: "copy" });
    expect(parseFastIntent("Copy it.", NOW)).toEqual({ kind: "copy" });
    expect(parseFastIntent("copy your last reply", NOW)).toEqual({ kind: "copy" });
    expect(parseFastIntent("copy your reply", NOW)).toEqual({ kind: "copy" });
    expect(parseFastIntent("  copy   this  ", NOW)).toEqual({ kind: "copy" });
  });

  it("does not treat copying something else as the copy intent", () => {
    expect(parseFastIntent("copy that report into the folder", NOW)).toBeNull();
  });
});

describe("anything else falls through to chat", () => {
  it("returns null for questions, teaching, and chat", () => {
    expect(parseFastIntent("what's a good reminder app?", NOW)).toBeNull();
    expect(parseFastIntent("I always file expenses on Fridays", NOW)).toBeNull();
    expect(parseFastIntent("explain how reminders work", NOW)).toBeNull();
    expect(parseFastIntent("what time is it?", NOW)).toBeNull();
    expect(parseFastIntent("", NOW)).toBeNull();
    expect(parseFastIntent("   ", NOW)).toBeNull();
  });

  it("normalises case and extra whitespace in reminders", () => {
    expect(parseFastIntent("  Remind   me to  call Sam   at 4 ", NOW)).toEqual({
      kind: "reminder",
      text: "call Sam",
      due: new Date(2026, 0, 15, 16, 0),
    });
  });
});
