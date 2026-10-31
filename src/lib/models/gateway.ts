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
  /** Reason as little as the model allows, whatever the role configures: thinking delays the first word. */
  reasoningOff?: boolean;
  /**
   * Give up on each attempt after this long instead of MODEL_TIMEOUT_MS.
   * Interactive turns (Persuna chat) pass a short budget so a stuck provider
   * fails in seconds, not minutes; training keeps the long default.
   */
  timeoutMs?: number;
}

/**
 * The only thing the training engine knows about models. Tests pass a fake;
 * the app passes {@link createGateway}. Swapping providers never touches a skill.
 * Streaming is optional: callers that need it fall back to {@link complete}
 * when a client only answers whole replies.
 */
export interface ModelClient {
  complete(
    role: ModelRole,
    messages: ChatMessage[],
    options?: CompleteOptions,
  ): Promise<Completion>;
  completeStream?(
    role: ModelRole,
    messages: ChatMessage[],
    options?: CompleteOptions,
  ): AsyncGenerator<string, void, void>;
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

const streamChunk = z.object({
  choices: z
    .array(
      z.object({
        delta: z
          .object({
            content: z.string().nullish(),
            reasoning_content: z.string().nullish(),
            reasoning: z.string().nullish(),
          })
          .passthrough(),
        finish_reason: z.string().nullish(),
      }),
    )
    .optional(),
  usage: z
    .object({ prompt_tokens: z.number().optional(), completion_tokens: z.number().optional() })
    .optional(),
});

const streamError = z.object({ error: z.object({ message: z.string().optional() }).passthrough() });

const RETRYABLE = new Set([408, 409, 429, 500, 502, 503, 504]);
/**
 * "Thinking" models can spend the whole token budget reasoning and return no
 * answer. Then the call is made once more with this much more room, up to the cap.
 */
export const THINKING_ROOM_FACTOR = 3;
export const MAX_TOKENS_CAP = 16_384;
const MAX_ATTEMPTS = 3;

/**
 * After a provider answers "model not found" for every model, calls that have a
 * backup go straight to it for this long instead of failing through each retry.
 */
export const MODEL_OUTAGE_COOLDOWN_MS = 2 * 60_000;
/** Provider base URL to when its outage is next worth retrying. */
const outages = new Map<string, number>();

/** A role whose key was rejected is sent to the EXTRACT model for this long. */
export const REJECTED_KEY_COOLDOWN_MS = 10 * 60_000;
const rejected = new Map<string, number>();

export interface OutageEntry {
  kind: "outage" | "rejected-key";
  /** The base URL being skipped, or role:URL for a rejected key. */
  target: string;
  retryInSec: number;
}

/** Providers being skipped right now, for the Admin status line. */
export function outageStatus(now: number = Date.now()): OutageEntry[] {
  const skipped: OutageEntry[] = [];
  for (const [baseUrl, until] of outages) {
    if (until > now)
      skipped.push({
        kind: "outage",
        target: baseUrl,
        retryInSec: Math.ceil((until - now) / 1000),
      });
  }
  for (const [key, until] of rejected) {
    if (until > now)
      skipped.push({
        kind: "rejected-key",
        target: key,
        retryInSec: Math.ceil((until - now) / 1000),
      });
  }
  return skipped;
}

/**
 * OpenAI-compatible chat-completions client, configured per role from env.
 * If a role's provider rejects its key (401/403) and EXTRACT_* is a
 * different provider, the call is redone there, and that role keeps using
 * EXTRACT for a while, so one bad key degrades quality instead of breaking
 * the app. The failure is logged so the key gets fixed.
 */
export function createGateway(
  resolve: (role: ModelRole) => ModelRoleConfig | Promise<ModelRoleConfig> = modelConfig,
  fetchImpl: typeof fetch = fetch,
): ModelClient {
  return {
    async complete(role, messages, options = {}) {
      const own = await resolve(role);
      const fallback = role === "extract" ? null : await resolve("extract");
      const different =
        fallback && (fallback.baseUrl !== own.baseUrl || fallback.apiKey !== own.apiKey);
      const key = `${role}:${own.baseUrl}`;
      if (different && (rejected.get(key) ?? 0) > Date.now()) {
        return callOnce(fallback, role, messages, options, fetchImpl);
      }
      const backup = async () => {
        if (role === "draft" || hasAudio(messages)) return null;
        const config = await resolve("draft");
        return config.baseUrl === own.baseUrl ? null : { ...config, reasoningEffort: undefined };
      };
      if ((outages.get(own.baseUrl) ?? 0) > Date.now()) {
        const standIn = await backup();
        if (standIn) return callOnce(standIn, role, messages, options, fetchImpl);
      }
      try {
        return await callOnce(own, role, messages, options, fetchImpl);
      } catch (error) {
        // Meta's API sometimes answers "model not found" for every model for a few
        // minutes. Calls that don't carry audio go to the DRAFT provider meanwhile.
        const standIn = error instanceof ModelError && error.modelMissing ? await backup() : null;
        if (standIn) {
          console.warn(
            `[models] ${own.baseUrl} has no model right now; using DRAFT_* for this ${role} call.`,
          );
          outages.set(own.baseUrl, Date.now() + MODEL_OUTAGE_COOLDOWN_MS);
          return callOnce(standIn, role, messages, options, fetchImpl);
        }
        if (!(error instanceof ModelError) || !error.keyRejected || !different) throw error;
        console.warn(
          `[models] ${role} key was rejected by ${own.baseUrl}; using EXTRACT_* for ${role} for the next ${REJECTED_KEY_COOLDOWN_MS / 60_000} minutes. Fix ${role.toUpperCase()}_API_KEY.`,
        );
        rejected.set(key, Date.now() + REJECTED_KEY_COOLDOWN_MS);
        return callOnce(fallback, role, messages, options, fetchImpl);
      }
    },

    /**
     * Token stream for one completion. Retries and key-fallbacks only happen
     * before the first token; once text flows, errors surface to the caller.
     * Providers without SSE get one chunk with the whole reply, so callers
     * can always iterate. Same DRAFT backup as complete(), for the same outage:
     * a voice turn that fell back to transcribing has no audio left to carry.
     */
    async *completeStream(role, messages, options = {}) {
      const own = await resolve(role);
      const fallback = role === "extract" ? null : await resolve("extract");
      const different =
        fallback && (fallback.baseUrl !== own.baseUrl || fallback.apiKey !== own.apiKey);
      const key = `${role}:${own.baseUrl}`;
      if (different && (rejected.get(key) ?? 0) > Date.now()) {
        yield* streamOnce(fallback, role, messages, options, fetchImpl);
        return;
      }
      const backup = async () => {
        if (role === "draft" || hasAudio(messages)) return null;
        const config = await resolve("draft");
        return config.baseUrl === own.baseUrl ? null : { ...config, reasoningEffort: undefined };
      };
      if ((outages.get(own.baseUrl) ?? 0) > Date.now()) {
        const standIn = await backup();
        if (standIn) {
          yield* streamOnce(standIn, role, messages, options, fetchImpl);
          return;
        }
      }
      try {
        yield* streamOnce(own, role, messages, options, fetchImpl);
      } catch (error) {
        const standIn = error instanceof ModelError && error.modelMissing ? await backup() : null;
        if (standIn) {
          console.warn(
            `[models] ${own.baseUrl} has no model right now; using DRAFT_* for this ${role} call.`,
          );
          outages.set(own.baseUrl, Date.now() + MODEL_OUTAGE_COOLDOWN_MS);
          yield* streamOnce(standIn, role, messages, options, fetchImpl);
          return;
        }
        if (!(error instanceof ModelError) || !error.keyRejected || !different) throw error;
        console.warn(
          `[models] ${role} key was rejected by ${own.baseUrl}; using EXTRACT_* for ${role} for the next ${REJECTED_KEY_COOLDOWN_MS / 60_000} minutes. Fix ${role.toUpperCase()}_API_KEY.`,
        );
        rejected.set(key, Date.now() + REJECTED_KEY_COOLDOWN_MS);
        yield* streamOnce(fallback, role, messages, options, fetchImpl);
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
  const maxTokens = budgetFor(options);
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
 * The reasoning setting for a call. "As little as possible" has to be asked
 * for: left out, a model thinks for its default, seconds longer on Meta's.
 */
const effortFor = (config: ModelRoleConfig, options: CompleteOptions) =>
  options.reasoningOff ? "minimal" : config.reasoningEffort;

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
    const effort = effortFor(config, options);
    if (error.effortRejected && effort) {
      console.warn(
        `[models] ${config.model} doesn't accept reasoning_effort "${effort}"; asking without it.`,
      );
      return postKeepingEffort(
        { ...config, reasoningEffort: undefined },
        role,
        messages,
        { ...options, reasoningOff: false },
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
  const effort = effortFor(config, options);
  const body = JSON.stringify({
    model: config.model,
    messages,
    temperature: options.temperature ?? 0,
    max_tokens: maxTokens,
    ...(effort && { reasoning_effort: effort }),
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
        signal: AbortSignal.timeout(options.timeoutMs ?? env().MODEL_TIMEOUT_MS),
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
      throw await errorFor(role, response);
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

async function* streamOnce(
  config: ModelRoleConfig,
  role: ModelRole,
  messages: ChatMessage[],
  options: CompleteOptions,
  fetchImpl: typeof fetch,
): AsyncGenerator<string, void, void> {
  const maxTokens = budgetFor(options);
  // The wrappers below only retry errors thrown before the first token:
  // modelMissing, effortRejected, and jsonModeRejected all come from the
  // HTTP status, and the stream parser never sets those flags.
  try {
    yield* postStreamKeepingEffort(config, role, messages, options, maxTokens, fetchImpl);
  } catch (error) {
    if (!(error instanceof ModelError) || !error.modelMissing) throw error;
    await backoff(1);
    try {
      yield* postStreamKeepingEffort(config, role, messages, options, maxTokens, fetchImpl);
    } catch (again) {
      if (!(again instanceof ModelError) || !again.modelMissing || !config.fallbackModel) {
        throw again;
      }
      console.warn(`[models] ${config.model} is missing; using ${config.fallbackModel}.`);
      yield* postStreamKeepingEffort(
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

async function* postStreamKeepingEffort(
  config: ModelRoleConfig,
  role: ModelRole,
  messages: ChatMessage[],
  options: CompleteOptions,
  maxTokens: number,
  fetchImpl: typeof fetch,
): AsyncGenerator<string, void, void> {
  try {
    yield* postStream(config, role, messages, options, maxTokens, fetchImpl);
  } catch (error) {
    if (!(error instanceof ModelError)) throw error;
    if (error.effortRejected && effortFor(config, options)) {
      console.warn(`[models] ${config.model} refused reasoning_effort; retrying without it.`);
      yield* postStream(
        { ...config, reasoningEffort: undefined },
        role,
        messages,
        { ...options, reasoningOff: false },
        maxTokens,
        fetchImpl,
      );
      return;
    }
    if (error.jsonModeRejected && options.json) {
      console.warn(`[models] ${config.model} doesn't offer JSON mode; asking without it.`);
      yield* postStream(config, role, messages, { ...options, json: false }, maxTokens, fetchImpl);
      return;
    }
    throw error;
  }
}

async function* postStream(
  config: ModelRoleConfig,
  role: ModelRole,
  messages: ChatMessage[],
  options: CompleteOptions,
  maxTokens: number,
  fetchImpl: typeof fetch,
): AsyncGenerator<string, void, void> {
  const url = `${config.baseUrl.replace(/\/+$/, "")}/chat/completions`;
  let tokens = maxTokens;
  for (;;) {
    const response = await fetchStreamAttempt(
      config,
      role,
      messages,
      options,
      tokens,
      fetchImpl,
      url,
    );
    if (!isSSE(response)) {
      const parsed = completionResponse.safeParse(await response.json());
      if (!parsed.success) throw new ModelError(role, "unexpected response shape");
      const text = parsed.data.choices[0].message.content ?? "";
      const finish = parsed.data.choices[0].finish_reason ?? null;
      if (text === "" && finish === "length" && tokens < MAX_TOKENS_CAP) {
        tokens = Math.min(tokens * THINKING_ROOM_FACTOR, MAX_TOKENS_CAP);
        continue;
      }
      if (text) yield text;
      return;
    }
    if (!response.body) throw new ModelError(role, "empty stream body");
    const summary = yield* drain(response.body, role);
    if (summary.empty && summary.finish === "length" && tokens < MAX_TOKENS_CAP) {
      tokens = Math.min(tokens * THINKING_ROOM_FACTOR, MAX_TOKENS_CAP);
      continue;
    }
    return;
  }
}

async function fetchStreamAttempt(
  config: ModelRoleConfig,
  role: ModelRole,
  messages: ChatMessage[],
  options: CompleteOptions,
  tokens: number,
  fetchImpl: typeof fetch,
  url: string,
): Promise<Response> {
  // No stream_options: usage comes from the non-streaming path, and extra
  // flags are one more thing a provider can reject.
  let wantStream = true;
  const effort = effortFor(config, options);
  for (let attempt = 1; ; attempt++) {
    const body = JSON.stringify({
      model: config.model,
      messages,
      temperature: options.temperature ?? 0,
      max_tokens: tokens,
      ...(effort && { reasoning_effort: effort }),
      ...(options.json && { response_format: { type: "json_object" } }),
      ...(wantStream && { stream: true }),
    });
    let response: Response;
    try {
      response = await fetchImpl(url, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${config.apiKey}`,
        },
        body,
        signal: AbortSignal.timeout(options.timeoutMs ?? env().MODEL_TIMEOUT_MS),
      });
    } catch (error) {
      if (attempt < MAX_ATTEMPTS) {
        await backoff(attempt);
        continue;
      }
      throw new ModelError(role, `request failed: ${(error as Error).message}`);
    }
    if (response.ok) return response;
    if (RETRYABLE.has(response.status) && attempt < MAX_ATTEMPTS) {
      await backoff(attempt);
      continue;
    }
    if (wantStream && response.status === 400 && (await rejectsStream(response))) {
      wantStream = false;
      continue;
    }
    throw await errorFor(role, response);
  }
}

/** True when a 400 body reads as "I don't do streaming", not another error. */
async function rejectsStream(response: Response): Promise<boolean> {
  const peek = await response.clone().text();
  return (
    /stream/i.test(peek) &&
    /not supported|unknown|unexpected|invalid|unrecogni[sz]ed|not allowed|unsupported/i.test(peek)
  );
}

const isSSE = (response: Response) =>
  response.headers.get("content-type")?.includes("text/event-stream") ?? false;

/**
 * Reads SSE events into text chunks. Reasoning deltas are dropped so spoken
 * replies never leak thinking. Mid-stream errors throw a plain ModelError:
 * deliberately no flags, so the retry wrappers above never refire mid-stream.
 */
async function* drain(
  body: ReadableStream<Uint8Array>,
  role: ModelRole,
): AsyncGenerator<string, { empty: boolean; finish: string | null }, void> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buf = "";
  let text = "";
  let finish: string | null = null;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (value) buf += decoder.decode(value, { stream: true });
      if (done) buf += decoder.decode();
      let idx: number;
      while ((idx = buf.indexOf("\n\n")) >= 0) {
        const event = parseEvent(buf.slice(0, idx), role);
        buf = buf.slice(idx + 2);
        if (event.text) {
          text += event.text;
          yield event.text;
        }
        if (event.finish) finish = event.finish;
        if (event.end) return { empty: text === "", finish };
      }
      if (done) {
        if (buf.trim()) {
          const event = parseEvent(buf, role);
          if (event.text) {
            text += event.text;
            yield event.text;
          }
          if (event.finish) finish = event.finish;
        }
        return { empty: text === "", finish };
      }
    }
  } finally {
    reader.releaseLock();
  }
}

function parseEvent(
  raw: string,
  role: ModelRole,
): { text: string; finish: string | null; end: boolean } {
  let text = "";
  let finish: string | null = null;
  let end = false;
  const lines = raw
    .split("\n")
    .filter((line) => line.startsWith("data:"))
    .map((line) => line.slice("data:".length).trim());
  for (const line of lines) {
    if (line === "[DONE]") {
      end = true;
      continue;
    }
    let json: unknown;
    try {
      json = JSON.parse(line);
    } catch {
      console.warn("[models] skipping an unreadable stream line.");
      continue;
    }
    const failed = streamError.safeParse(json);
    if (failed.success) {
      throw new ModelError(role, `stream error: ${failed.data.error.message ?? "unknown"}`);
    }
    const chunk = streamChunk.safeParse(json);
    if (!chunk.success) {
      console.warn("[models] skipping an unexpected stream line.");
      continue;
    }
    const choice = chunk.data.choices?.[0];
    if (!choice) continue;
    text += choice.delta.content ?? "";
    if (choice.finish_reason) finish = choice.finish_reason;
  }
  return { text, finish, end };
}

async function errorFor(role: ModelRole, response: Response): Promise<ModelError> {
  // Provider error bodies can echo the request; keep only a short prefix.
  const detail = (await response.text()).slice(0, 300);
  return new ModelError(
    role,
    `HTTP ${response.status}: ${detail}`,
    response.status === 401 || response.status === 403,
    response.status === 404 && /model_not_found|model.*not.*found/i.test(detail),
    response.status === 400 && /reasoning_effort/i.test(detail),
    response.status === 400 && /response_format|json_object|json mode/i.test(detail),
  );
}

const budgetFor = (options: CompleteOptions) => options.maxTokens ?? 4096;

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
