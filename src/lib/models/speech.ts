import { env, speechConfig, type SpeechConfig } from "@/env";

/**
 * Persona's cloud voice: text in, audio out. Returns null when no speech
 * provider is configured, and the browser speaks instead.
 */
export interface Speaker {
  synthesize(text: string, style?: string): Promise<{ audio: ArrayBuffer; type: string }>;
}

/** Long replies are cut here; the rest stays on screen. */
export const MAX_SPOKEN_CHARS = 600;

export function createSpeaker(
  resolve: () => SpeechConfig | null = speechConfig,
  fetchImpl: typeof fetch = fetch,
): Speaker | null {
  const config = resolve();
  if (!config) return null;
  return {
    async synthesize(text, style) {
      const input = text.slice(0, MAX_SPOKEN_CHARS);
      const res =
        config.api === "elevenlabs"
          ? await fetchImpl(
              `${config.baseUrl}/text-to-speech/${encodeURIComponent(config.voice)}`,
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
      if (!res.ok) {
        throw new Error(`Speech failed: HTTP ${res.status} ${(await res.text()).slice(0, 200)}`);
      }
      return {
        audio: await res.arrayBuffer(),
        type: res.headers.get("content-type") ?? "audio/mpeg",
      };
    },
  };
}
