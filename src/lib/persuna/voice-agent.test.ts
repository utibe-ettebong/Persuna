import { describe, expect, it } from "vitest";
import {
  SESSION_TTL_MS,
  lastUserText,
  readSession,
  rememberTurn,
  signSession,
  streamReply,
  takeTurns,
} from "./voice-agent";
import type { ChatResult } from "./service";

const SECRET = "a-long-test-secret-for-the-voice-agent";

describe("voice session tokens", () => {
  it("round-trips the user and offset", () => {
    const token = signSession("user-1", -60, SECRET, 1000);
    expect(readSession(token, SECRET, 2000)).toEqual({ userId: "user-1", offset: -60 });
  });

  it("refuses forged, re-signed and expired tokens", () => {
    const token = signSession("user-1", 0, SECRET, 1000);
    const [payload, sig] = token.split(".");
    const other = Buffer.from(JSON.stringify({ u: "user-2", o: 0, e: 9e15 })).toString("base64url");
    expect(readSession(`${other}.${sig}`, SECRET, 2000)).toBeNull();
    expect(readSession(signSession("user-1", 0, "another-secret-entirely-xx"), SECRET)).toBeNull();
    expect(readSession(`${payload}.${sig}`, SECRET, 1000 + SESSION_TTL_MS + 1)).toBeNull();
    expect(readSession(undefined, SECRET)).toBeNull();
  });
});

describe("the brain endpoint's plumbing", () => {
  it("finds the latest thing the user said", () => {
    expect(
      lastUserText([
        { role: "system", content: "ignored" },
        { role: "user", content: "first" },
        { role: "assistant", content: "ok" },
        { role: "user", content: [{ type: "text", text: "remind me at four" }] },
      ]),
    ).toBe("remind me at four");
    expect(lastUserText("nope")).toBe("");
  });

  it("streams a reply as Chat Completions events", () => {
    const sse = streamReply("Hello there.");
    const events = sse.trim().split("\n\n");
    expect(JSON.parse(events[0].slice(6)).choices[0].delta.content).toBe("Hello there.");
    expect(events.at(-1)).toBe("data: [DONE]");
  });

  it("hands each turn's screen effects to the page once", () => {
    const result = { navigate: "/jobs" } as ChatResult;
    rememberTurn("u", result, 0);
    expect(takeTurns("u", 1000)).toEqual([result]);
    expect(takeTurns("u", 1000)).toEqual([]);
    rememberTurn("u", result, 0);
    expect(takeTurns("u", 120_000)).toEqual([]);
  });
});
