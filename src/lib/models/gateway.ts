import { z } from "zod";
import { env, modelConfig, type ModelRole, type ModelRoleConfig } from "@/env";

/**
 * Text, or (in user messages) text with images, a recording (base64 audio) or
 * an uploaded file (a PDF sent through the provider's Files API), as
 * OpenAI-style content parts.
 */
export type ContentPart =
  | { type: "text"; text: string }
  | { type: "input_audio"; input_audio: { data: string; format: "wav" | "mp3" } }
  | { type: "image_url"; image_url: { url: string } }
  | { type: "file"; file: { file_id: string; filename?: string } };

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
  /** Ask the provider for a guaranteed JSON object (response_format json_object). */
  json?: boolean;
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
  choices: z
    .array(
      z.object({
        message: z.object({ content: z.string().nullable() }),
        finish_reason: z.string().nullish(),
      }),
    )
    .min(1),
  usage: z
    .object({ prompt_tokens: z.number().optional(), completion_tokens: z.number().optional() })
    .optional(),
});

const RETRYABLE = new Set([408, 409, 429, 500, 502, 503, 504]);
/**
 * "Thinking" models can spend the whole token budget reasoning and return no
 * answer. Then the call is made once more with this much more room, up to the cap.
 */
export const THINKING_ROOM_FACTOR = 3;
export const MAX_TOKENS_CAP = 16_384;
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
        // Meta's API sometimes answers "model not found" for every model for a few
        // minutes. Calls that don't carry audio go to the DRAFT provider meanwhile.
        const backup = role === "draft" ? null : resolve("draft");
        if (
          error instanceof ModelError &&
          error.modelMissing &&
          backup &&
          backup.baseUrl !== own.baseUrl &&
          !hasAudio(messages)
        ) {
          console.warn(
            `[models] ${own.baseUrl} has no model right now; using DRAFT_* for this ${role} call.`,
          );
          return callOnce(
            { ...backup, reasoningEffort: undefined },
            role,
            messages,
            options,
            fetchImpl,
          );
        }
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

const hasAudio = (messages: ChatMessage[]) =>
  messages.some((m) => Array.isArray(m.content) && m.content.some((p) => p.type === "input_audio"));

async function callOnce(
  config: ModelRoleConfig,
  role: ModelRole,
  messages: ChatMessage[],
  options: CompleteOptions,
  fetchImpl: typeof fetch,
): Promise<Completion> {
  const maxTokens = options.maxTokens ?? 4096;
  const first = await postFindingModel(config, role, messages, options, maxTokens, fetchImpl);
  if (first.text.trim() || first.finish !== "length" || maxTokens >= MAX_TOKENS_CAP) {
    return first.completion;
  }
  // It thought until it ran out of room: once more, with more room.
  const roomier = Math.min(maxTokens * THINKING_ROOM_FACTOR, MAX_TOKENS_CAP);
  const second = await postFindingModel(config, role, messages, options, roomier, fetchImpl);
  return {
    ...second.completion,
    promptTokens: first.completion.promptTokens + second.completion.promptTokens,
    completionTokens: first.completion.completionTokens + second.completion.completionTokens,
  };
}

/**
 * Providers sometimes answer "model not found" (404) for a model they do
 * serve (seen on Meta's muse-spark-1.3). Try once more, then the role's
 * fallback model if one is set (*_FALLBACK_MODEL).
 */
async function postFindingModel(
  config: ModelRoleConfig,
  role: ModelRole,
  messages: ChatMessage[],
  options: CompleteOptions,
  maxTokens: number,
  fetchImpl: typeof fetch,
) {
  try {
    return await postKeepingEffort(config, role, messages, options, maxTokens, fetchImpl);
  } catch (error) {
    if (!(error instanceof ModelError) || !error.modelMissing) throw error;
    await backoff(1);
    try {
      return await postKeepingEffort(config, role, messages, options, maxTokens, fetchImpl);
    } catch (again) {
      if (!(again instanceof ModelError) || !again.modelMissing || !config.fallbackModel)
        throw again;
      console.warn(
        `[models] ${config.model} was not found at ${config.baseUrl}; using ${config.fallbackModel} for this ${role} call.`,
      );
      return postKeepingEffort(
        { ...config, model: config.fallbackModel },
        role,
        messages,
        options,
        maxTokens,
        fetchImpl,
      );
    }
  }
}

/**
 * Not every model takes every reasoning setting (Meta's muse-spark-1.2 has no
 * "max") or offers JSON mode. If the provider refuses either, ask again
 * without it rather than fail.
 */
async function postKeepingEffort(
  config: ModelRoleConfig,
  role: ModelRole,
  messages: ChatMessage[],
  options: CompleteOptions,
  maxTokens: number,
  fetchImpl: typeof fetch,
): ReturnType<typeof post> {
  try {
    return await post(config, role, messages, options, maxTokens, fetchImpl);
  } catch (error) {
    if (!(error instanceof ModelError)) throw error;
    if (error.effortRejected && config.reasoningEffort) {
      console.warn(
        `[models] ${config.model} doesn't accept reasoning_effort "${config.reasoningEffort}"; asking without it.`,
      );
      return postKeepingEffort(
        { ...config, reasoningEffort: undefined },
        role,
        messages,
        options,
        maxTokens,
        fetchImpl,
      );
    }
    if (error.jsonModeRejected && options.json) {
      // Without JSON mode, completeJson still parses and repairs the reply.
      console.warn(`[models] ${config.model} doesn't offer JSON mode; asking without it.`);
      return postKeepingEffort(
        config,
        role,
        messages,
        { ...options, json: false },
        maxTokens,
        fetchImpl,
      );
    }
    throw error;
  }
}

async function post(
  config: ModelRoleConfig,
  role: ModelRole,
  messages: ChatMessage[],
  options: CompleteOptions,
  maxTokens: number,
  fetchImpl: typeof fetch,
): Promise<{ completion: Completion; text: string; finish: string | null }> {
  const url = `${config.baseUrl.replace(/\/+$/, "")}/chat/completions`;
  const body = JSON.stringify({
    model: config.model,
    messages,
    temperature: options.temperature ?? 0,
    max_tokens: maxTokens,
    ...(config.reasoningEffort && { reasoning_effort: config.reasoningEffort }),
    ...(options.json && { response_format: { type: "json_object" } }),
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
        response.status === 404 && /model_not_found|model.*not.*found/i.test(detail),
        response.status === 400 && /reasoning_effort/i.test(detail),
        response.status === 400 && /response_format|json_object|json mode/i.test(detail),
      );
    }

    const parsed = completionResponse.safeParse(await response.json());
    if (!parsed.success) throw new ModelError(role, "unexpected response shape");
    const data = parsed.data;
    const text = data.choices[0].message.content ?? "";
    return {
      text,
      finish: data.choices[0].finish_reason ?? null,
      completion: {
        text,
        model: data.model ?? config.model,
        promptTokens: data.usage?.prompt_tokens ?? 0,
        completionTokens: data.usage?.completion_tokens ?? 0,
      },
    };
  }
}

export class ModelError extends Error {
  constructor(
    readonly role: ModelRole,
    message: string,
    /** The provider refused the API key (401/403). */
    readonly keyRejected = false,
    /** The provider said the model doesn't exist (404 model_not_found). */
    readonly modelMissing = false,
    /** The provider refused the reasoning_effort value for this model (400). */
    readonly effortRejected = false,
    /** The provider doesn't offer JSON mode for this model (400). */
    readonly jsonModeRejected = false,
  ) {
    super(`[${role} model] ${message}`);
    this.name = "ModelError";
  }
}

function backoff(attempt: number): Promise<void> {
  const ms = 500 * 2 ** (attempt - 1) + Math.random() * 250;
  return new Promise((resolve) => setTimeout(resolve, ms));
}
