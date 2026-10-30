"""Persuna's self-hosted cloud voice: Qwen3-TTS on Modal (step 3's voice).

OpenAI-compatible: POST /audio/speech with JSON {model, voice, input,
response_format, instructions} answers audio bytes, the shape Persuna's
speaker already speaks. Point SPEECH_BASE_URL at the deployed URL with
SPEECH_API=openai.

Two modes, picked by QWEN_TTS_MODEL (a key on the persuna-voice secret):
- CustomVoice (default): `voice` names a built-in speaker (Aiden, Ryan,
  Vivian, Serena, ...); unknown names fall back to QWEN_TTS_SPEAKER.
- Base: `voice` names a reference clip on the persuna-qwen-voices volume
  (/voices/<voice>.mp3 plus /voices/<voice>.txt with its transcript),
  cloned once per container and reused for every request.

Deploy: modal deploy tts_service.py   (needs the persuna-voice secret first)
Docs: modal-voice/README.md
"""

import hmac
import io
import os
import re
import subprocess

import modal

APP_NAME = "persuna-qwen-tts"
# A10G over L4: same 24 GB class, and L4 had no free workers (see logs).
GPU = "A10G"
VOICES_DIR = "/voices"
MAX_TEXT_CHARS = 4000

cache = modal.Volume.from_name("persuna-qwen-cache", create_if_missing=True)
voices = modal.Volume.from_name("persuna-qwen-voices", create_if_missing=True)
image = (
    modal.Image.debian_slim(python_version="3.12")
    .apt_install("ffmpeg", "libsndfile1")
    .pip_install("qwen-tts", "fastapi[standard]", "soundfile", "numpy")
    .env({"HF_HOME": "/cache/hf"})
)

app = modal.App(APP_NAME)


@app.function(
    image=image,
    gpu=GPU,
    memory=12288,
    volumes={"/cache": cache, VOICES_DIR: voices},
    secrets=[modal.Secret.from_name("persuna-voice")],
    # One warm container: speech starts at once instead of after a 30-60 s
    # model load. Set to 0 to scale to zero and pay only per request.
    min_containers=1,
    max_containers=4,
    # 600 s headroom for long generations (and option changes like this are
    # what Modal reliably notices as a new deployment).
    timeout=600,
)
@modal.asgi_app()
def api():
    import numpy as np
    import soundfile as sf
    import torch
    from fastapi import FastAPI, Header, HTTPException
    from fastapi.responses import JSONResponse, Response
    from pydantic import BaseModel
    from qwen_tts import Qwen3TTSModel

    expected_key = os.environ.get("VOICE_API_KEY", "")
    # Read here (not at module level) so values come from the Modal secret on
    # the container, not from wherever `modal deploy` ran.
    model_id = os.environ.get("QWEN_TTS_MODEL", "Qwen/Qwen3-TTS-12Hz-1.7B-CustomVoice")
    clone_mode = model_id.rstrip("/").endswith("-Base")
    default_speaker = os.environ.get("QWEN_TTS_SPEAKER", "Aiden")
    # "Auto" follows the text's language; set "English" to pin it.
    language = os.environ.get("QWEN_TTS_LANGUAGE", "Auto")

    def check(auth: str | None) -> None:
        given = (auth or "").removeprefix("Bearer ").strip()
        if not expected_key or not hmac.compare_digest(given, expected_key):
            raise HTTPException(status_code=401, detail="Bad API key")

    class SpeechRequest(BaseModel):
        model: str = "qwen3-tts"
        input: str
        voice: str = default_speaker
        response_format: str = "mp3"
        instructions: str | None = None

    model = Qwen3TTSModel.from_pretrained(
        model_id,
        device_map="cuda:0",
        dtype=torch.bfloat16,
    )
    speakers = set(model.get_supported_speakers()) if not clone_mode else set()
    # One clone prompt per reference voice, built on first use.
    clone_prompts: dict = {}

    def wav_bytes(wav: np.ndarray, sr: int) -> bytes:
        buf = io.BytesIO()
        sf.write(buf, np.asarray(wav, dtype=np.float32), sr, format="WAV")
        return buf.getvalue()

    def to_mp3(wav: bytes) -> bytes | None:
        try:
            done = subprocess.run(
                ["ffmpeg", "-y", "-loglevel", "error", "-i", "pipe:0",
                 "-codec:a", "libmp3lame", "-q:a", "4", "-f", "mp3", "pipe:1"],
                input=wav,
                capture_output=True,
                timeout=120,
            )
        except (OSError, subprocess.SubprocessError):
            return None
        return done.stdout if done.returncode == 0 and done.stdout else None

    def clone_prompt(voice: str):
        if voice in clone_prompts:
            return clone_prompts[voice]
        if not re.fullmatch(r"[A-Za-z0-9_-]{1,64}", voice):
            raise HTTPException(status_code=400, detail="Unknown voice")
        ref_audio = next(
            (os.path.join(VOICES_DIR, f"{voice}{ext}") for ext in (".wav", ".mp3")
             if os.path.exists(os.path.join(VOICES_DIR, f"{voice}{ext}"))),
            None,
        )
        ref_txt = os.path.join(VOICES_DIR, f"{voice}.txt")
        if not ref_audio or not os.path.exists(ref_txt):
            raise HTTPException(
                status_code=400,
                detail=f"Voice '{voice}' needs /voices/{voice}.mp3 and /voices/{voice}.txt "
                "on the persuna-qwen-voices volume",
            )
        with open(ref_txt, encoding="utf-8") as f:
            ref_text = f.read().strip()
        build = getattr(model, "create_voice_clone_prompt", None)
        prompt = (
            build(ref_audio=ref_audio, ref_text=ref_text)
            if callable(build)
            else {"ref_audio": ref_audio, "ref_text": ref_text}
        )
        clone_prompts[voice] = prompt
        return prompt

    web_app = FastAPI(title=APP_NAME)

    @web_app.get("/health")
    async def health() -> dict:
        # Bump rev to force Modal to roll a fresh deployment: it skips
        # redeploys it considers unchanged, which can leave stale code live.
        return {"ok": True, "model": model_id, "clone_mode": clone_mode, "rev": 4}

    @web_app.post("/audio/speech")
    async def speak(payload: SpeechRequest, authorization: str | None = Header(default=None)):
        check(authorization)
        text = (payload.input or "").strip()
        if not text:
            raise HTTPException(status_code=400, detail="Nothing to say")
        if len(text) > MAX_TEXT_CHARS:
            raise HTTPException(status_code=400, detail="Text is too long")
        want_mp3 = (payload.response_format or "mp3").lower() == "mp3"
        try:
            if clone_mode:
                prompt = clone_prompt(payload.voice)
                if isinstance(prompt, dict):
                    wavs, sr = model.generate_voice_clone(
                        text=text, language=language, **prompt)
                else:
                    wavs, sr = model.generate_voice_clone(
                        text=text, language=language, voice_clone_prompt=prompt)
            else:
                speaker = payload.voice if payload.voice in speakers else default_speaker
                wavs, sr = model.generate_custom_voice(
                    text=text,
                    language=language,
                    speaker=speaker,
                    instruct=payload.instructions or "",
                )
        except HTTPException:
            raise
        except Exception as error:  # noqa: BLE001 - surface as a 500, truncated
            raise HTTPException(status_code=500, detail=str(error)[:300]) from error
        wav = wav_bytes(wavs[0], sr)
        if want_mp3:
            mp3 = to_mp3(wav)
            if mp3:
                return Response(mp3, media_type="audio/mpeg")
        return Response(wav, media_type="audio/wav")

    @web_app.get("/voices")
    async def list_voices(authorization: str | None = Header(default=None)) -> JSONResponse:
        check(authorization)
        if clone_mode:
            names = sorted(
                {n.rsplit(".", 1)[0] for n in os.listdir(VOICES_DIR)
                 if n.endswith((".wav", ".mp3"))} if os.path.isdir(VOICES_DIR) else set()
            )
            return JSONResponse({"voices": names})
        return JSONResponse({"voices": sorted(speakers)})

    return web_app
