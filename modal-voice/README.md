# Persuna's self-hosted voices on Modal

Qwen on Modal replaces ElevenLabs; everything else stays on Meta models.
Both services speak the OpenAI shapes Persuna already supports — no app
code changes, only env vars. ElevenLabs stays in the app as a fallback,
selected the same way by env.

- `tts_service.py` — Qwen3-TTS text-to-speech: `POST /audio/speech`.
  `SPEECH_BASE_URL` points here with `SPEECH_API=openai`. This is the
  ElevenLabs voice replacement.
- `asr_service.py` — Qwen3-ASR speech-to-text: `POST /audio/transcriptions`
  (optional). `TRANSCRIBE_BASE_URL` points here with `TRANSCRIBE_API=openai`.
  Only needed if you want STT off Meta and on your own GPUs too.

With the TTS service deployed, `VOICE_MODE=transcribe` (and `listen`'s
fallback) speak in Qwen's voice while Meta still hears and thinks.
`VOICE_MODE=agent` still uses ElevenLabs: that mode needs a realtime
turn-taking server (VAD, barge-in, duplex audio) — see "What this doesn't
replace" below.

## Setup

Needs a [Modal](https://modal.com) account and Python 3.10+. macOS ships
3.9, so install a newer one first (`brew install python@3.12`), then:

```sh
pip install modal
modal setup            # opens the browser, stores a token in ~/.modal.toml
```

Create one shared secret (pick a long random key):

```sh
VOICE_API_KEY=$(openssl rand -hex 32)
modal secret create persuna-voice VOICE_API_KEY=$VOICE_API_KEY
echo "Save this as TRANSCRIBE_API_KEY and SPEECH_API_KEY: $VOICE_API_KEY"
```

Optional overrides live on the same secret (recreating a secret replaces
it, so repeat every key). The service files document each one:

```sh
modal secret create persuna-voice \
  VOICE_API_KEY=$VOICE_API_KEY \
  QWEN_ASR_MODEL=Qwen/Qwen3-ASR-1.7B \
  QWEN_TTS_MODEL=Qwen/Qwen3-TTS-12Hz-1.7B-CustomVoice \
  QWEN_TTS_SPEAKER=Aiden
```

Deploy from this directory and copy the two URLs it prints:

```sh
cd modal-voice
python3 check_no_shadow.py   # no import shadowing, api() returns the app
modal deploy asr_service.py
modal deploy tts_service.py
```

The first request to each downloads weights (~1 GB ASR, ~4 GB TTS) into
the shared `persuna-qwen-cache` volume; later cold starts reuse them.
`min_containers=1` keeps one container warm so calls answer at once.

## Wiring Persuna to them

In `.env` (or Railway), replacing the ElevenLabs speech settings:

```sh
TRANSCRIBE_API=openai
TRANSCRIBE_BASE_URL=https://<workspace>--persuna-qwen-asr.modal.run
TRANSCRIBE_API_KEY=<VOICE_API_KEY>
TRANSCRIBE_MODEL=Qwen/Qwen3-ASR-0.6B

SPEECH_API=openai
SPEECH_BASE_URL=https://<workspace>--persuna-qwen-tts.modal.run
SPEECH_API_KEY=<VOICE_API_KEY>
SPEECH_MODEL=Qwen/Qwen3-TTS-12Hz-1.7B-CustomVoice
SPEECH_VOICE=Aiden
```

Restart the app. The Models & keys page shows what each role is using.

Check each service directly first when something is wrong:

```sh
curl -s https://<asr-url>/health \
  -H "authorization: Bearer $VOICE_API_KEY"
curl -s https://<asr-url>/audio/transcriptions \
  -H "authorization: Bearer $VOICE_API_KEY" \
  -F file=@sample.wav -F model=qwen3-asr

curl -s https://<tts-url>/health \
  -H "authorization: Bearer $VOICE_API_KEY"
curl -s https://<tts-url>/audio/speech \
  -H "authorization: Bearer $VOICE_API_KEY" \
  -H "content-type: application/json" \
  -d '{"input":"Hello from your own voice.","voice":"Aiden"}' \
  --output hello.mp3
curl -s "https://<tts-url>/voices" \
  -H "authorization: Bearer $VOICE_API_KEY"
```

## Cloned voices (Base model)

CustomVoice's built-in speakers (Aiden, Ryan, Vivian, Serena, …) need no
setup. To clone Persuna's own voices instead:

1. Put each reference clip plus its exact transcript on the voices volume
   (names must match, letters/digits/dash/underscore only):
   ```sh
   modal volume put persuna-qwen-voices ./alice.mp3 /alice.mp3
   modal volume put persuna-qwen-voices ./alice.txt /alice.txt
   ```
   No transcript? Make one with the ASR service you just deployed
   (`/audio/transcriptions` on the clip), check it by ear, save it.
2. Switch the TTS service to the Base weights: set `QWEN_TTS_MODEL` to
   `Qwen/Qwen3-TTS-12Hz-1.7B-Base` on the `persuna-voice` secret and
   `modal deploy tts_service.py` again.
3. Set `SPEECH_VOICE=alice` in Persuna.

## Cost knobs

- `GPU` at the top of each file: ASR runs on a T4, TTS on an A10G
  (L4 had no free workers when first deployed). Modal bills per second a
  container exists; see modal.com/pricing. If a deploy says "no changes
  detected" yet must roll out (e.g. after a secret rotation), change a
  function option such as `timeout` — Modal ignores literal-only edits.
- `min_containers=1` means one GPU always on per service (~1 GPU-hour an
  hour). Set to `0` to scale to zero — first calls then wait through a
  30–60 s model load.
- `max_containers=4` caps burst spend; raise it if calls queue.

## What this doesn't replace

- Streaming synthesis: Qwen renders the whole reply before the first byte,
  while ElevenLabs streams audio within ~300 ms. Short replies stay snappy;
  Persuna already caps spoken replies at 1500 chars.
- `VOICE_MODE=agent`: full-duplex calls (voice activity detection,
  interruptions, turn-taking) still need ElevenLabs Agents. Replacing that
  means a realtime server — VAD → this ASR → Persuna's brain
  (`/api/persuna/llm`) → this TTS over one WebSocket — plus a new client in
  place of `agent-voice.ts`. The services here are built ASGI-first so that
  server can live in this directory later.

## Troubleshooting

- `Secret persuna-voice not found`: create it (above) before deploying.
- `401 Bad API key`: the `TRANSCRIBE_API_KEY` / `SPEECH_API_KEY` in Persuna
  must equal the secret's `VOICE_API_KEY`.
- `400 Could not decode`: the upload wasn't audio ffmpeg can read.
- CUDA out of memory on TTS: use the 0.6B weights
  (`Qwen/Qwen3-TTS-12Hz-0.6B-CustomVoice`) or a bigger `GPU`.
- Slow first call after deploy: the weights download once, then live on the
  cache volume. Watch it with `modal app logs persuna-qwen-tts`.
