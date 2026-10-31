import { describe, expect, it } from "vitest";
import { textOf } from "@/lib/models/gateway";
import type { PersunaState } from "@/lib/persuna/types";
import { persunaChatMessages } from "./prompts";

const state = (): PersunaState => ({
  today: "2026-10-27",
  now: "2026-10-27T10:15",
  name: "Persuna",
  memory: [],
  focus: null,
  focusSkill: null,
  skills: [],
  mcpServers: [],
  todos: [],
  tone: {},
  lastAsked: null,
  pendingSwitch: null,
  workMode: false,
});

const systemOf = (voice: boolean, spoken: boolean) =>
  textOf(
    persunaChatMessages(state(), [], spoken ? { audio: "AAA" } : "hi", null, null, voice)[0]
      .content,
  );

describe("persunaChatMessages", () => {
  it("still asks for one JSON object by default", () => {
    const typed = systemOf(false, false);
    expect(typed).toContain("Reply with one JSON object and nothing else:");
    expect(typed).toContain('"reply": "what you say"');
    expect(typed).toContain('"asked": one of');
    expect(typed).not.toContain("```actions");

    const spoken = systemOf(false, true);
    expect(spoken).toContain('"heard": "what they said, word for word"');
  });

  it("asks for streamed prose with a fenced actions block for voice", () => {
    for (const spoken of [false, true]) {
      const system = systemOf(true, spoken);
      expect(system).not.toContain("Reply with one JSON object");
      expect(system).toContain('Heard: "their exact words"');
      expect(system).toContain("```actions");
      expect(system).toContain('{ "type": "remind", "text": "..."');
      expect(system).toContain("its Asked key is one of");
    }
  });

  it("tells the voice model where the recording's words go", () => {
    expect(systemOf(true, true)).toContain("Your Heard line holds exactly what they said.");
    expect(systemOf(true, false)).toContain("Their latest message is in <persuna_user>.");
  });
});
