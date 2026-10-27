import { modelProvider } from "@/env";
import { createGateway, type ModelClient } from "./gateway";
import { createMockClient } from "./mock";

/** The model client for this environment: live providers or the offline mock. */
export function createModelClient(): ModelClient {
  return modelProvider() === "mock" ? createMockClient() : createGateway();
}

export { createTranscriber } from "./transcribe";
