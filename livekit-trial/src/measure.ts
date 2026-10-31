/**
 * Trial measurer: joins a room as a speaker, plays ten spoken turns, and times
 * end-of-speech to first agent sound per turn. Run with the trial agent up
 * (`npm run dev` in another shell, TRIAL_ENGINE=realtime|pipeline):
 *
 *   npm run measure -- realtime|pipeline
 *
 * One room per run; the agent is dispatched to it by name. Speech clips are
 * generated once (`npm run clips`). Agent audio per turn is saved for voice
 * judging, and results.json holds the p50/p95. Tool reliability reads off the
 * agent's own stdout (`trial-tool` lines), not from here.
 */
import dotenv from "dotenv";
import { mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  AudioFrame,
  AudioSource,
  AudioStream,
  LocalAudioTrack,
  Room,
  RoomEvent,
  TrackKind,
  TrackPublishOptions,
  TrackSource,
  type RemoteTrack,
} from "@livekit/rtc-node";
import { AccessToken, AgentDispatchClient } from "livekit-server-sdk";
import { readWavMono16, rms, writeWavMono16 } from "./wav.js";

dotenv.config({ path: ".env.local" });

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

function required(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`measure: set ${name} in .env.local`);
  return value;
}

const LIVEKIT_URL = required("LIVEKIT_URL");
const API_KEY = required("LIVEKIT_API_KEY");
const API_SECRET = required("LIVEKIT_API_SECRET");

const SAMPLE_RATE = 48000;
const FRAME_SAMPLES = 480; // 10 ms
const SPEECH_RMS = 250;
const FIRST_SPEECH_TIMEOUT_MS = 30_000;
const TURN_END_SILENCE_MS = 2500;
const TURN_CAP_MS = 25_000;
const GREETING_TIMEOUT_MS = 90_000;

interface TurnSpec {
  clip: string;
  expectTool: "rememberFact" | "setReminder" | null;
}

const TURNS: TurnSpec[] = [
  { clip: "01-hello.wav", expectTool: null },
  { clip: "02-remember-times.wav", expectTool: "rememberFact" },
  { clip: "03-help.wav", expectTool: null },
  { clip: "04-remind-call.wav", expectTool: "setReminder" },
  { clip: "05-sound.wav", expectTool: null },
  { clip: "06-remember-colour.wav", expectTool: "rememberFact" },
  { clip: "07-joke.wav", expectTool: null },
  { clip: "08-todo-milk.wav", expectTool: "setReminder" },
  { clip: "09-day.wav", expectTool: null },
  { clip: "10-thanks.wav", expectTool: null },
];

interface TurnResult {
  clip: string;
  expectTool: TurnSpec["expectTool"];
  ok: boolean;
  /** End of our speech to first agent sound above the speech threshold. */
  e2sMs: number | null;
  /** End of speech to the first agent frame of any kind (diagnostic). */
  firstFrameMs: number | null;
  agentMs: number | null;
  failReason: string | null;
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function token(identity: string, room: string): Promise<string> {
  const at = new AccessToken(API_KEY, API_SECRET, { identity, name: identity });
  at.addGrant({ roomJoin: true, room, canPublish: true, canSubscribe: true });
  return at.toJwt();
}

async function main() {
  const engine = process.argv[2] === "pipeline" ? "pipeline" : "realtime";
  const clipsDir = join(root, "clips");
  for (const turn of TURNS) {
    try {
      readFileSync(join(clipsDir, turn.clip));
    } catch {
      throw new Error(`measure: missing clips/${turn.clip} — run npm run clips first`);
    }
  }
  const stamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
  const runDir = join(root, "runs", `${engine}-${stamp}`);
  mkdirSync(runDir, { recursive: true });
  const roomName = `trial-${engine}-${stamp}`;
  console.log(`measure: engine=${engine} room=${roomName}`);

  const dispatch = new AgentDispatchClient(LIVEKIT_URL, API_KEY, API_SECRET);
  await dispatch.createDispatch(roomName, "persuna-trial");
  console.log("measure: agent dispatched");

  const room = new Room();
  await room.connect(LIVEKIT_URL, await token("measurer", roomName));
  console.log("measure: joined room");

  const source = new AudioSource(SAMPLE_RATE, 1);
  const mic = LocalAudioTrack.createAudioTrack("measurer-mic", source);
  await room.localParticipant!.publishTrack(
    mic,
    new TrackPublishOptions({ source: TrackSource.SOURCE_MICROPHONE }),
  );
  console.log("measure: mic published");

  // One realtime pump: clip frames while playing, silence otherwise. T_end is
  // the push time of the first silence frame after a clip.
  let playing: Int16Array | null = null;
  let cursor = 0;
  let endOfSpeech: number | null = null;
  let pump = Promise.resolve();
  const silence = new Int16Array(FRAME_SAMPLES);
  const pumpTimer = setInterval(() => {
    pump = pump.then(async () => {
      if (playing) {
        const slice = playing.subarray(cursor, cursor + FRAME_SAMPLES);
        const data = new Int16Array(FRAME_SAMPLES);
        data.set(slice);
        cursor += slice.length;
        await source.captureFrame(new AudioFrame(data, SAMPLE_RATE, 1, FRAME_SAMPLES));
        if (cursor >= playing.length) {
          playing = null;
          endOfSpeech = performance.now();
        }
      } else {
        await source.captureFrame(new AudioFrame(silence, SAMPLE_RATE, 1, FRAME_SAMPLES));
      }
    });
  }, 10);

  // Agent audio capture: frames route to the current recording.
  let recording: {
    frames: { at: number; rms: number; data: Int16Array; rate: number }[];
    firstFrameAt: number | null;
    firstSpeechAt: number | null;
    lastSpeechAt: number;
  } | null = null;
  room.on(RoomEvent.TrackSubscribed, (track: RemoteTrack) => {
    if (track.kind !== TrackKind.KIND_AUDIO) return;
    console.log("measure: subscribed to agent audio");
    const stream = new AudioStream(track);
    void (async () => {
      for await (const frame of stream as AsyncIterable<AudioFrame>) {
        const rec = recording;
        if (!rec) continue;
        const at = performance.now();
        const level = rms(frame.data);
        if (rec.firstFrameAt === null) rec.firstFrameAt = at;
        if (level >= SPEECH_RMS) {
          if (rec.firstSpeechAt === null) rec.firstSpeechAt = at;
          rec.lastSpeechAt = at;
        }
        rec.frames.push({
          at,
          rms: level,
          data: Int16Array.from(frame.data),
          rate: frame.sampleRate,
        });
      }
    })();
  });

  const capture = async (
    label: string,
    speak: (() => void) | null,
    firstTimeoutMs: number,
  ): Promise<{
    e2sMs: number | null;
    firstFrameMs: number | null;
    agentMs: number | null;
    failReason: string | null;
  }> => {
    recording = { frames: [], firstFrameAt: null, firstSpeechAt: null, lastSpeechAt: 0 };
    endOfSpeech = null;
    speak?.();
    const started = performance.now();
    while (recording.firstSpeechAt === null) {
      if (performance.now() - started > firstTimeoutMs) {
        const rec = recording;
        recording = null;
        return {
          e2sMs: null,
          firstFrameMs: null,
          agentMs: null,
          failReason: `${label}: no agent speech in ${Math.round(firstTimeoutMs / 1000)}s`,
        };
      }
      await sleep(50);
    }
    // Until the agent goes quiet.
    while (true) {
      await sleep(100);
      const quiet = performance.now() - recording.lastSpeechAt;
      if (quiet >= TURN_END_SILENCE_MS) break;
      if (performance.now() - started > TURN_CAP_MS + firstTimeoutMs) break;
    }
    const rec = recording;
    recording = null;
    const rate = rec.frames[0]?.rate ?? SAMPLE_RATE;
    const pcm = new Int16Array(rec.frames.reduce((n, f) => n + f.data.length, 0));
    let offset = 0;
    for (const frame of rec.frames) {
      pcm.set(frame.data, offset);
      offset += frame.data.length;
    }
    writeWavMono16(join(runDir, `${label}.wav`), pcm, rate);
    const base = endOfSpeech ?? started;
    return {
      e2sMs: rec.firstSpeechAt !== null ? Math.round(rec.firstSpeechAt - base) : null,
      firstFrameMs: rec.firstFrameAt !== null ? Math.round(rec.firstFrameAt - base) : null,
      agentMs: Math.round(rec.lastSpeechAt - (rec.firstSpeechAt ?? rec.lastSpeechAt)),
      failReason: null,
    };
  };

  // The greeting (not an end-of-speech number: nothing was spoken to).
  console.log("measure: waiting for greeting…");
  const greeting = await capture("00-greeting", null, GREETING_TIMEOUT_MS);
  if (greeting.failReason) throw new Error(greeting.failReason);
  console.log(`measure: greeting first sound ${greeting.e2sMs}ms after join`);

  const results: TurnResult[] = [];
  for (const [index, turn] of TURNS.entries()) {
    const { pcm, sampleRate } = readWavMono16(join(clipsDir, turn.clip));
    if (sampleRate !== SAMPLE_RATE) throw new Error(`${turn.clip}: need ${SAMPLE_RATE}Hz`);
    console.log(
      `measure: turn ${index + 1}/10 ${turn.clip} (${(pcm.length / sampleRate).toFixed(1)}s)…`,
    );
    const out = await capture(
      `turn-${String(index + 1).padStart(2, "0")}`,
      () => {
        playing = pcm;
        cursor = 0;
      },
      FIRST_SPEECH_TIMEOUT_MS,
    );
    const result: TurnResult = {
      clip: turn.clip,
      expectTool: turn.expectTool,
      ok: out.failReason === null,
      e2sMs: out.e2sMs,
      firstFrameMs: out.firstFrameMs,
      agentMs: out.agentMs,
      failReason: out.failReason,
    };
    results.push(result);
    console.log(
      `measure: turn ${index + 1} ${result.ok ? `e2s=${result.e2sMs}ms` : `FAILED ${result.failReason}`}`,
    );
    await sleep(1000);
  }

  clearInterval(pumpTimer);
  await room.disconnect();

  const e2s = results
    .filter((r) => r.ok && r.e2sMs !== null)
    .map((r) => r.e2sMs as number)
    .sort((a, b) => a - b);
  const pick = (p: number) =>
    e2s.length === 0 ? null : e2s[Math.min(e2s.length - 1, Math.floor(p * e2s.length))];
  const summary = {
    engine,
    room: roomName,
    turns: results.length,
    ok: e2s.length,
    p50: pick(0.5),
    p95: pick(0.95),
  };
  writeFileSync(join(runDir, "results.json"), JSON.stringify({ summary, turns: results }, null, 2));
  console.log(`measure: done ok=${summary.ok}/10 p50=${summary.p50}ms p95=${summary.p95}ms`);
  console.log(`measure: run dir ${runDir}`);
}

main().catch((error) => {
  console.error("measure: failed:", error instanceof Error ? error.message : error);
  process.exit(1);
});
