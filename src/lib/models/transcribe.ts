import { z } from "zod";
import { env, modelProvider, transcriptionConfig, type ModelRoleConfig } from "@/env";

export interface Transcript {
  text: string;
  model: string;
}

/** Speech to text. Live: Muse Voice Transcribe via an OpenAI-compatible endpoint. */
export interface Transcriber {
  transcribe(audio: Blob, filename: string): Promise<Transcript>;
}

export const MAX_AUDIO_BYTES = 4 * 1024 * 1024;
export const AUDIO_TYPES = /\.(webm|ogg|mp3|m4a|mp4|wav|mpeg|mpga)$/i;

const response = z.object({ text: z.string() });

/** A recorded or uploaded audio file from a form field, or null when none was given. */
export function readAudio(value: FormDataEntryValue | null): File | null {
  if (!(value instanceof File) || value.size === 0) return null;
  if (value.size > MAX_AUDIO_BYTES)
    throw new Error("Recordings must be under 4 MB (about 5 minutes)");
  const name = value.name && AUDIO_TYPES.test(value.name) ? value.name : "recording.webm";
  if (value.name && value.name !== "blob" && !AUDIO_TYPES.test(value.name)) {
    throw new Error("Upload an audio file (.webm, .m4a, .mp3, .wav)");
  }
  return new File([value], name, { type: value.type || "audio/webm" });
}

export function createTranscriber(
  resolve: () => ModelRoleConfig = transcriptionConfig,
  fetchImpl: typeof fetch = fetch,
): Transcriber {
  if (modelProvider() === "mock") return mockTranscriber;
  return {
    async transcribe(audio, filename) {
      const config = resolve();
      const form = new FormData();
      form.append("file", audio, filename);
      form.append("model", config.model);
      const res = await fetchImpl(`${config.baseUrl.replace(/\/+$/, "")}/audio/transcriptions`, {
        method: "POST",
        headers: { authorization: `Bearer ${config.apiKey}` },
        body: form,
        signal: AbortSignal.timeout(env().MODEL_TIMEOUT_MS),
      });
      if (!res.ok) {
        throw new Error(
          `Transcription failed: HTTP ${res.status} ${(await res.text()).slice(0, 200)}`,
        );
      }
      const parsed = response.safeParse(await res.json());
      if (!parsed.success) throw new Error("Transcription returned an unexpected response");
      return { text: parsed.data.text.trim(), model: config.model };
    },
  };
}

/**
 * Whether live transcription can work as configured. Meta's Muse Voice
 * Transcribe uses its own API (/v1/asr/transcribe, 16 kHz mono WAV), not the
 * OpenAI-compatible route this client calls, so it is reported as unsupported.
 */
export function transcriptionCheck(): { ok: boolean; detail: string } {
  if (modelProvider() === "mock")
    return { ok: true, detail: "Mock transcriber (no live key set)." };
  try {
    const config = transcriptionConfig();
    if (/api\.meta\.ai/i.test(config.baseUrl)) {
      return {
        ok: false,
        detail:
          "Meta's transcription API isn't OpenAI-compatible yet in PERSUNA. Use a Baseten Qwen3-ASR deployment (TRANSCRIBE_BASE_URL, TRANSCRIBE_API_KEY, TRANSCRIBE_MODEL) or add a Meta adapter.",
      };
    }
    return { ok: true, detail: `${config.model} at ${config.baseUrl} (not called: needs audio).` };
  } catch (error) {
    return { ok: false, detail: (error as Error).message.slice(0, 300) };
  }
}

/** Offline stand-in: a fixed walkthrough, so the voice flow works end to end without keys. */
export const mockTranscriber: Transcriber = {
  async transcribe(audio) {
    if (audio.size === 0) throw new Error("The recording is empty");
    return {
      model: "mock",
      text:
        "Mock transcript. I start with a header block listing the date, the chair, who was present and apologies. " +
        "Every decision gets its own line in bold so nobody misses it. " +
        "I always leave out small talk and anything that led to no decision. " +
        "Times are written in the twenty-four hour clock.",
    };
  },
};
