#!/bin/bash
# Trial speech clips: ten turns as 48kHz mono WAVs, matching measure.ts.
# Synthesized with the app's own ElevenLabs voice (SPEECH_* from the repo .env).
set -euo pipefail
cd "$(dirname "$0")"
mkdir -p clips .tmp-clips
ENV_FILE="../.env"
BASE_URL=$(grep '^SPEECH_BASE_URL=' "$ENV_FILE" | cut -d= -f2- | tr -d '"')
API_KEY=$(grep '^SPEECH_API_KEY=' "$ENV_FILE" | cut -d= -f2- | tr -d '"')
VOICE=$(grep '^SPEECH_VOICE=' "$ENV_FILE" | cut -d= -f2- | tr -d '"')
if [ -z "$BASE_URL" ] || [ -z "$API_KEY" ] || [ -z "$VOICE" ]; then
  echo "clips: set SPEECH_BASE_URL, SPEECH_API_KEY and SPEECH_VOICE in ../.env" >&2
  exit 1
fi

say_clip() {
  curl -s --fail-with-body --max-time 60 "$BASE_URL/text-to-speech/$VOICE?output_format=pcm_16000" \
    -H "xi-api-key: $API_KEY" -H "content-type: application/json" \
    -d "{\"text\":$(printf '%s' "$2" | python3 -c 'import json,sys; print(json.dumps(sys.stdin.read()))'),\"model_id\":\"eleven_turbo_v2_5\"}" \
    --output ".tmp-clips/$1.pcm"
  node --import tsx/esm src/pcm2wav.ts ".tmp-clips/$1.pcm" "clips/$1.wav" 16000
  echo "clips/$1.wav: $2"
}

say_clip 01-hello "Hello Persuna"
say_clip 02-remember-times "Remember that I like twenty four hour times"
say_clip 03-help "What can you help me with today"
say_clip 04-remind-call "Remind me to call Ada tomorrow"
say_clip 05-sound "How do I sound to you right now"
say_clip 06-remember-colour "Remember that my favourite colour is blue"
say_clip 07-joke "Tell me a one sentence joke"
say_clip 08-todo-milk "Add buy milk to my to do list"
say_clip 09-day "What day is it today"
say_clip 10-thanks "Thanks, that is all for now"
rm -rf .tmp-clips
