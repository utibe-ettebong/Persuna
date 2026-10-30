import { describe, expect, it } from "vitest";
import { applySelection, probeModel, silenceWav } from "./selection";
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
