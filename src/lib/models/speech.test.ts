import { afterEach, describe, expect, it, vi } from "vitest";
import { speechConfig, type SpeechConfig } from "@/env";
import { MAX_SPOKEN_CHARS, createSpeaker } from "./speech";

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
      "x".repeat(900),
      "Warm, brief.",
    );
    expect(out.audio.byteLength).toBe(3);
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
    expect(calls[0].url).toBe("https://api.elevenlabs.io/v1/text-to-speech/abc");
    expect((calls[0].init.headers as Record<string, string>)["xi-api-key"]).toBe("k");
    expect(JSON.parse(String(calls[0].init.body))).toEqual({
      text: "Hello",
      model_id: "eleven_flash_v2_5",
    });
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
