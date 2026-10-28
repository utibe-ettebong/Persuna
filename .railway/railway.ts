// Railway Infrastructure as Code. Preview with `railway config plan`,
// apply with `railway config apply`. Secrets are never written here: set them
// with `railway variables --set` and `preserve()` keeps whatever is in Railway.
import { defineRailway, github, postgres, preserve, project, service } from "railway/iac";

export default defineRailway(() => {
  const db = postgres("postgres");

  const web = service("Persuna", {
    source: github("utibe-ettebong/Persuna", { branch: "main" }),
    build: { builder: "RAILPACK", buildCommand: "npm run build" },
    deploy: {
      startCommand: "npm run start",
      preDeployCommand: ["npm run db:migrate"],
      healthcheckPath: "/api/health",
      healthcheckTimeout: 120,
      restartPolicyType: "ON_FAILURE",
      restartPolicyMaxRetries: 3,
    },
    env: {
      NODE_ENV: "production",
      DATABASE_URL: db.env.DATABASE_URL,
      BETTER_AUTH_SECRET: preserve(),
      BETTER_AUTH_URL: preserve(),
      ADMIN_EMAILS: preserve(),
      AUTH_ALLOWED_EMAILS: preserve(),
      MODEL_PROVIDER: preserve(),
      JOB_RETENTION_DAYS: preserve(),
      PLATFORM_FEE_PERCENT: preserve(),
      LISTING_MIN_SCORE: preserve(),
      DAILY_MODEL_CALLS_PER_USER: preserve(),
      PAYMENTS_PROVIDER: preserve(),
      PAYSTACK_SECRET_KEY: preserve(),
      APP_URL: preserve(),
      TRUST_L1_MIN_JOBS: preserve(),
      TRUST_L1_MIN_CLEAN_PERCENT: preserve(),
      TRUST_L2_MIN_JOBS: preserve(),
      TRUST_SPOT_CHECK_EVERY: preserve(),
      TRANSCRIBE_BASE_URL: preserve(),
      TRANSCRIBE_API_KEY: preserve(),
      TRANSCRIBE_MODEL: preserve(),
      TRANSCRIBE_API: preserve(),
      SPEECH_API: preserve(),
      SPEECH_BASE_URL: preserve(),
      SPEECH_API_KEY: preserve(),
      SPEECH_MODEL: preserve(),
      SPEECH_VOICE: preserve(),
      EXTRACT_BASE_URL: preserve(),
      EXTRACT_API_KEY: preserve(),
      EXTRACT_MODEL: preserve(),
      DRAFT_BASE_URL: preserve(),
      DRAFT_API_KEY: preserve(),
      DRAFT_MODEL: preserve(),
      EVAL_BASE_URL: preserve(),
      EVAL_API_KEY: preserve(),
      EVAL_MODEL: preserve(),
      EXTRACT_REASONING_EFFORT: preserve(),
      DRAFT_REASONING_EFFORT: preserve(),
      EVAL_REASONING_EFFORT: preserve(),
      EXTRACT_FALLBACK_MODEL: preserve(),
      DRAFT_FALLBACK_MODEL: preserve(),
      EVAL_FALLBACK_MODEL: preserve(),
    },
  });

  return project("persuna", { resources: [web, db] });
});
