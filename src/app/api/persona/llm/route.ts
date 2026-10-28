import { answerAgentCall } from "@/lib/persona/voice-agent";

/**
 * Persona's brain for ElevenLabs Agents (VOICE_MODE=agent): an
 * OpenAI-compatible Chat Completions endpoint that ElevenLabs calls for each
 * spoken turn. Only ElevenLabs, with the shared secret and a signed session,
 * gets an answer.
 */
export async function POST(request: Request) {
  const body = await request.json().catch(() => null);
  const stream = await answerAgentCall(request.headers.get("authorization"), body);
  if (stream === null) return new Response("Not allowed", { status: 401 });
  return new Response(stream, {
    headers: { "content-type": "text/event-stream", "cache-control": "no-store" },
  });
}
