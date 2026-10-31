import { afterEach, describe, expect, it } from "vitest";
import {
  applyProvider,
  applySelection,
  applySpeechProvider,
  probeModel,
  providerPresets,
  silenceWav,
} from "./selection";
import type { ModelClient } from "./gateway";
import type { Speaker } from "./speech";
import type { Transcriber } from "./transcribe";

describe("applySelection", () => {
  const config = { baseUrl: "https://x.test", apiKey: "k", model: "env-model" };

  it("swaps the model id and keeps everything else", () => {
    expect(applySelection(config, { model: "catalog-model" })).toEqual({
      baseUrl: "https://x.test",
      apiKey: "k",
      model: "catalog-model",
    });
  });

  it("leaves the config alone without a selection", () => {
    expect(applySelection(config, null)).toEqual(config);
  });
});

describe("silenceWav", () => {
  it("builds a valid silent WAV", () => {
    const wav = silenceWav();
    const text = new TextDecoder().decode(wav);
    expect(wav).toHaveLength(44 + 8000 * 2);
    expect(text.slice(0, 4)).toBe("RIFF");
    expect(text.slice(8, 12)).toBe("WAVE");
    expect(text.slice(36, 40)).toBe("data");
    expect(wav.slice(44).every((b) => b === 0)).toBe(true);
  });
});

describe("probeModel", () => {
  const client = (text: string): ModelClient => ({
    complete: async () => ({ text, model: "m", promptTokens: 1, completionTokens: 1 }),
  });

  it("passes a chat model that answers", async () => {
    const probed = await probeModel({ role: "draft", model: "m", deps: { client: client("ok") } });
    expect(probed.ok).toBe(true);
    expect(probed.detail).toContain("m answered");
  });

  it("fails empty answers and errors without throwing", async () => {
    expect(await probeModel({ role: "draft", model: "m", deps: { client: client("  ") } })).toEqual(
      { ok: false, detail: "m answered empty." },
    );
    const failing: ModelClient = {
      complete: async () => {
        throw new Error("nope");
      },
    };
    expect(await probeModel({ role: "draft", model: "m", deps: { client: failing } })).toEqual({
      ok: false,
      detail: "nope",
    });
  });

  it("passes a transcriber that does not throw", async () => {
    const transcriber: Transcriber = {
      transcribe: async () => ({ text: "", model: "t" }),
    };
    const probed = await probeModel({ role: "transcribe", model: "t", deps: { transcriber } });
    expect(probed.ok).toBe(true);
    const failing: Transcriber = {
      transcribe: async () => {
        throw new Error("bad audio");
      },
    };
    expect(
      await probeModel({ role: "transcribe", model: "t", deps: { transcriber: failing } }),
    ).toEqual({ ok: false, detail: "bad audio" });
  });

  it("passes a voice that returns audio", async () => {
    const audio = (bytes: number[]) =>
      new ReadableStream<Uint8Array>({
        start(c) {
          if (bytes.length) c.enqueue(new Uint8Array(bytes));
          c.close();
        },
      });
    const speaker: Speaker = {
      synthesize: async () => ({ audio: audio([1, 2, 3]), type: "audio/mpeg" }),
    };
    const probed = await probeModel({ role: "speech", model: "v", deps: { speaker } });
    expect(probed).toEqual({ ok: true, detail: "v spoke 3 bytes." });
    const silent: Speaker = {
      synthesize: async () => ({ audio: audio([]), type: "audio/mpeg" }),
    };
    expect(await probeModel({ role: "speech", model: "v", deps: { speaker: silent } })).toEqual({
      ok: false,
      detail: "v returned no audio.",
    });
    expect(await probeModel({ role: "speech", model: "v", deps: { speaker: null } })).toEqual({
      ok: false,
      detail: "No speech key is configured for a probe.",
    });
  });
});

describe("providerPresets", () => {
  const saved = { ...process.env };
  afterEach(() => {
    for (const key of Object.keys(process.env)) {
      if (key.endsWith("_API_KEY") || key.endsWith("_BASE_URL")) delete process.env[key];
    }
    Object.assign(process.env, saved);
  });

  it("offers the key slots Railway has, never their values", () => {
    process.env.EXTRACT_API_KEY = "sk-extract";
    process.env.EXTRACT_BASE_URL = "https://meta.example/v1";
    process.env.DRAFT_API_KEY = "sk-draft";
    const presets = providerPresets("draft");
    expect(presets.map((p) => p.id)).toEqual(["extract", "draft"]);
    expect(presets[0]).toMatchObject({
      label: "EXTRACT key",
      baseUrl: "https://meta.example/v1",
      keySlot: "EXTRACT",
    });
    expect(JSON.stringify(presets)).not.toContain("sk-extract");
  });

  it("offers ElevenLabs and the custom voice server for the voice role", () => {
    process.env.SPEECH_API_KEY = "sk-speech";
    process.env.SPEECH_BASE_URL = "https://qwen.example.run";
    const presets = providerPresets("speech");
    expect(presets.map((p) => p.id)).toEqual(["elevenlabs", "custom"]);
    expect(presets[1]?.label).toContain("qwen.example.run");
  });

  it("offers no voice provider without a speech key", () => {
    expect(providerPresets("speech")).toEqual([]);
  });
});

describe("applyProvider", () => {
  const saved = { ...process.env };
  afterEach(() => {
    for (const key of Object.keys(process.env)) {
      if (key.endsWith("_API_KEY") || key.endsWith("_BASE_URL")) delete process.env[key];
    }
    Object.assign(process.env, saved);
  });

  const config = {
    baseUrl: "https://env.example/v1",
    apiKey: "env-key",
    model: "env-model",
    reasoningEffort: "high" as const,
  };

  it("routes a role to another key slot, clearing a borrowed reasoning setting", () => {
    process.env.EXTRACT_API_KEY = "sk-extract";
    process.env.DRAFT_API_KEY = "sk-draft";
    process.env.DRAFT_BASE_URL = "https://draft.example/v1";
    const out = applyProvider(
      config,
      { model: "catalog-model", provider: "draft", baseUrl: null, reasoningEffort: null },
      providerPresets("draft"),
    );
    expect(out).toEqual({
      baseUrl: "https://draft.example/v1",
      apiKey: "sk-draft",
      model: "catalog-model",
      reasoningEffort: undefined,
    });
  });

  it("lets an explicit entry URL and reasoning win", () => {
    process.env.EXTRACT_API_KEY = "sk-extract";
    const out = applyProvider(
      config,
      {
        model: "m",
        provider: "extract",
        baseUrl: "https://typed.example/v1",
        reasoningEffort: "minimal",
      },
      providerPresets("extract"),
    );
    expect(out.baseUrl).toBe("https://typed.example/v1");
    expect(out.reasoningEffort).toBe("minimal");
    expect(out.apiKey).toBe("sk-extract");
  });

  it("keeps env routing for no selection or an unknown provider", () => {
    expect(applyProvider(config, null, [])).toEqual(config);
    expect(
      applyProvider(
        config,
        { model: "m", provider: "gone", baseUrl: null, reasoningEffort: null },
        [],
      ),
    ).toEqual({ ...config, model: "m" });
  });
});

describe("applySpeechProvider", () => {
  it("switches the voice between ElevenLabs and the custom server in one selection", () => {
    process.env.SPEECH_API_KEY = "sk-speech";
    process.env.SPEECH_BASE_URL = "https://qwen.example.run";
    try {
      const eleven = applySpeechProvider(
        { api: "openai", baseUrl: "https://qwen.example.run", apiKey: "k", model: "m", voice: "v" },
        {
          model: "eleven_flash",
          provider: "elevenlabs",
          baseUrl: null,
          voice: "rachel",
          reasoningEffort: null,
        },
        providerPresets("speech"),
      );
      expect(eleven).toMatchObject({
        api: "elevenlabs",
        baseUrl: "https://api.elevenlabs.io/v1",
        model: "eleven_flash",
        voice: "rachel",
      });
      const qwen = applySpeechProvider(
        {
          api: "elevenlabs",
          baseUrl: "https://api.elevenlabs.io/v1",
          apiKey: "k",
          model: "m",
          voice: "v",
        },
        {
          model: "qwen-tts",
          provider: "custom",
          baseUrl: null,
          voice: null,
          reasoningEffort: null,
        },
        providerPresets("speech"),
      );
      expect(qwen).toMatchObject({
        api: "openai",
        baseUrl: "https://qwen.example.run",
        voice: "v",
      });
    } finally {
      delete process.env.SPEECH_API_KEY;
      delete process.env.SPEECH_BASE_URL;
    }
  });
});
