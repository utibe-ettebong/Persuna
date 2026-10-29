import { describe, expect, it } from "vitest";
import {
  AGENT_TTS_MODEL,
  SESSION_TTL_MS,
  lastUserText,
  readSession,
  rememberTurn,
  setUpAgent,
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

describe("setting up the ElevenLabs agent", () => {
  it("uses a speech model English agents accept, and Persuna's own brain", async () => {
    const sent: { url: string; body: Record<string, unknown> }[] = [];
    const fakeFetch = (async (url: string, init: RequestInit) => {
      sent.push({ url, body: JSON.parse(String(init.body)) });
      return new Response(JSON.stringify({ secret_id: "s1", agent_id: "a1" }), { status: 200 });
    }) as unknown as typeof fetch;
    const id = await setUpAgent(
      {
        appUrl: "https://persuna.example/",
        apiKey: "k",
        baseUrl: "https://api.elevenlabs.io/v1",
        voice: "v",
        llmSecret: "x".repeat(24),
      },
      fakeFetch,
    );
    expect(id).toBe("a1");
    const create = sent.find((s) => s.url.endsWith("/convai/agents/create"))!.body as {
      conversation_config: {
        tts: { model_id: string };
        agent: { prompt: { custom_llm: { url: string } } };
      };
    };
    expect(AGENT_TTS_MODEL).toBe("eleven_flash_v2");
    expect(create.conversation_config.tts.model_id).toBe(AGENT_TTS_MODEL);
    expect(create.conversation_config.agent.prompt.custom_llm.url).toBe(
      "https://persuna.example/api/persuna/llm",
    );
  });
});
