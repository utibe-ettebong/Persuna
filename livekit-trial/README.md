# Persuna LiveKit trial

Trial voice agent for Persuna on [LiveKit Agents](https://docs.livekit.io/agents/start/voice-ai.md).
It answers the one question the restructure can't: **can a spoken turn start sounding in under
800 ms after you stop talking?** It tries Gemini Live first, with an STT-LLM-TTS pipeline on the
same tools as the fallback. Both engines run through LiveKit Inference, so the trial needs no
Google or OpenAI key — only a free LiveKit Cloud project.

This is a trial scaffold, not production wiring: two tools (`rememberFact`, `setReminder`) that
land in the Persuna app under test, and a console-based measurement. It was written against the
LiveKit docs and hasn't run here (no network); expect to align versions with the
[Node starter project](https://github.com/livekit-examples/agent-starter-node) if anything drifts.

## Setup

```bash
cd livekit-trial
npm install
cp .env.example .env.local
```

Fill in `.env.local`:

- `LIVEKIT_URL`, `LIVEKIT_API_KEY`, `LIVEKIT_API_SECRET` — a free project at
  [LiveKit Cloud](https://cloud.livekit.io). Inference usage bills to this account.
- `PERSUNA_APP_URL` — the app under test (`http://localhost:3000` with `npm run dev`).
- `PERSUNA_USER_EMAIL` — your Persuna sign-in email; the trial acts as you.
- `LIVEKIT_TOOL_SECRET` — any long random string; set the same value as the app's
  `LIVEKIT_TOOL_SECRET` so `/api/persuna/livekit-tool` answers.
- `TRIAL_ENGINE` — `realtime` (Gemini Live) or `pipeline` (STT-LLM-TTS fallback).

## Run

```bash
npm run dev
```

Then speak to it from your project's
[Agents dashboard](https://cloud.livekit.io/projects/p_/agents) (**Start a session**), or join its
room from any LiveKit client. Say hello, ask it to remember a fact, and ask for a reminder; check
both land in the app (memory on the Persuna page, the to-dos list).

## Measure (automated)

No voice needed: a measurer joins the agent's room, plays ten spoken turns
(generated once with `npm run clips` — the app's own ElevenLabs voice, needs
`SPEECH_*` in the repo `.env`), and times end-of-speech to first agent sound
per turn. Agent audio per turn is saved for voice judging.

Terminal 1 — the agent (one engine at a time):

```bash
cd livekit-trial
caffeinate -i npm run dev 2>&1 | tee trial-agent-realtime.log
# later: Ctrl-C, then:
TRIAL_ENGINE=pipeline caffeinate -i npm run dev 2>&1 | tee trial-agent-pipeline.log
```

Terminal 2 — ten turns per engine:

```bash
cd livekit-trial
caffeinate -i npm run measure -- realtime
# after switching the agent:
caffeinate -i npm run measure -- pipeline
```

Each run prints `ok=/10 p50= p95=` and writes `runs/<engine>-*/results.json`
plus per-turn WAVs. Tool reliability reads off the agent log:

```bash
grep trial-tool trial-agent-realtime.log
```

Four of the ten turns should fire tools (two `rememberFact`, two `setReminder`,
each `ok:true`). Decide per engine: ship the trial as the production path, keep
the current streamed app (slices A–C), or tune further. Costs to weigh: LiveKit
Inference per-minute billing on top of the app's own model spend, for a companion
that may listen for hours. Target: p50 end-of-speech → first sound ≤ 800 ms.

## Cleanup

Nothing persists outside the trial turns you ran (facts and to-dos land in your own account — delete
them if they were only probes). Stop the agent, and delete the LiveKit project if you made one just
for this.
