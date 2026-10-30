import { voice } from "@livekit/agents";
import { persunaTools } from "./tools.js";

/**
 * Persuna as the trial sees it: the same brief companion, with its actions
 * as function tools instead of a fenced block. The trial measures whether
 * this loop answers in under a second and calls tools reliably; everything
 * else (memory, skills, the screen) stays in the app for now.
 */
export function createAgent() {
  return voice.Agent.create({
    instructions: `You are Persuna, a personal AI assistant trying out a faster voice.
      Talk briefly, as if mid-conversation: one or two short sentences, no lists, no markdown, no emoji.
      When the user asks you to remember something, call rememberFact. When they ask for a reminder or a to-do, call setReminder.
      Otherwise just answer from what you know. Never claim you did something you didn't call a tool for.`,
    tools: persunaTools(),
  });
}
