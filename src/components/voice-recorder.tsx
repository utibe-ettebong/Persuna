"use client";

import { useEffect, useRef, useState } from "react";
import { toTranscribableWav } from "@/lib/audio/convert";
import { buttonClass } from "./ui";

/**
 * Records audio in the browser (or takes an uploaded file), converts it to the
 * 16 kHz mono WAV that transcription needs, and puts it in a file input named
 * `name` so it submits with the surrounding form.
 */
export function VoiceRecorder({
  name = "audio",
  maxSeconds = 300,
}: {
  name?: string;
  maxSeconds?: number;
}) {
  const input = useRef<HTMLInputElement>(null);
  const picker = useRef<HTMLInputElement>(null);
  const recorder = useRef<MediaRecorder | null>(null);
  const [state, setState] = useState<"idle" | "recording" | "converting" | "ready">("idle");
  const [seconds, setSeconds] = useState(0);
  const [preview, setPreview] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (state !== "recording") return;
    const timer = setInterval(() => {
      setSeconds((s) => {
        if (s + 1 >= maxSeconds) recorder.current?.stop();
        return s + 1;
      });
    }, 1000);
    return () => clearInterval(timer);
  }, [state, maxSeconds]);

  useEffect(() => () => (preview ? URL.revokeObjectURL(preview) : undefined), [preview]);

  /** Converts, then hands the WAV to the hidden input that the form submits. */
  async function prepare(blob: Blob, filename: string) {
    setState("converting");
    setError(null);
    try {
      const wav = await toTranscribableWav(blob, filename);
      const transfer = new DataTransfer();
      transfer.items.add(wav);
      if (input.current) input.current.files = transfer.files;
      setPreview(URL.createObjectURL(wav));
      setState("ready");
    } catch {
      if (input.current) input.current.value = "";
      setState("idle");
      setError("That audio couldn't be read. Try recording again or another file.");
    }
  }

  async function start() {
    setError(null);
    if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === "undefined") {
      setError("This browser can't record audio. Upload a recording instead.");
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const rec = new MediaRecorder(stream);
      const chunks: Blob[] = [];
      rec.ondataavailable = (e) => e.data.size && chunks.push(e.data);
      rec.onstop = () => {
        stream.getTracks().forEach((t) => t.stop());
        void prepare(new Blob(chunks, { type: rec.mimeType || "audio/webm" }), "recording");
      };
      recorder.current = rec;
      setSeconds(0);
      rec.start();
      setState("recording");
    } catch {
      setError("Microphone access was blocked. Allow it, or upload a recording instead.");
    }
  }

  const clock = `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;

  return (
    <div className="space-y-3">
      <input ref={input} type="file" name={name} hidden tabIndex={-1} aria-hidden />
      <div className="flex flex-wrap items-center gap-3">
        {state === "recording" ? (
          <button
            type="button"
            onClick={() => recorder.current?.stop()}
            className={buttonClass("danger")}
          >
            ■ Stop ({clock})
          </button>
        ) : (
          <button
            type="button"
            onClick={start}
            disabled={state === "converting"}
            className={buttonClass("secondary")}
          >
            ● {state === "ready" ? "Record again" : "Record"}
          </button>
        )}
        {state === "recording" && (
          <span className="text-sm text-danger" role="status">
            Recording… up to {Math.round(maxSeconds / 60)} minutes
          </span>
        )}
        {state === "converting" && (
          <span className="text-sm text-muted" role="status">
            Preparing audio…
          </span>
        )}
        {state === "ready" && (
          <span className="text-sm text-good" role="status">
            Ready to send
          </span>
        )}
      </div>
      {preview && <audio controls src={preview} className="w-full max-w-md" />}
      <label className="block text-sm">
        <span className="text-muted">
          …or upload a recording (.webm, .m4a, .mp3, .wav, up to 5 minutes)
        </span>
        <input
          ref={picker}
          type="file"
          accept="audio/*,.webm,.m4a,.mp3,.wav"
          onChange={() => {
            const file = picker.current?.files?.[0];
            if (file) void prepare(file, file.name);
          }}
          className="mt-1 block w-full"
        />
      </label>
      {error && (
        <p role="alert" className="text-sm text-danger">
          {error}
        </p>
      )}
    </div>
  );
}
