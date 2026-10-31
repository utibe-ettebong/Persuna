/**
 * Voice latency probe: times streamed turns against the live models and
 * estimates end-of-speech to first-sound. Text turns exercise the draft
 * role; one spoken turn exercises the listen role, using Persuna's own
 * voice (converted with ffmpeg) as the recording.
 *
 *   npm run voice:latency -- [--turns 5] [--budget-ms 8000] [--skip-audio]
 *
 * Needs live MODEL keys and a configured speaker. Exits 1 when a turn never
 * streams (its first sentence only arrives at the end) or when the p95
 * estimate passes --budget-ms. The budget guards the restructure against
 * regressions; the sub-second target needs the realtime trial, which this
 * script also measures once it lands.
 */
import { execFile } from "node:child_process";
import { parseArgs } from "node:util";
import { promisify } from "node:util";
import { modelProvider } from "@/env";
import { createModelClient, createSpeaker } from "@/lib/models";
import { persunaTurnStream } from "@/lib/persuna/brain";
import type { PersunaState } from "@/lib/persuna/types";

const runFile = promisify(execFile);

const { values } = parseArgs({
  options: {
    turns: { type: "string", default: "5" },
    "budget-ms": { type: "string", default: "8000" },
    "skip-audio": { type: "boolean", default: false },
  },
});
const TURNS = Math.max(1, Number.parseInt(values.turns, 10) || 5);
const BUDGET_MS = Number.parseInt(values["budget-ms"], 10) || 8000;

const PROMPTS = [
  "What time is it?",
  "Remind me to stretch.",
  "How are you today?",
  "Tell me a one-line joke.",
  "What should I focus on first?",
];

const state = (): PersunaState => ({
  today: "2026-10-27",
  now: "2026-10-27T10:15",
  name: "Persuna",
  memory: [],
  focus: null,
  focusSkill: null,
  skills: [],
  mcpServers: [],
  todos: [],
  tone: {},
  lastAsked: null,
  pendingSwitch: null,
  workMode: false,
});

interface Sample {
  kind: string;
  firstToken: number;
  firstSentence: number;
  firstText: string;
  end: number;
  sentences: number;
  malformed: boolean;
  heard?: string;
}

async function streamTurn(kind: string, message: string | { audio: string }): Promise<Sample> {
  const client = createModelClient();
  const t0 = performance.now();
  let firstToken = -1;
  let firstSentence = -1;
  let firstText = "";
  let sentences = 0;
  let malformed = false;
  let heard: string | undefined;
  for await (const event of persunaTurnStream(client, state(), [], message)) {
    const at = Math.round(performance.now() - t0);
    if (event.type === "started") firstToken = at;
    else if (event.type === "heard") heard = event.text;
    else if (event.type === "sentence") {
      sentences++;
      if (firstSentence < 0) {
        firstSentence = at;
        firstText = event.text;
      }
    } else if (event.type === "malformed-tail") malformed = true;
  }
  return {
    kind,
    firstToken,
    firstSentence,
    firstText,
    end: Math.round(performance.now() - t0),
    sentences,
    malformed,
    heard,
  };
}

async function collect(stream: ReadableStream<Uint8Array>): Promise<Buffer> {
  const reader = stream.getReader();
  const chunks: Uint8Array[] = [];
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
  }
  return Buffer.concat(chunks);
}

async function ffmpegToWav(mp3: Buffer): Promise<Buffer> {
  const { stdout } = await runFile(
    "ffmpeg",
    [
      "-hide_banner",
      "-loglevel",
      "error",
      "-i",
      "pipe:0",
      "-ar",
      "16000",
      "-ac",
      "1",
      "-f",
      "wav",
      "pipe:1",
    ],
    {
      encoding: "buffer",
      maxBuffer: 32 * 1024 * 1024,
      input: mp3,
    } as { encoding: "buffer"; maxBuffer: number; input: Buffer },
  );
  return stdout;
}

const percentile = (sorted: number[], q: number) =>
  sorted[Math.min(sorted.length - 1, Math.ceil((q / 100) * sorted.length) - 1)];

const main = async () => {
  if (modelProvider() === "mock") {
    console.error("voice:latency needs live MODEL keys (MODEL_PROVIDER=mock answers instantly).");
    process.exit(2);
  }
  const speaker = createSpeaker();
  if (!speaker) {
    console.error("voice:latency needs a configured speaker (SPEECH_* or ElevenLabs).");
    process.exit(2);
  }

  const samples: Sample[] = [];
  for (let i = 0; i < TURNS; i++) {
    const prompt = PROMPTS[i % PROMPTS.length];
    const sample = await streamTurn(`text ${i + 1} (${JSON.stringify(prompt)})`, prompt);
    samples.push(sample);
    console.log(
      `${sample.kind}: first-token=${sample.firstToken}ms first-sentence=${sample.firstSentence}ms ` +
        `end=${sample.end}ms sentences=${sample.sentences}${sample.malformed ? " MALFORMED-TAIL" : ""}`,
    );
  }

  if (!values["skip-audio"]) {
    let haveFfmpeg = true;
    try {
      await runFile("ffmpeg", ["-version"]);
    } catch {
      haveFfmpeg = false;
      console.log("audio turn skipped: ffmpeg isn't installed.");
    }
    if (haveFfmpeg) {
      const probe = "Remind me to stretch";
      const { audio } = await speaker.synthesize(probe);
      const wav = await ffmpegToWav(await collect(audio));
      const sample = await streamTurn("audio (listen role)", {
        audio: wav.toString("base64"),
      });
      samples.push(sample);
      console.log(
        `${sample.kind}: first-token=${sample.firstToken}ms first-sentence=${sample.firstSentence}ms ` +
          `end=${sample.end}ms sentences=${sample.sentences} heard=${JSON.stringify(sample.heard ?? "")}` +
          `${sample.malformed ? " MALFORMED-TAIL" : ""}`,
      );
    }
  }

  // The voice speaks a whole sentence at once, so full synthesis of a real
  // first sentence is the honest TTS leg of the estimate.
  const spoken = samples.find((s) => s.firstText)?.firstText ?? "Okay.";
  const t0 = performance.now();
  const { audio } = await speaker.synthesize(spoken);
  await collect(audio);
  const ttsMs = Math.round(performance.now() - t0);
  console.log(`tts(${JSON.stringify(spoken)})=${ttsMs}ms`);

  const estimates = samples.map((s) => s.firstSentence + ttsMs).sort((a, b) => a - b);
  const p50 = percentile(estimates, 50);
  const p95 = percentile(estimates, 95);
  console.log(
    `end-of-speech to first-sound estimate: p50=${p50}ms p95=${p95}ms (budget ${BUDGET_MS}ms)`,
  );

  let failed = false;
  for (const sample of samples) {
    if (sample.sentences === 0 || sample.firstSentence >= sample.end) {
      console.error(`GATE: ${sample.kind} never streamed (first sentence at the end).`);
      failed = true;
    }
  }
  if (p95 > BUDGET_MS) {
    console.error(`GATE: p95 ${p95}ms passes the ${BUDGET_MS}ms budget.`);
    failed = true;
  }
  const malformed = samples.filter((s) => s.malformed).length;
  if (malformed) console.log(`note: ${malformed}/${samples.length} turns had malformed tails.`);
  process.exit(failed ? 1 : 0);
};

main().catch((error) => {
  console.error(`voice:latency failed: ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
});
