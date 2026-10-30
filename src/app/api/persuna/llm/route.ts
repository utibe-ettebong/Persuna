import { answerAgentCallStream } from "@/lib/persuna/voice-agent";

/**
 * Persuna's brain for ElevenLabs Agents (VOICE_MODE=agent): an
 * OpenAI-compatible Chat Completions endpoint that ElevenLabs calls for each
 * spoken turn, answered sentence by sentence as it's written. Only
 * ElevenLabs, with the shared secret and a signed session, gets an answer.
 */
export async function POST(request: Request) {
  const body = await request.json().catch(() => null);
  const response = await answerAgentCallStream(request.headers.get("authorization"), body);
  if (response === null) return new Response("Not allowed", { status: 401 });
  return response;
}
