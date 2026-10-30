"""Persuna's self-hosted speech-to-text: Qwen3-ASR on Modal (optional).

OpenAI-compatible: POST /audio/transcriptions with a multipart `file` and
`model` field answers {"text": ...}, the shape Persuna's transcriber already
speaks. Point TRANSCRIBE_BASE_URL at the deployed URL with TRANSCRIBE_API=openai.
Optional because Meta's transcription stays the default; deploy this only if
you want STT on your own GPUs too.

Deploy: modal deploy asr_service.py   (needs the persuna-voice secret first)
Docs: modal-voice/README.md
"""

import hmac
import os
import subprocess
import tempfile

import modal

APP_NAME = "persuna-qwen-asr"
GPU = "T4"
# Same cap as Persuna's uploader: 16 kHz mono WAV is 32 KB a second.
MAX_AUDIO_BYTES = 12 * 1024 * 1024

cache = modal.Volume.from_name("persuna-qwen-cache", create_if_missing=True)
image = (
    modal.Image.debian_slim(python_version="3.12")
    .apt_install("ffmpeg", "libsndfile1")
    .pip_install("qwen-asr", "fastapi[standard]", "python-multipart", "soundfile", "numpy")
    .env({"HF_HOME": "/cache/hf"})
)

app = modal.App(APP_NAME)


@app.function(
    image=image,
    gpu=GPU,
    memory=8192,
    volumes={"/cache": cache},
    secrets=[modal.Secret.from_name("persuna-voice")],
    # One warm container: transcription answers at once instead of after a
    # 30-60 s model load. Set to 0 to scale to zero and pay only per request.
    min_containers=1,
    max_containers=4,
    timeout=600,
)
@modal.asgi_app()
def api():
    import torch
    from fastapi import FastAPI, File, Form, Header, HTTPException, UploadFile
    from fastapi.responses import JSONResponse
    from qwen_asr import Qwen3ASRModel

    expected_key = os.environ.get("VOICE_API_KEY", "")
    # Read here (not at module level) so values come from the Modal secret on
    # the container, not from wherever `modal deploy` ran.
    # 0.6B is the accuracy/efficiency trade-off; swap to Qwen/Qwen3-ASR-1.7B
    # for the strongest open weights (needs a bigger GPU).
    model_id = os.environ.get("QWEN_ASR_MODEL", "Qwen/Qwen3-ASR-0.6B")
    # Force "English" for speed, or leave unset for automatic detection.
    language = os.environ.get("QWEN_ASR_LANGUAGE") or None

    def check(auth: str | None) -> None:
        given = (auth or "").removeprefix("Bearer ").strip()
        if not expected_key or not hmac.compare_digest(given, expected_key):
            raise HTTPException(status_code=401, detail="Bad API key")

    # 2048 tokens covers Persuna's ~6 minute cap; raise for longer audio.
    model = Qwen3ASRModel.from_pretrained(
        model_id,
        dtype=torch.bfloat16,
        device_map="cuda:0",
        max_inference_batch_size=8,
        max_new_tokens=2048,
    )

    web_app = FastAPI(title=APP_NAME)

    @web_app.get("/health")
    async def health() -> dict:
        return {"ok": True, "model": model_id}

    @web_app.post("/audio/transcriptions")
    async def transcribe(
        file: UploadFile = File(...),
        model_name: str = Form("qwen3-asr", alias="model"),
        authorization: str | None = Header(default=None),
    ) -> JSONResponse:
        check(authorization)
        raw = await file.read()
        if not raw:
            raise HTTPException(status_code=400, detail="The recording is empty")
        if len(raw) > MAX_AUDIO_BYTES:
            raise HTTPException(status_code=400, detail="Recordings must be under 12 MB")
        with tempfile.TemporaryDirectory() as tmp:
            src = os.path.join(tmp, "in" + (os.path.splitext(file.filename or "")[1] or ".wav"))
            dst = os.path.join(tmp, "in16k.wav")
            with open(src, "wb") as f:
                f.write(raw)
            # Whatever the browser sent, Qwen hears 16 kHz mono WAV.
            done = subprocess.run(
                ["ffmpeg", "-y", "-loglevel", "error", "-i", src,
                 "-ac", "1", "-ar", "16000", "-c:a", "pcm_s16le", dst],
                capture_output=True,
                text=True,
                timeout=120,
            )
            if done.returncode != 0 or not os.path.exists(dst):
                raise HTTPException(status_code=400, detail="Could not decode that audio file")
            try:
                results = model.transcribe(audio=dst, language=language)
            except Exception as error:  # noqa: BLE001 - surface as a 500, truncated
                raise HTTPException(status_code=500, detail=str(error)[:300]) from error
        text = (results[0].text if results else "").strip()
        return JSONResponse({"text": text, "model": model_name})

    return web_app
