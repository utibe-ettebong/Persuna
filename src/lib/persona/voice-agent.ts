/**
 * Persona's voice through ElevenLabs Agents (VOICE_MODE=agent). ElevenLabs
 * listens, knows when you've finished, lets you interrupt and speaks; for
 * every turn it calls Persona's own brain (/api/persona/llm), which runs the
 * same chat as typing does. Nothing about the user travels in the clear: the
 * browser gets a short-lived signed session token that ElevenLabs hands back
 * with each call.
 */
import { createHmac, timingSafeEqual } from "node:crypto";
import { agentConfig } from "@/env";
import { actorOf } from "@/lib/auth/session";
import { userById } from "@/lib/auth/users";
import { createModelClient } from "@/lib/models";
import { UsageLimitError } from "@/lib/models/usage";
import { utcToLocal } from "./when";
import { chat, type ChatResult } from "./service";

/** How long a voice session token is good for. */
export const SESSION_TTL_MS = 30 * 60_000;

/** Signs who is talking (and their UTC offset, for reminders) for one voice session. */
export function signSession(
  userId: string,
  offset: number,
  secret: string,
  now = Date.now(),
): string {
  const payload = Buffer.from(
    JSON.stringify({ u: userId, o: offset, e: now + SESSION_TTL_MS }),
  ).toString("base64url");
  return `${payload}.${mac(payload, secret)}`;
}

/** The user and offset from a session token, or null if it's forged or expired. */
export function readSession(
  token: unknown,
  secret: string,
  now = Date.now(),
): { userId: string; offset: number } | null {
  if (typeof token !== "string") return null;
  const [payload, signature] = token.split(".");
  if (!payload || !signature) return null;
  const expected = Buffer.from(mac(payload, secret));
  const given = Buffer.from(signature);
  if (expected.length !== given.length || !timingSafeEqual(expected, given)) return null;
  try {
    const { u, o, e } = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
    if (typeof u !== "string" || typeof o !== "number" || typeof e !== "number" || e < now)
      return null;
    return { userId: u, offset: o };
  } catch {
    return null;
  }
}

const mac = (payload: string, secret: string) =>
  createHmac("sha256", secret).update(payload).digest("base64url");

/** The latest thing the user said, from an OpenAI-style message list. */
export function lastUserText(messages: unknown): string {
  if (!Array.isArray(messages)) return "";
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i] as { role?: unknown; content?: unknown };
    if (m?.role !== "user") continue;
    if (typeof m.content === "string") return m.content.trim();
    if (Array.isArray(m.content)) {
      return m.content
        .map((p: { type?: unknown; text?: unknown }) =>
          p?.type === "text" && typeof p.text === "string" ? p.text : "",
        )
        .join(" ")
        .trim();
    }
    return "";
  }
  return "";
}

/** A reply as a Chat Completions stream (Server-Sent Events), which ElevenLabs reads. */
export function streamReply(text: string, model = "persuna"): string {
  const chunk = (delta: object, finish: string | null) =>
    `data: ${JSON.stringify({
      id: "persuna",
      object: "chat.completion.chunk",
      created: Math.floor(Date.now() / 1000),
      model,
      choices: [{ index: 0, delta, finish_reason: finish }],
    })}\n\n`;
  return chunk({ role: "assistant", content: text }, null) + chunk({}, "stop") + "data: [DONE]\n\n";
}

/*
 * What each spoken turn set up on screen (a card to fill in, a page to open,
 * watching to start). ElevenLabs only carries the words, so the page asks
 * for these after each reply. Kept in memory for a minute: one app instance.
 */
const TURN_TTL_MS = 60_000;
const turns = new Map<string, { at: number; result: ChatResult }[]>();

export function rememberTurn(userId: string, result: ChatResult, now = Date.now()) {
  const recent = (turns.get(userId) ?? []).filter((t) => now - t.at < TURN_TTL_MS);
  turns.set(userId, [...recent, { at: now, result }].slice(-5));
}

export function takeTurns(userId: string, now = Date.now()): ChatResult[] {
  const recent = (turns.get(userId) ?? []).filter((t) => now - t.at < TURN_TTL_MS);
  turns.delete(userId);
  return recent.map((t) => t.result);
}

/** Starts a voice session: an ElevenLabs conversation token plus Persona's own session token. */
export async function startAgentSession(
  userId: string,
  offset: number,
  fetchImpl: typeof fetch = fetch,
): Promise<{ conversationToken: string; session: string } | null> {
  const config = agentConfig();
  if (!config) return null;
  const res = await fetchImpl(
    `${config.baseUrl}/convai/conversation/token?agent_id=${encodeURIComponent(config.agentId)}`,
    { headers: { "xi-api-key": config.apiKey }, signal: AbortSignal.timeout(10_000) },
  );
  if (!res.ok) {
    throw new Error(`ElevenLabs didn't start a voice session: HTTP ${res.status}`);
  }
  const { token } = (await res.json()) as { token?: string };
  if (!token) throw new Error("ElevenLabs didn't start a voice session");
  return { conversationToken: token, session: signSession(userId, offset, config.llmSecret) };
}

/** Markdown and links read badly out loud: plain words for the voice. */
export function plainSpeech(text: string): string {
  return text
    .replace(/https?:\/\/\S+/g, "")
    .replace(/[*_`#>|]/g, "")
    .replace(/^\s*[•-]\s*/gm, "")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * One turn from ElevenLabs: check it's really ElevenLabs (the shared
 * secret) and who is talking (the session token), run the same chat as
 * typing, keep what it set up on screen for the page, and stream back the
 * words to say. Returns null when the call isn't allowed.
 */
export async function answerAgentCall(
  authorization: string | null,
  body: { messages?: unknown; elevenlabs_extra_body?: { session?: unknown } } | null,
  now = new Date(),
): Promise<string | null> {
  const config = agentConfig();
  if (!config || !body) return null;
  const expected = Buffer.from(`Bearer ${config.llmSecret}`);
  const given = Buffer.from(authorization ?? "");
  if (expected.length !== given.length || !timingSafeEqual(expected, given)) return null;
  const session = readSession(body.elevenlabs_extra_body?.session, config.llmSecret);
  const user = session && (await userById(session.userId));
  if (!session || !user) return null;

  const text = lastUserText(body.messages);
  if (!text) return streamReply("Sorry, I didn't catch that.");
  const local = utcToLocal(now, session.offset);
  try {
    const result = await chat(createModelClient(user), user.id, {
      text,
      clock: { day: local.slice(0, 10), now: local, offset: session.offset },
      actor: actorOf(user),
    });
    rememberTurn(user.id, result);
    return streamReply(plainSpeech(result.messages[1].content));
  } catch (error) {
    if (error instanceof UsageLimitError) return streamReply(error.message);
    console.error(error);
    return streamReply("Sorry, something went wrong on my side. Try again?");
  }
}

/**
 * Creates the ElevenLabs agent (or updates it when ELEVENLABS_AGENT_ID is
 * set): Persona's brain at {appUrl}/api/persona/llm, the cloud voice, quick
 * turn taking, and sign-in required. The shared secret is stored in
 * ElevenLabs as a workspace secret. Returns the agent id.
 */
export async function setUpAgent(
  input: {
    appUrl: string;
    apiKey: string;
    baseUrl: string;
    voice: string;
    llmSecret: string;
    agentId?: string;
  },
  fetchImpl: typeof fetch = fetch,
): Promise<string> {
  const call = async (path: string, method: string, body: unknown) => {
    const res = await fetchImpl(`${input.baseUrl}${path}`, {
      method,
      headers: { "xi-api-key": input.apiKey, "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    if (!res.ok)
      throw new Error(
        `ElevenLabs ${method} ${path}: HTTP ${res.status} ${(await res.text()).slice(0, 300)}`,
      );
    return res.json() as Promise<Record<string, string>>;
  };
  const { secret_id } = await call("/convai/secrets", "POST", {
    type: "new",
    name: `persuna-llm-${Date.now()}`,
    value: input.llmSecret,
  });
  const agent = {
    name: "Persuna",
    conversation_config: {
      agent: {
        first_message: "",
        language: "en",
        prompt: {
          // Persona's own server holds the real instructions; this is never used.
          prompt: "You are Persuna, a personal assistant.",
          llm: "custom-llm",
          custom_llm: {
            url: `${input.appUrl.replace(/\/+$/, "")}/api/persona/llm`,
            model_id: "persuna",
            api_key: { secret_id },
            api_type: "chat_completions",
          },
        },
      },
      tts: { voice_id: input.voice, model_id: "eleven_flash_v2_5" },
      turn: { turn_eagerness: "eager", turn_timeout: 10 },
      conversation: { max_duration_seconds: 900 },
    },
    platform_settings: {
      auth: { enable_auth: true },
      overrides: { custom_llm_extra_body: true },
    },
  };
  if (input.agentId) {
    await call(`/convai/agents/${encodeURIComponent(input.agentId)}`, "PATCH", agent);
    return input.agentId;
  }
  const { agent_id } = await call("/convai/agents/create", "POST", agent);
  return agent_id;
}
