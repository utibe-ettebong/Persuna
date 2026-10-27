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
    const own = (key: string) => setting(`${prefix}_${key}`);
    const resolved = rolePicker(prefix);
    return {
      role,
      prefix,
      baseUrl: resolved("BASE_URL") ?? null,
      model: resolved("MODEL") ?? null,
      /** A usable key is available, its own or EXTRACT_API_KEY. */
      keySet: Boolean(resolved("API_KEY")),
      /** This role has its own key rather than borrowing EXTRACT_*. */
      ownKey: Boolean(own("API_KEY")),
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
  const pick = rolePicker(PREFIX[role]);

  return parseOrThrow(
    roleSchema,
    { baseUrl: pick("BASE_URL"), apiKey: pick("API_KEY"), model: pick("MODEL") },
    `${PREFIX[role]}_* model settings`,
  );
}

/**
 * How a role resolves its settings:
 * - with its own key, it uses its own values (missing ones fall back to EXTRACT_*);
 * - with its own base URL but no key yet (another provider, slot not filled),
 *   it borrows EXTRACT_* as a whole, so that URL is never sent another provider's key;
 * - with neither, it is the same provider as EXTRACT_* and may still set its own model.
 */
function rolePicker(prefix: string) {
  const ownKey = Boolean(setting(`${prefix}_API_KEY`));
  const ownUrl = Boolean(setting(`${prefix}_BASE_URL`));
  return (key: "BASE_URL" | "API_KEY" | "MODEL") => {
    const own = setting(`${prefix}_${key}`);
    const fallback = setting(`EXTRACT_${key}`);
    if (ownKey) return own ?? fallback;
    if (!ownUrl && key === "MODEL") return own ?? fallback;
    return fallback;
  };
}

function parseOrThrow<T>(schema: z.ZodType<T>, input: unknown, label: string): T {
  const result = schema.safeParse(input);
  if (!result.success) {
    throw new Error(`Invalid ${label}:\n${z.prettifyError(result.error)}`);
  }
  return result.data;
}
