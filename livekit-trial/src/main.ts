import {
  type JobContext,
  ServerOptions,
  cli,
  defineAgent,
  inference,
  voice,
} from "@livekit/agents";
import * as aiCoustics from "@livekit/plugins-ai-coustics";
import { fileURLToPath } from "node:url";
import dotenv from "dotenv";
import { createAgent } from "./agent.js";

dotenv.config({ path: ".env.local" });

// Both engines run through LiveKit Inference, so the trial needs no Google
// or OpenAI key of its own: TRIAL_ENGINE=realtime tries Gemini Live first,
// TRIAL_ENGINE=pipeline falls back to STT-LLM-TTS on the same tools.
const ENGINE = process.env.TRIAL_ENGINE === "pipeline" ? "pipeline" : "realtime";

export default defineAgent({
  entry: async (ctx: JobContext) => {
    const session =
      ENGINE === "pipeline"
        ? new voice.AgentSession({
            stt: new inference.STT({ model: "assemblyai/universal-3-6-pro", language: "en" }),
            llm: new inference.LLM({ model: "google/gemma-4-31b-it" }),
            tts: new inference.TTS({
              model: "fishaudio/s2.1-pro",
              voice: "fa4c9eb3dccc4806b382b40d61c6b10a",
            }),
            turnHandling: { turnDetection: new inference.TurnDetector() },
          })
        : new voice.AgentSession({
            llm: new inference.RealtimeModel({ model: "google/gemini-3.8-live", voice: "Puck" }),
          });

    await session.start({
      agent: createAgent(),
      room: ctx.room,
      inputOptions: {
        noiseCancellation: aiCoustics.audioEnhancement({
          model: aiCoustics.EnhancerModel.QuailVfS,
        }),
      },
    });

    await ctx.connect();

    await session.generateReply({
      instructions: "Greet the user briefly as Persuna and offer your assistance.",
    });
  },
});

cli.runApp(
  new ServerOptions({ agent: fileURLToPath(import.meta.url), agentName: "persuna-trial" }),
);
