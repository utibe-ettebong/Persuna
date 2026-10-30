import { z } from "zod";
import { env, speechConfig, type SpeechConfig } from "@/env";

/**
 * Persuna's cloud voice: text in, audio out. Returns null when no speech
 * provider is configured, and the browser speaks instead.
 */
export interface Speaker {
  /** The audio streams back as it's made, so playback starts within a moment. */
  synthesize(
    text: string,
    style?: string,
  ): Promise<{ audio: ReadableStream<Uint8Array>; type: string }>;
}

const TOKEN_TIMEOUT_MS = 5000;
const speechToken = z.object({ token: z.string().min(1) });

/** Longest reply spoken in one go; anything past it is cut at a sentence end. */
export const MAX_SPOKEN_CHARS = 1500;

/** The reply up to {@link MAX_SPOKEN_CHARS}, ending on a whole sentence where possible. */
export function spokenPart(text: string): string {
  if (text.length <= MAX_SPOKEN_CHARS) return text;
  const cut = text.slice(0, MAX_SPOKEN_CHARS);
  const end = Math.max(cut.lastIndexOf(". "), cut.lastIndexOf("! "), cut.lastIndexOf("? "));
  return end > MAX_SPOKEN_CHARS / 2 ? cut.slice(0, end + 1) : cut;
}

export function createSpeaker(
  resolve: () => SpeechConfig | null = speechConfig,
  fetchImpl: typeof fetch = fetch,
  override: (config: SpeechConfig) => SpeechConfig | Promise<SpeechConfig> = (c) => c,
): Speaker | null {
  const envConfig = resolve();
  if (!envConfig) return null;
  return {
    async synthesize(text, style) {
      const config = await override(envConfig);
      const input = spokenPart(text);
      const res =
        config.api === "elevenlabs"
          ? await fetchImpl(
              // The streaming endpoint sends the first audio within a few hundred ms.
              `${config.baseUrl}/text-to-speech/${encodeURIComponent(config.voice)}/stream`,
              {
                method: "POST",
                headers: {
                  "xi-api-key": config.apiKey,
                  "content-type": "application/json",
                  accept: "audio/mpeg",
                },
                body: JSON.stringify({ text: input, model_id: config.model }),
                signal: AbortSignal.timeout(env().MODEL_TIMEOUT_MS),
              },
            )
          : await fetchImpl(`${config.baseUrl}/audio/speech`, {
              method: "POST",
              headers: {
                authorization: `Bearer ${config.apiKey}`,
                "content-type": "application/json",
              },
              body: JSON.stringify({
                model: config.model,
                voice: config.voice,
                input,
                response_format: "mp3",
                // Steers delivery on models that take it (gpt-4o-mini-tts); others ignore it.
                ...(style && { instructions: style }),
              }),
              signal: AbortSignal.timeout(env().MODEL_TIMEOUT_MS),
            });
      if (!res.ok || !res.body) {
        throw new Error(`Speech failed: HTTP ${res.status} ${(await res.text()).slice(0, 200)}`);
      }
      return {
        audio: res.body,
        type: res.headers.get("content-type") ?? "audio/mpeg",
      };
    },
  };
}

/**
 * Where the app can speak to ElevenLabs itself, or null for other voices. The
 * address holds a single-use token, so the API key stays on the server; going
 * straight there skips the trip through this server on every line.
 */
export async function directSpeechUrl(
  config: SpeechConfig,
  fetchImpl: typeof fetch = fetch,
): Promise<string | null> {
  if (config.api !== "elevenlabs") return null;
  const res = await fetchImpl(`${config.baseUrl}/single-use-token/tts_websocket`, {
    method: "POST",
    headers: { "xi-api-key": config.apiKey },
    signal: AbortSignal.timeout(TOKEN_TIMEOUT_MS),
  });
  if (!res.ok) {
    throw new Error(`Speech token failed: HTTP ${res.status} ${(await res.text()).slice(0, 200)}`);
  }
  const { token } = speechToken.parse(await res.json());
  const query = new URLSearchParams({
    model_id: config.model,
    output_format: "mp3_44100_128",
    inactivity_timeout: "180",
    single_use_token: token,
  });
  const voice = encodeURIComponent(config.voice);
  return `${config.baseUrl.replace(/^http/, "ws")}/text-to-speech/${voice}/stream-input?${query}`;
}
