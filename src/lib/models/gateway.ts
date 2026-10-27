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

/** OpenAI-compatible chat-completions client, configured per role from env. */
export function createGateway(
  resolve: (role: ModelRole) => ModelRoleConfig = modelConfig,
  fetchImpl: typeof fetch = fetch,
): ModelClient {
  return {
    async complete(role, messages, options = {}) {
      const config = resolve(role);
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
          throw new ModelError(role, `HTTP ${response.status}: ${detail}`);
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
    },
  };
}

export class ModelError extends Error {
  constructor(
    readonly role: ModelRole,
    message: string,
  ) {
    super(`[${role} model] ${message}`);
    this.name = "ModelError";
  }
}

function backoff(attempt: number): Promise<void> {
  const ms = 500 * 2 ** (attempt - 1) + Math.random() * 250;
  return new Promise((resolve) => setTimeout(resolve, ms));
}
