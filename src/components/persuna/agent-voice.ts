"use client";

import { Conversation } from "@elevenlabs/client";

/**
 * A live voice call through ElevenLabs Agents (VOICE_MODE=agent): it listens,
 * knows when you've finished, lets you talk over it and speaks, while every
 * answer comes from Persuna's own server. The server signs who is talking; the
 * page never sees an ElevenLabs key.
 */
export interface AgentCall {
  stop(): Promise<void>;
}

export async function startAgentCall(handlers: {
  /** Persuna started (true) or stopped (false) speaking. */
  onSpeaking: (speaking: boolean) => void;
  /** 0–1: Persuna's voice while it speaks, yours while it listens. */
  onLevel: (level: number) => void;
  /** What Persuna said, as it says it. */
  onReply: (text: string) => void;
  /** You said something. */
  onHeard: (text: string) => void;
  onEnd: () => void;
  onError: (message: string) => void;
}): Promise<AgentCall | null> {
  const res = await fetch(`/api/persuna/voice-session?offset=${new Date().getTimezoneOffset()}`, {
    method: "POST",
  });
  if (res.status === 204) return null;
  if (!res.ok) throw new Error("The voice service didn't answer.");
  const { conversationToken, session } = (await res.json()) as {
    conversationToken: string;
    session: string;
  };
  let speaking = false;
  const conversation = await Conversation.startSession({
    conversationToken,
    connectionType: "webrtc",
    customLlmExtraBody: { session },
    onModeChange: ({ mode }) => {
      speaking = mode === "speaking";
      handlers.onSpeaking(speaking);
    },
    onMessage: ({ role, message }) =>
      role === "agent" ? handlers.onReply(message) : handlers.onHeard(message),
    onDisconnect: () => handlers.onEnd(),
    onError: (message) => handlers.onError(message),
  });
  const meter = window.setInterval(() => {
    handlers.onLevel(speaking ? conversation.getOutputVolume() : conversation.getInputVolume());
  }, 80);
  return {
    async stop() {
      clearInterval(meter);
      handlers.onLevel(0);
      await conversation.endSession();
    },
  };
}
