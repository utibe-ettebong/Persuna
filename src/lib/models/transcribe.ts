import { z } from "zod";
import { env, modelProvider, transcriptionConfig, type ModelRoleConfig } from "@/env";
import { metaWavProblem, parseWav } from "@/lib/audio/wav";

export interface Transcript {
  text: string;
  model: string;
}

/**
 * Speech to text. Two live shapes:
 * - Meta's Muse Voice Transcribe (base URL on api.meta.ai): POST {base}/asr/transcribe,
 *   multipart with a JSON `request` part and a mono 16-bit 16/24 kHz WAV `audio` part;
 * - anything else: OpenAI-compatible POST {base}/audio/transcriptions (for example a
 *   Baseten Qwen3-ASR deployment).
 * The browser converts recordings and uploads to 16 kHz mono WAV first, so both work.
 */
export interface Transcriber {
  transcribe(audio: Blob, filename: string): Promise<Transcript>;
}

/** 16 kHz mono WAV is 32 KB a second: about 6 minutes. */
export const MAX_AUDIO_BYTES = 12 * 1024 * 1024;
export const AUDIO_TYPES = /\.(webm|ogg|mp3|m4a|mp4|wav|mpeg|mpga)$/i;

const openAiResponse = z.object({ text: z.string() });
const metaResponse = z.object({ transcript: z.string() });

/** Meta's native API when TRANSCRIBE_API=meta, or (by default) when the base URL is api.meta.ai. */
export function isMetaAsr(baseUrl: string): boolean {
  const forced = process.env.TRANSCRIBE_API;
  if (forced === "meta") return true;
  if (forced === "openai") return false;
  return /(^|\/\/)api\.meta\.ai(\/|$)/i.test(baseUrl);
}

/** A recorded or uploaded audio file from a form field, or null when none was given. */
export function readAudio(value: FormDataEntryValue | null): File | null {
  if (!(value instanceof File) || value.size === 0) return null;
  if (value.size > MAX_AUDIO_BYTES) throw new Error("Recordings must be under about 6 minutes");
  const name = value.name && AUDIO_TYPES.test(value.name) ? value.name : "recording.wav";
  if (value.name && value.name !== "blob" && !AUDIO_TYPES.test(value.name)) {
    throw new Error("Upload an audio file (.webm, .m4a, .mp3, .wav)");
  }
  return new File([value], name, { type: value.type || "audio/wav" });
}

export function createTranscriber(
  resolve: () => ModelRoleConfig = transcriptionConfig,
  fetchImpl: typeof fetch = fetch,
  override: (config: ModelRoleConfig) => ModelRoleConfig | Promise<ModelRoleConfig> = (c) => c,
): Transcriber {
  if (modelProvider() === "mock") return mockTranscriber;
  return {
    async transcribe(audio, filename) {
      const config = await override(resolve());
      const base = config.baseUrl.replace(/\/+$/, "");
      return isMetaAsr(base)
        ? metaTranscribe(base, config, audio, filename, fetchImpl)
        : openAiTranscribe(base, config, audio, filename, fetchImpl);
    },
  };
}

async function metaTranscribe(
  base: string,
  config: ModelRoleConfig,
  audio: Blob,
  filename: string,
  fetchImpl: typeof fetch,
): Promise<Transcript> {
  const problem = metaWavProblem(parseWav(await audio.arrayBuffer()));
  if (problem) throw new Error(problem);

  const form = new FormData();
  form.append(
    "request",
    new Blob(
      [JSON.stringify({ model: config.model, mode: "PUSH_TO_TALK", audioEncoding: "WAV" })],
      {
        type: "application/json",
      },
    ),
  );
  form.append("audio", audio, filename.replace(/\.[a-z0-9]+$/i, "") + ".wav");
  const res = await fetchImpl(`${base}/asr/transcribe`, {
    method: "POST",
    headers: { authorization: `Bearer ${config.apiKey}`, accept: "application/json" },
    body: form,
    signal: AbortSignal.timeout(env().MODEL_TIMEOUT_MS),
  });
  if (!res.ok) {
    throw new Error(`Transcription failed: HTTP ${res.status} ${(await res.text()).slice(0, 200)}`);
  }
  const parsed = metaResponse.safeParse(await res.json());
  if (!parsed.success) throw new Error("Transcription returned an unexpected response");
  return { text: parsed.data.transcript.trim(), model: config.model };
}

async function openAiTranscribe(
  base: string,
  config: ModelRoleConfig,
  audio: Blob,
  filename: string,
  fetchImpl: typeof fetch,
): Promise<Transcript> {
  const form = new FormData();
  form.append("file", audio, filename);
  form.append("model", config.model);
  const res = await fetchImpl(`${base}/audio/transcriptions`, {
    method: "POST",
    headers: { authorization: `Bearer ${config.apiKey}` },
    body: form,
    signal: AbortSignal.timeout(env().MODEL_TIMEOUT_MS),
  });
  if (!res.ok) {
    throw new Error(`Transcription failed: HTTP ${res.status} ${(await res.text()).slice(0, 200)}`);
  }
  const parsed = openAiResponse.safeParse(await res.json());
  if (!parsed.success) throw new Error("Transcription returned an unexpected response");
  return { text: parsed.data.text.trim(), model: config.model };
}

/** Which transcription API the current settings will use, for the Models & keys page. */
export function transcriptionCheck(): { ok: boolean; detail: string } {
  if (modelProvider() === "mock")
    return { ok: true, detail: "Mock transcriber (no live key set)." };
  try {
    const config = transcriptionConfig();
    return isMetaAsr(config.baseUrl)
      ? { ok: true, detail: `${config.model} via Meta's native speech API` }
      : { ok: true, detail: `${config.model} via ${config.baseUrl}/audio/transcriptions` };
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
