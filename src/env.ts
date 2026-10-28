import { z } from "zod";

/**
 * Server-side environment, validated once on first use.
 *
 * Each model role (extract, draft, evaluate) talks to an OpenAI-compatible
 * chat-completions endpoint. DRAFT_* and EVAL_* fall back to EXTRACT_* so a
 * single provider key is enough to run the whole loop.
 */
const roleSchema = z.object({
  baseUrl: z.url(),
  apiKey: z.string().min(1),
  model: z.string().min(1),
  /**
   * For "thinking" models: how hard to think before answering (sent as
   * reasoning_effort). Unset sends nothing, which every provider accepts.
   */
  reasoningEffort: z.enum(["none", "low", "medium", "high"]).optional(),
  /** Another model on the same provider, used when this one is "not found" (404). */
  fallbackModel: z.string().min(1).optional(),
});

export type ModelRoleConfig = z.infer<typeof roleSchema>;
export type ModelRole = "extract" | "draft" | "evaluate";

const envSchema = z.object({
  DATABASE_URL: z.string().min(1),
  /** Signs session cookies. Required in production; at least 32 characters. */
  BETTER_AUTH_SECRET: z.string().min(32).optional(),
  MODEL_CONCURRENCY: z.coerce.number().int().min(1).max(20).default(5),
  MODEL_TIMEOUT_MS: z.coerce.number().int().min(1000).default(180_000),
  MODEL_PROVIDER: z.enum(["live", "mock"]).optional(),
  JOB_RETENTION_DAYS: z.coerce.number().int().min(1).max(365).default(30),
  PLATFORM_FEE_PERCENT: z.coerce.number().min(0).max(50).default(20),
  LISTING_MIN_SCORE: z.coerce.number().min(0).max(100).default(80),
  /** Live model calls each signed-in user may make per 24 hours. Admins are exempt. */
  DAILY_MODEL_CALLS_PER_USER: z.coerce.number().int().min(1).default(150),
  TRUST_L1_MIN_JOBS: z.coerce.number().int().min(1).default(20),
  TRUST_L1_MIN_CLEAN_PERCENT: z.coerce.number().min(0).max(100).default(90),
  TRUST_L2_MIN_JOBS: z.coerce.number().int().min(1).default(50),
  TRUST_SPOT_CHECK_EVERY: z.coerce.number().int().min(2).default(5),
  /** "paystack" collects real payments; "mock" records them without moving money. */
  PAYMENTS_PROVIDER: z.enum(["mock", "paystack"]).default("mock"),
  PAYSTACK_SECRET_KEY: z.string().min(10).optional(),
  /** Public base URL, used for payment callbacks and employer approval links. */
  APP_URL: z.url().optional(),
});

type Env = z.infer<typeof envSchema>;

let cached: Env | undefined;

export function env(): Env {
  cached ??= parseOrThrow(envSchema, process.env, "environment");
  return cached;
}

/**
 * "mock" runs the offline stand-in models. It is the default when no
 * EXTRACT_API_KEY is set, so the app works before any provider is configured.
 */
export function modelProvider(): "live" | "mock" {
  // Read directly (not via env()) so the layout can call it without a database URL.
  const explicit = process.env.MODEL_PROVIDER;
  if (explicit === "live" || explicit === "mock") return explicit;
  return setting("EXTRACT_API_KEY") ? "live" : "mock";
}

/**
 * Values like "PASTE_META_API_KEY_HERE" mark a slot waiting for a real key.
 * They count as unset, so the app stays on mock models until a key is pasted.
 */
export function isPlaceholder(value: string | undefined): boolean {
  return !value?.trim() || /^(paste|replace|add|your|todo|changeme)[_\s-]/i.test(value.trim());
}

/** An environment value, or undefined when it is empty or a placeholder. */
export function setting(name: string): string | undefined {
  const value = process.env[name];
  return isPlaceholder(value) ? undefined : value!.trim();
}

const ROLE_PREFIXES = {
  extract: "EXTRACT",
  draft: "DRAFT",
  evaluate: "EVAL",
  transcribe: "TRANSCRIBE",
} as const;

/** What each model role will use, without exposing keys. For the Models & keys page. */
export function modelSettingsStatus() {
  return (Object.keys(ROLE_PREFIXES) as (keyof typeof ROLE_PREFIXES)[]).map((role) => {
    const prefix = ROLE_PREFIXES[role];
    const resolved = rolePicker(prefix);
    return {
      role,
      prefix,
      baseUrl: resolved("BASE_URL") ?? null,
      model: resolved("MODEL") ?? null,
      /** A usable key is available, its own or EXTRACT_API_KEY. */
      keySet: Boolean(resolved("API_KEY")),
      /** This role has its own key rather than borrowing EXTRACT_*. */
      ownKey: Boolean(roleKey(prefix)),
    };
  });
}

const PREFIX: Record<ModelRole, string> = {
  extract: "EXTRACT",
  draft: "DRAFT",
  evaluate: "EVAL",
};

/**
 * Speech-to-text (Muse Voice Transcribe): an OpenAI-compatible
 * POST {base}/audio/transcriptions endpoint. Falls back to EXTRACT_*.
 */
export function transcriptionConfig(): ModelRoleConfig {
  const pick = rolePicker("TRANSCRIBE");
  return parseOrThrow(
    roleSchema,
    { baseUrl: pick("BASE_URL"), apiKey: pick("API_KEY"), model: pick("MODEL") },
    "TRANSCRIBE_* settings",
  );
}

export interface SpeechConfig {
  api: "openai" | "elevenlabs";
  baseUrl: string;
  apiKey: string;
  model: string;
  voice: string;
}

/**
 * Persona's cloud voice (text to speech), or null when no SPEECH_API_KEY is
 * set, in which case the browser's own voice is used. Two API shapes:
 * OpenAI-compatible POST {base}/audio/speech (OpenAI, and the many servers
 * that copy it), or ElevenLabs. ElevenLabs is chosen when SPEECH_API=elevenlabs
 * or the base URL is api.elevenlabs.io.
 */
export function speechConfig(): SpeechConfig | null {
  const apiKey = setting("SPEECH_API_KEY");
  if (!apiKey) return null;
  const explicit = setting("SPEECH_API");
  const base = setting("SPEECH_BASE_URL");
  const api =
    explicit === "elevenlabs" || (!explicit && /api\.elevenlabs\.io/i.test(base ?? ""))
      ? "elevenlabs"
      : "openai";
  return api === "elevenlabs"
    ? {
        api,
        apiKey,
        baseUrl: (base ?? "https://api.elevenlabs.io/v1").replace(/\/+$/, ""),
        model: setting("SPEECH_MODEL") ?? "eleven_flash_v2_5",
        // "Rachel", one of ElevenLabs' default voices.
        voice: setting("SPEECH_VOICE") ?? "21m00Tcm4TlvDq8ikWAM",
      }
    : {
        api,
        apiKey,
        baseUrl: (base ?? "https://api.openai.com/v1").replace(/\/+$/, ""),
        model: setting("SPEECH_MODEL") ?? "gpt-4o-mini-tts",
        voice: setting("SPEECH_VOICE") ?? "nova",
      };
}

/** Settings for real payments, validated only when Paystack is switched on. */
export function paystackConfig() {
  const e = env();
  if (e.PAYMENTS_PROVIDER !== "paystack") return null;
  if (!e.PAYSTACK_SECRET_KEY || !e.APP_URL) {
    throw new Error("PAYMENTS_PROVIDER=paystack needs PAYSTACK_SECRET_KEY and APP_URL");
  }
  return { secretKey: e.PAYSTACK_SECRET_KEY, appUrl: e.APP_URL.replace(/\/+$/, "") };
}

export function trustThresholds() {
  const e = env();
  return {
    level1MinJobs: e.TRUST_L1_MIN_JOBS,
    level1MinCleanRate: e.TRUST_L1_MIN_CLEAN_PERCENT,
    level2MinJobs: e.TRUST_L2_MIN_JOBS,
    spotCheckEvery: e.TRUST_SPOT_CHECK_EVERY,
  };
}

export function modelConfig(role: ModelRole): ModelRoleConfig {
  const prefix = PREFIX[role];
  const pick = rolePicker(prefix);
  // A role that borrows EXTRACT's provider also takes its reasoning setting,
  // so a setting meant for one provider is never sent to another.
  const own = roleKey(prefix) ? prefix : "EXTRACT";
  const effort = setting(`${own}_REASONING_EFFORT`);

  return parseOrThrow(
    roleSchema,
    {
      baseUrl: pick("BASE_URL"),
      apiKey: pick("API_KEY"),
      model: pick("MODEL"),
      reasoningEffort: effort?.toLowerCase(),
      fallbackModel: setting(`${own}_FALLBACK_MODEL`),
    },
    `${prefix}_* model settings`,
  );
}

/**
 * How a role resolves its settings:
 * - with a key (its own, or one from another role on the same base URL, so
 *   one Baseten key covers drafting and scoring), it uses its own values,
 *   with missing ones falling back to EXTRACT_*;
 * - with its own base URL but no key for it, it borrows EXTRACT_* as a whole,
 *   so that URL is never sent another provider's key;
 * - with neither, it is the same provider as EXTRACT_* and may still set its own model.
 */
function rolePicker(prefix: string) {
  const key = roleKey(prefix);
  const ownUrl = Boolean(setting(`${prefix}_BASE_URL`));
  return (field: "BASE_URL" | "API_KEY" | "MODEL") => {
    const own = field === "API_KEY" ? key : setting(`${prefix}_${field}`);
    const fallback = setting(`EXTRACT_${field}`);
    if (key) return own ?? fallback;
    if (!ownUrl && field === "MODEL") return own ?? fallback;
    return fallback;
  };
}

const ALL_PREFIXES = ["EXTRACT", "DRAFT", "EVAL", "TRANSCRIBE"];

/** A role's own key, or the key of another role configured for the same base URL. */
function roleKey(prefix: string): string | undefined {
  const own = setting(`${prefix}_API_KEY`);
  const url = normaliseUrl(setting(`${prefix}_BASE_URL`));
  if (own || !url) return own;
  for (const other of ALL_PREFIXES) {
    if (other === prefix) continue;
    const otherKey = setting(`${other}_API_KEY`);
    if (otherKey && normaliseUrl(setting(`${other}_BASE_URL`)) === url) return otherKey;
  }
  return undefined;
}

const normaliseUrl = (url: string | undefined) => url?.replace(/\/+$/, "").toLowerCase();

function parseOrThrow<T>(schema: z.ZodType<T>, input: unknown, label: string): T {
  const result = schema.safeParse(input);
  if (!result.success) {
    throw new Error(`Invalid ${label}:\n${z.prettifyError(result.error)}`);
  }
  return result.data;
}
