import { writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { defineConfig } from "@playwright/test";

/**
 * A fake microphone that sounds like a turn: two seconds of voice-level tone,
 * then silence. Chromium's default beeps are too short to count as speech.
 */
function fakeSpeech(): string {
  const rate = 16_000;
  const samples = rate * 6;
  const wav = Buffer.alloc(44 + samples * 2);
  wav.write("RIFF", 0);
  wav.writeUInt32LE(36 + samples * 2, 4);
  wav.write("WAVEfmt ", 8);
  wav.writeUInt32LE(16, 16);
  wav.writeUInt16LE(1, 20);
  wav.writeUInt16LE(1, 22);
  wav.writeUInt32LE(rate, 24);
  wav.writeUInt32LE(rate * 2, 28);
  wav.writeUInt16LE(2, 32);
  wav.writeUInt16LE(16, 34);
  wav.write("data", 36);
  wav.writeUInt32LE(samples * 2, 40);
  for (let i = 0; i < rate * 2; i++) {
    wav.writeInt16LE(Math.round(Math.sin((2 * Math.PI * 220 * i) / rate) * 12_000), 44 + i * 2);
  }
  const file = join(tmpdir(), "persuna-fake-speech.wav");
  writeFileSync(file, wav);
  return file;
}

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
      args: [
        "--use-fake-device-for-media-stream",
        "--use-fake-ui-for-media-stream",
        `--use-file-for-fake-audio-capture=${fakeSpeech()}`,
      ],
    },
  },
  webServer: {
    // A production build: dev mode compiles each page on first visit, which is
    // slower than the test's waits and isn't what people run.
    command: "npm run build && npm run start -- --port 3110",
    url: "http://127.0.0.1:3110/api/health",
    timeout: 300_000,
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
      // Can't be blank, and does nothing without a speech key.
      ELEVENLABS_AGENT_ID: "none",
      VOICE_MODE: "transcribe",
      BETTER_AUTH_SECRET: "a-test-only-secret-for-the-browser-test",
      MODEL_PROVIDER: "mock",
      APP_URL: "http://127.0.0.1:3110",
      BETTER_AUTH_URL: "http://127.0.0.1:3110",
    } as Record<string, string>,
  },
});
