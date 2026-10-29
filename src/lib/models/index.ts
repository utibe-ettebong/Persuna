import { modelProvider } from "@/env";
import { createGateway, type ModelClient } from "./gateway";
import { createMockClient } from "./mock";
import { createTranscriber as liveOrMockTranscriber, type Transcriber } from "./transcribe";
import { createSpeaker as liveSpeaker, type Speaker } from "./speech";
import { type Caller, meteredClient, meteredSpeaker, meteredTranscriber } from "./usage";

/**
 * The model client for this environment: live providers or the offline mock.
 * Pass the signed-in user to count live calls against their daily limit;
 * system work (payment confirmations, scripts) passes nothing.
 */
export function createModelClient(caller?: Caller): ModelClient {
  if (modelProvider() === "mock") return createMockClient();
  const client = createGateway();
  return caller ? meteredClient(client, caller) : client;
}

export function createTranscriber(caller?: Caller): Transcriber {
  const transcriber = liveOrMockTranscriber();
  return caller && modelProvider() !== "mock"
    ? meteredTranscriber(transcriber, caller)
    : transcriber;
}

/** Persuna's cloud voice, or null when none is configured (the browser speaks). */
export function createSpeaker(caller?: Caller): Speaker | null {
  const speaker = liveSpeaker();
  return speaker && caller ? meteredSpeaker(speaker, caller) : speaker;
}
