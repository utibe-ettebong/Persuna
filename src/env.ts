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
  APP_PASSWORD: z.string().min(8).optional(),
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
  return process.env.EXTRACT_API_KEY ? "live" : "mock";
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
  const pick = (key: "BASE_URL" | "API_KEY" | "MODEL") =>
    process.env[`TRANSCRIBE_${key}`] || process.env[`EXTRACT_${key}`];
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
  const pick = (key: "BASE_URL" | "API_KEY" | "MODEL") =>
    process.env[`${PREFIX[role]}_${key}`] || process.env[`EXTRACT_${key}`];

  return parseOrThrow(
    roleSchema,
    { baseUrl: pick("BASE_URL"), apiKey: pick("API_KEY"), model: pick("MODEL") },
    `${PREFIX[role]}_* model settings`,
  );
}

function parseOrThrow<T>(schema: z.ZodType<T>, input: unknown, label: string): T {
  const result = schema.safeParse(input);
  if (!result.success) {
    throw new Error(`Invalid ${label}:\n${z.prettifyError(result.error)}`);
  }
  return result.data;
}
