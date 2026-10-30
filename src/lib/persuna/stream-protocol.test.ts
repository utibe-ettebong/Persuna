import { describe, expect, it } from "vitest";
import { createTurnSplitter, isPlainProse, parseTextTurn, type TurnEvent } from "./stream-protocol";

const FULL = [
  'Heard: "remind me tomorrow at nine"',
  "Okay, I'll remind you at 9 tomorrow.",
  "```actions",
  '[{"type": "remind", "text": "standup", "at": "tomorrow 9am"}]',
  "```",
].join("\n");

const feedAll = (chunks: string[]): TurnEvent[] => {
  const events: TurnEvent[] = [];
  const splitter = createTurnSplitter((event) => events.push(event));
  for (const chunk of chunks) splitter.feed(chunk);
  splitter.finish();
  return events;
};

describe("parseTextTurn", () => {
  it("reads heard, prose, and actions", () => {
    expect(parseTextTurn(FULL)).toEqual({
      heard: "remind me tomorrow at nine",
      prose: "Okay, I'll remind you at 9 tomorrow.",
      actions: [{ type: "remind", text: "standup", at: "tomorrow 9am" }],
      malformedTail: false,
    });
  });

  it("treats a fenceless reply as prose with no actions", () => {
    expect(parseTextTurn('Heard: "hi"\nHello there.')).toEqual({
      heard: "hi",
      prose: "Hello there.",
      actions: [],
      malformedTail: false,
    });
  });

  it("accepts a reply with no Heard line", () => {
    const turn = parseTextTurn("Just prose, no caption.");
    expect(turn.heard).toBeNull();
    expect(turn.prose).toBe("Just prose, no caption.");
    expect(isPlainProse(turn)).toBe(true);
  });

  it("reads a lone Heard line as heard, not prose", () => {
    expect(parseTextTurn('Heard: "stop"')).toEqual({
      heard: "stop",
      prose: "",
      actions: [],
      malformedTail: false,
    });
  });

  it("reads unquoted heard text", () => {
    expect(parseTextTurn("Heard: wrap up\nWrapping up.").heard).toBe("wrap up");
  });

  it("salvages complete JSON from an unclosed fence and flags the tail", () => {
    const turn = parseTextTurn('Heard: "go"\nOn it.\n```actions\n[{"type": "wrap_up"}]');
    expect(turn.actions).toEqual([{ type: "wrap_up" }]);
    expect(turn.malformedTail).toBe(true);
    expect(turn.prose).toBe("On it.");
  });

  it("reports no actions when the fence body never parses", () => {
    const turn = parseTextTurn('Thinking.\n```actions\n[{"type": "remind",');
    expect(turn.actions).toEqual([]);
    expect(turn.malformedTail).toBe(true);
    expect(turn.prose).toBe("Thinking.");
  });

  it("drops fence entries without a type and wraps a lone object", () => {
    const turn = parseTextTurn(
      'Heard: "x"\nDone.\n```actions\n[{"nope": 1}, {"type": "note", "body": "hi"}]\n```',
    );
    expect(turn.actions).toEqual([{ type: "note", body: "hi" }]);
    expect(turn.malformedTail).toBe(false);
    const lone = parseTextTurn('Done.\n```actions\n{"type": "wrap_up"}\n```');
    expect(lone.actions).toEqual([{ type: "wrap_up" }]);
  });

  it("keeps prose after a closed fence speakable", () => {
    const turn = parseTextTurn("Done.\n```actions\n[]\n```\nAnything else?");
    expect(turn.prose).toBe("Done.\nAnything else?");
    expect(turn.actions).toEqual([]);
  });
});

describe("createTurnSplitter", () => {
  it("emits prose before the fence arrives", () => {
    const events: TurnEvent[] = [];
    const splitter = createTurnSplitter((event) => events.push(event));
    splitter.feed('Heard: "hi"\nHello there, this is a long first sentence. ');
    expect(events).toContainEqual({ type: "heard", text: "hi" });
    expect(events.filter((e) => e.type === "prose").length).toBeGreaterThan(0);

    splitter.feed("```actions\n[]\n```");
    splitter.finish();
    expect(events).toContainEqual({ type: "actions", actions: [] });
  });

  it("matches whole-reply parsing when fed one character at a time", () => {
    const events = feedAll(FULL.split(""));
    expect(events).toContainEqual({ type: "heard", text: "remind me tomorrow at nine" });
    expect(
      events
        .filter((e) => e.type === "prose")
        .map((e) => (e as { text: string }).text)
        .join(""),
    ).toBe("Okay, I'll remind you at 9 tomorrow.\n");
    expect(events).toContainEqual({
      type: "actions",
      actions: [{ type: "remind", text: "standup", at: "tomorrow 9am" }],
    });
    expect(events.some((e) => e.type === "malformed-tail")).toBe(false);
  });

  it("holds a fence opener split across chunks out of the prose", () => {
    const events = feedAll(['Heard: "go"\nOn it.\n```act', 'ions\n[{"type": "wrap_up"}]\n```']);
    const prose = events
      .filter((e) => e.type === "prose")
      .map((e) => (e as { text: string }).text)
      .join("");
    expect(prose).toBe("On it.\n");
    expect(events).toContainEqual({ type: "actions", actions: [{ type: "wrap_up" }] });
  });

  it("waits for the Heard newline across chunks", () => {
    const events = feedAll(['Heard: "rem', 'ind me"\nOkay.']);
    expect(events).toContainEqual({ type: "heard", text: "remind me" });
  });

  it("gives up on Heard when the first line runs long", () => {
    const long = `Hello${"!".repeat(400)}\nSecond line.`;
    const events = feedAll([long]);
    expect(events.some((e) => e.type === "heard")).toBe(false);
    expect(
      events
        .filter((e) => e.type === "prose")
        .map((e) => (e as { text: string }).text)
        .join(""),
    ).toBe(long);
  });

  it("ignores empty feeds and a second finish", () => {
    const events = feedAll(["", "Hi.", ""]);
    expect(events).toHaveLength(1);
  });

  it("parses nothing from an empty reply", () => {
    expect(feedAll([])).toEqual([]);
    expect(parseTextTurn("")).toEqual({
      heard: null,
      prose: "",
      actions: [],
      malformedTail: false,
    });
  });
});
