"use client";

import { useEffect, useRef, useState } from "react";
import { buttonClass } from "./ui";

/**
 * Records audio in the browser and puts it in a file input named `name`, so
 * it submits with the surrounding form. Uploading an audio file works too.
 */
export function VoiceRecorder({
  name = "audio",
  maxSeconds = 300,
}: {
  name?: string;
  maxSeconds?: number;
}) {
  const input = useRef<HTMLInputElement>(null);
  const recorder = useRef<MediaRecorder | null>(null);
  const [state, setState] = useState<"idle" | "recording" | "ready">("idle");
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

  async function start() {
    setError(null);
    if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === "undefined") {
      setError("This browser can't record audio. Upload a recording instead.");
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mime = ["audio/webm;codecs=opus", "audio/webm", "audio/mp4"].find((t) =>
        MediaRecorder.isTypeSupported(t),
      );
      const rec = new MediaRecorder(
        stream,
        mime ? { mimeType: mime, audioBitsPerSecond: 32_000 } : undefined,
      );
      const chunks: Blob[] = [];
      rec.ondataavailable = (e) => e.data.size && chunks.push(e.data);
      rec.onstop = () => {
        stream.getTracks().forEach((t) => t.stop());
        const type = rec.mimeType || "audio/webm";
        const file = new File(chunks, `recording.${type.includes("mp4") ? "m4a" : "webm"}`, {
          type,
        });
        const transfer = new DataTransfer();
        transfer.items.add(file);
        if (input.current) input.current.files = transfer.files;
        setPreview(URL.createObjectURL(file));
        setState("ready");
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
          <button type="button" onClick={start} className={buttonClass("secondary")}>
            ● {state === "ready" ? "Record again" : "Record"}
          </button>
        )}
        {state === "recording" && (
          <span className="text-sm text-danger" role="status">
            Recording… up to {Math.round(maxSeconds / 60)} minutes
          </span>
        )}
      </div>
      {preview && <audio controls src={preview} className="w-full max-w-md" />}
      <label className="block text-sm">
        <span className="text-muted">
          …or upload a recording (.webm, .m4a, .mp3, .wav, under 4 MB)
        </span>
        <input
          ref={input}
          type="file"
          name={name}
          accept="audio/*,.webm,.m4a,.mp3,.wav"
          onChange={() => {
            setPreview(null);
            setState(input.current?.files?.length ? "ready" : "idle");
          }}
          className="mt-1 block w-full text-sm text-muted file:mr-3 file:rounded file:border file:border-line file:bg-subtle file:px-2 file:py-1"
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
