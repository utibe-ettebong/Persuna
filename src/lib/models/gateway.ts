import { z } from "zod";
import { env, modelConfig, type ModelRole, type ModelRoleConfig } from "@/env";

/** Text, or (in user messages) text and images, as OpenAI-style content parts. */
export type ContentPart =
  { type: "text"; text: string } | { type: "image_url"; image_url: { url: string } };

export interface ChatMessage {
  role: "system" | "user" | "assistant";
  content: string | ContentPart[];
}

/** The text of a message, ignoring any images. */
export function textOf(content: ChatMessage["content"]): string {
  return typeof content === "string"
    ? content
    : content.map((p) => (p.type === "text" ? p.text : "")).join("\n");
}

export interface Completion {
  text: string;
  model: string;
  promptTokens: number;
  completionTokens: number;
}

export interface CompleteOptions {
  temperature?: number;
  maxTokens?: number;
}

/**
 * The only thing the training engine knows about models. Tests pass a fake;
 * the app passes {@link createGateway}. Swapping providers never touches a skill.
 */
export interface ModelClient {
  complete(
    role: ModelRole,
    messages: ChatMessage[],
    options?: CompleteOptions,
  ): Promise<Completion>;
}

const completionResponse = z.object({
  model: z.string().optional(),
  choices: z.array(z.object({ message: z.object({ content: z.string().nullable() }) })).min(1),
  usage: z
    .object({ prompt_tokens: z.number().optional(), completion_tokens: z.number().optional() })
    .optional(),
});

const RETRYABLE = new Set([408, 409, 429, 500, 502, 503, 504]);
const MAX_ATTEMPTS = 3;

/** A role whose key was rejected is sent to the EXTRACT model for this long. */
export const REJECTED_KEY_COOLDOWN_MS = 10 * 60_000;
const rejected = new Map<string, number>();

/**
 * OpenAI-compatible chat-completions client, configured per role from env.
 * If a role's provider rejects its key (401/403) and EXTRACT_* is a
 * different provider, the call is redone there, and that role keeps using
 * EXTRACT for a while, so one bad key degrades quality instead of breaking
 * the app. The failure is logged so the key gets fixed.
 */
export function createGateway(
  resolve: (role: ModelRole) => ModelRoleConfig = modelConfig,
  fetchImpl: typeof fetch = fetch,
): ModelClient {
  return {
    async complete(role, messages, options = {}) {
      const own = resolve(role);
      const fallback = role === "extract" ? null : resolve("extract");
      const different =
        fallback && (fallback.baseUrl !== own.baseUrl || fallback.apiKey !== own.apiKey);
      const key = `${role}:${own.baseUrl}`;
      if (different && (rejected.get(key) ?? 0) > Date.now()) {
        return callOnce(fallback, role, messages, options, fetchImpl);
      }
      try {
        return await callOnce(own, role, messages, options, fetchImpl);
      } catch (error) {
        if (!(error instanceof ModelError) || !error.keyRejected || !different) throw error;
        console.warn(
          `[models] ${role} key was rejected by ${own.baseUrl}; using EXTRACT_* for ${role} for the next ${REJECTED_KEY_COOLDOWN_MS / 60_000} minutes. Fix ${role.toUpperCase()}_API_KEY.`,
        );
        rejected.set(key, Date.now() + REJECTED_KEY_COOLDOWN_MS);
        return callOnce(fallback, role, messages, options, fetchImpl);
      }
    },
  };
}

async function callOnce(
  config: ModelRoleConfig,
  role: ModelRole,
  messages: ChatMessage[],
  options: CompleteOptions,
  fetchImpl: typeof fetch,
): Promise<Completion> {
  const url = `${config.baseUrl.replace(/\/+$/, "")}/chat/completions`;
  const body = JSON.stringify({
    model: config.model,
    messages,
    temperature: options.temperature ?? 0,
    max_tokens: options.maxTokens ?? 4096,
  });

  for (let attempt = 1; ; attempt++) {
    let response: Response;
    try {
      response = await fetchImpl(url, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${config.apiKey}`,
        },
        body,
        signal: AbortSignal.timeout(env().MODEL_TIMEOUT_MS),
      });
    } catch (error) {
      if (attempt < MAX_ATTEMPTS) {
        await backoff(attempt);
        continue;
      }
      throw new ModelError(role, `request failed: ${(error as Error).message}`);
    }

    if (!response.ok) {
      if (RETRYABLE.has(response.status) && attempt < MAX_ATTEMPTS) {
        await backoff(attempt);
        continue;
      }
      // Provider error bodies can echo the request; keep only a short prefix.
      const detail = (await response.text()).slice(0, 300);
      throw new ModelError(
        role,
        `HTTP ${response.status}: ${detail}`,
        response.status === 401 || response.status === 403,
      );
    }

    const parsed = completionResponse.safeParse(await response.json());
    if (!parsed.success) throw new ModelError(role, "unexpected response shape");
    const data = parsed.data;
    return {
      text: data.choices[0].message.content ?? "",
      model: data.model ?? config.model,
      promptTokens: data.usage?.prompt_tokens ?? 0,
      completionTokens: data.usage?.completion_tokens ?? 0,
    };
  }
}

export class ModelError extends Error {
  constructor(
    readonly role: ModelRole,
    message: string,
    /** The provider refused the API key (401/403). */
    readonly keyRejected = false,
  ) {
    super(`[${role} model] ${message}`);
    this.name = "ModelError";
  }
}

function backoff(attempt: number): Promise<void> {
  const ms = 500 * 2 ** (attempt - 1) + Math.random() * 250;
  return new Promise((resolve) => setTimeout(resolve, ms));
}
