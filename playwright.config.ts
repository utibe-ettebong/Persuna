import { defineConfig } from "@playwright/test";

/**
 * Browser tests (plan §7): the voice path with a fake microphone, against
 * mock models. The server needs a database; CI provides Postgres and runs
 * migrations first. Locally: DATABASE_URL=... npx playwright test.
 */
export default defineConfig({
  testDir: "./e2e",
  timeout: 120_000,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? "github" : "list",
  use: {
    trace: "on-first-retry",
    baseURL: "http://127.0.0.1:3110",
    launchOptions: {
      args: ["--use-fake-device-for-media-stream", "--use-fake-ui-for-media-stream"],
    },
  },
  webServer: {
    command: "npm run dev -- --port 3110",
    url: "http://127.0.0.1:3110/api/health",
    timeout: 180_000,
    reuseExistingServer: !process.env.CI,
    env: {
      ...process.env,
      // Mock models, always: blank keys beat a developer's .env, so the test
      // never spends live calls or depends on providers.
      EXTRACT_API_KEY: "",
      DRAFT_API_KEY: "",
      EVAL_API_KEY: "",
      LISTEN_API_KEY: "",
      TRANSCRIBE_API_KEY: "",
      SPEECH_API_KEY: "",
      ELEVENLABS_AGENT_ID: "",
      VOICE_MODE: "transcribe",
      APP_URL: "http://127.0.0.1:3110",
      BETTER_AUTH_URL: "http://127.0.0.1:3110",
    } as Record<string, string>,
  },
});
