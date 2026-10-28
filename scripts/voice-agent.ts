// Creates (or updates) Persona's ElevenLabs agent for VOICE_MODE=agent.
// Needs SPEECH_API=elevenlabs with SPEECH_API_KEY and SPEECH_VOICE, APP_URL
// (where ElevenLabs can reach this app) and ELEVENLABS_LLM_SECRET. Prints the
// agent id to set as ELEVENLABS_AGENT_ID.
import { setting, speechConfig } from "@/env";
import { setUpAgent } from "@/lib/persona/voice-agent";

const speech = speechConfig();
const appUrl = setting("APP_URL");
const llmSecret = setting("ELEVENLABS_LLM_SECRET");
if (speech?.api !== "elevenlabs" || !appUrl || !llmSecret) {
  console.error(
    "Set SPEECH_API=elevenlabs, SPEECH_API_KEY, SPEECH_VOICE, APP_URL and ELEVENLABS_LLM_SECRET first.",
  );
  process.exit(1);
}
const agentId = await setUpAgent({
  appUrl,
  apiKey: speech.apiKey,
  baseUrl: speech.baseUrl,
  voice: speech.voice,
  llmSecret,
  agentId: setting("ELEVENLABS_AGENT_ID"),
});
console.log(`Agent ready. Set ELEVENLABS_AGENT_ID=${agentId}`);
