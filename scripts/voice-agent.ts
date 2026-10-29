// Creates (or updates) Persuna's ElevenLabs agent for VOICE_MODE=agent.
// Needs SPEECH_API=elevenlabs with SPEECH_API_KEY and SPEECH_VOICE, APP_URL
// (where ElevenLabs can reach this app) and ELEVENLABS_LLM_SECRET. Prints the
// agent id to set as ELEVENLABS_AGENT_ID.
import { setting, speechConfig } from "@/env";
import { setUpAgent } from "@/lib/persuna/voice-agent";

const speech = speechConfig();
const appUrl = setting("APP_URL");
const llmSecret = setting("ELEVENLABS_LLM_SECRET");
if (speech?.api !== "elevenlabs" || !appUrl || !llmSecret) {
  console.error(
    "Set SPEECH_API=elevenlabs, SPEECH_API_KEY, SPEECH_VOICE, APP_URL and ELEVENLABS_LLM_SECRET first.",
  );
  process.exit(1);
}
// ElevenLabs calls APP_URL from its own servers: a local address can't work.
const host = new URL(appUrl).hostname;
if (!appUrl.startsWith("https://") || /^(localhost|127\.|0\.0\.0\.0|\[::1\])/.test(host)) {
  console.error(
    `ElevenLabs can't reach APP_URL=${appUrl}. Run this with the deployed app's settings, for example:\n  railway run --service Persuna npm run voice:agent`,
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
