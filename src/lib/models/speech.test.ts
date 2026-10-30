import { afterEach, describe, expect, it, vi } from "vitest";
import { speechConfig, type SpeechConfig } from "@/env";
import { MAX_SPOKEN_CHARS, createSpeaker, directSpeechUrl, spokenPart } from "./speech";

vi.mock("@/env", async (original) => ({
  ...(await original<typeof import("@/env")>()),
  env: () => ({ MODEL_TIMEOUT_MS: 5000 }),
}));

function fakeFetch() {
  const calls: { url: string; init: RequestInit }[] = [];
  const impl = (async (url: string, init: RequestInit) => {
    calls.push({ url, init });
    return new Response(new Uint8Array([1, 2, 3]), { headers: { "content-type": "audio/mpeg" } });
  }) as unknown as typeof fetch;
  return { calls, impl };
}

const openai: SpeechConfig = {
  api: "openai",
  baseUrl: "https://api.openai.com/v1",
  apiKey: "k",
  model: "gpt-4o-mini-tts",
  voice: "nova",
};

describe("createSpeaker", () => {
  it("is off without a provider, so the browser speaks", () => {
    expect(createSpeaker(() => null)).toBeNull();
  });

  it("calls OpenAI-style /audio/speech with the tone as instructions", async () => {
    const { calls, impl } = fakeFetch();
    const out = await createSpeaker(() => openai, impl)!.synthesize(
      "x".repeat(2000),
      "Warm, brief.",
    );
    expect((await new Response(out.audio).arrayBuffer()).byteLength).toBe(3);
    expect(calls[0].url).toBe("https://api.openai.com/v1/audio/speech");
    const sent = JSON.parse(String(calls[0].init.body));
    expect(sent).toMatchObject({
      model: "gpt-4o-mini-tts",
      voice: "nova",
      instructions: "Warm, brief.",
    });
    expect(sent.input).toHaveLength(MAX_SPOKEN_CHARS);
  });

  it("calls ElevenLabs with its own header and voice in the path", async () => {
    const { calls, impl } = fakeFetch();
    await createSpeaker(
      () => ({
        ...openai,
        api: "elevenlabs",
        baseUrl: "https://api.elevenlabs.io/v1",
        voice: "abc",
        model: "eleven_flash_v2_5",
      }),
      impl,
    )!.synthesize("Hello");
    expect(calls[0].url).toBe("https://api.elevenlabs.io/v1/text-to-speech/abc/stream");
    expect((calls[0].init.headers as Record<string, string>)["xi-api-key"]).toBe("k");
    expect(JSON.parse(String(calls[0].init.body))).toEqual({
      text: "Hello",
      model_id: "eleven_flash_v2_5",
    });
  });
});

describe("spokenPart", () => {
  it("keeps short replies whole and cuts long ones at a sentence end", () => {
    expect(spokenPart("Hello there.")).toBe("Hello there.");
    const long = `${"A sentence that goes on. ".repeat(80)}`;
    const part = spokenPart(long);
    expect(part.length).toBeLessThanOrEqual(MAX_SPOKEN_CHARS);
    expect(part.endsWith("on.")).toBe(true);
  });
});

describe("speechConfig", () => {
  afterEach(() => vi.unstubAllEnvs());
  it("picks the API from the base URL and fills defaults", () => {
    vi.stubEnv("SPEECH_API_KEY", "real-key");
    expect(speechConfig()).toMatchObject({ api: "openai", voice: "nova" });
    vi.stubEnv("SPEECH_BASE_URL", "https://api.elevenlabs.io/v1");
    expect(speechConfig()).toMatchObject({ api: "elevenlabs", model: "eleven_flash_v2_5" });
    vi.stubEnv("SPEECH_API_KEY", "PASTE_KEY_HERE");
    expect(speechConfig()).toBeNull();
  });
});

describe("directSpeechUrl", () => {
  const eleven = {
    api: "elevenlabs" as const,
    apiKey: "secret-key",
    baseUrl: "https://api.elevenlabs.io/v1",
    model: "eleven_flash_v2_5",
    voice: "voice id",
  };

  it("makes an address with a single-use token, never the key", async () => {
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify({ token: "once" })));
    const url = await directSpeechUrl(eleven, fetchImpl as unknown as typeof fetch);

    expect(url).toMatch(
      /^wss:\/\/api\.elevenlabs\.io\/v1\/text-to-speech\/voice%20id\/stream-input\?/,
    );
    expect(new URL(url!).searchParams.get("single_use_token")).toBe("once");
    expect(new URL(url!).searchParams.get("model_id")).toBe("eleven_flash_v2_5");
    expect(url).not.toContain("secret-key");
    const [called, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect(called).toBe("https://api.elevenlabs.io/v1/single-use-token/tts_websocket");
    expect(init.headers).toMatchObject({ "xi-api-key": "secret-key" });
  });

  it("has nothing for other voices", async () => {
    const fetchImpl = vi.fn();
    const other = { ...eleven, api: "openai" as const };
    expect(await directSpeechUrl(other, fetchImpl as unknown as typeof fetch)).toBeNull();
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("fails loudly if the provider refuses", async () => {
    const fetchImpl = vi.fn(async () => new Response("nope", { status: 401 }));
    await expect(directSpeechUrl(eleven, fetchImpl as unknown as typeof fetch)).rejects.toThrow(
      /401/,
    );
  });
});
