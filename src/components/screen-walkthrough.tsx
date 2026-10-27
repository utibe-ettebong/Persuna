"use client";

import { useEffect, useRef, useState } from "react";
import { toTranscribableWav } from "@/lib/audio/convert";
import { buttonClass } from "./ui";

const MAX_FRAMES = 24;
const MAX_SECONDS = 300;
const AUTO_EVERY_MS = 8000;
const MAX_WIDTH = 1280;

interface Frame {
  id: number;
  blob: Blob;
  url: string;
}

/**
 * Opt-in screen walkthrough. The owner shares ONE window and narrates while
 * doing the task. A frame is captured every few seconds (or on demand) and the
 * owner reviews and can delete frames before anything is sent. Nothing is
 * uploaded until they submit; frames and audio aren't stored on the server.
 */
export function ScreenWalkthrough() {
  const video = useRef<HTMLVideoElement>(null);
  const framesInput = useRef<HTMLInputElement>(null);
  const audioInput = useRef<HTMLInputElement>(null);
  const screen = useRef<MediaStream | null>(null);
  const mic = useRef<MediaRecorder | null>(null);
  const nextId = useRef(1);
  const [state, setState] = useState<"idle" | "recording" | "processing" | "review">("idle");
  const [frames, setFrames] = useState<Frame[]>([]);
  const [narrate, setNarrate] = useState(true);
  const [hasAudio, setHasAudio] = useState(false);
  const [seconds, setSeconds] = useState(0);
  const [error, setError] = useState<string | null>(null);

  // Keep the hidden input in step with the frames the owner chose to keep.
  useEffect(() => {
    if (!framesInput.current) return;
    const transfer = new DataTransfer();
    frames.forEach((f, i) =>
      transfer.items.add(new File([f.blob], `frame-${i + 1}.jpg`, { type: "image/jpeg" })),
    );
    framesInput.current.files = transfer.files;
  }, [frames]);

  useEffect(() => {
    if (state !== "recording") return;
    const tick = setInterval(() => setSeconds((s) => s + 1), 1000);
    const auto = setInterval(() => void capture(), AUTO_EVERY_MS);
    return () => {
      clearInterval(tick);
      clearInterval(auto);
    };
  }, [state]);

  useEffect(() => {
    if (state === "recording" && seconds >= MAX_SECONDS) stop();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [seconds, state]);

  useEffect(
    () => () => {
      screen.current?.getTracks().forEach((t) => t.stop());
    },
    [],
  );

  async function capture() {
    const v = video.current;
    if (!v || !v.videoWidth) return;
    const scale = Math.min(1, MAX_WIDTH / v.videoWidth);
    const canvas = document.createElement("canvas");
    canvas.width = Math.round(v.videoWidth * scale);
    canvas.height = Math.round(v.videoHeight * scale);
    canvas.getContext("2d")!.drawImage(v, 0, 0, canvas.width, canvas.height);
    const blob = await new Promise<Blob | null>((r) => canvas.toBlob(r, "image/jpeg", 0.7));
    if (!blob) return;
    setFrames((all) => {
      const next = [...all, { id: nextId.current++, blob, url: URL.createObjectURL(blob) }];
      // Over the cap, thin out evenly rather than dropping the end of the task.
      return next.length > MAX_FRAMES ? next.filter((_, i) => i % 2 === 0) : next;
    });
  }

  async function start() {
    setError(null);
    if (!navigator.mediaDevices?.getDisplayMedia) {
      setError("This browser can't share a window. Try Chrome, Edge or Firefox on a computer.");
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getDisplayMedia({
        video: { frameRate: 5 },
        audio: false,
      });
      screen.current = stream;
      stream.getVideoTracks()[0].addEventListener("ended", () => stop());
      if (video.current) {
        video.current.srcObject = stream;
        await video.current.play();
      }
      if (narrate) {
        try {
          const voice = await navigator.mediaDevices.getUserMedia({ audio: true });
          const rec = new MediaRecorder(voice);
          const chunks: Blob[] = [];
          rec.ondataavailable = (e) => e.data.size && chunks.push(e.data);
          rec.onstop = async () => {
            voice.getTracks().forEach((t) => t.stop());
            try {
              const wav = await toTranscribableWav(
                new Blob(chunks, { type: rec.mimeType }),
                "narration",
              );
              const transfer = new DataTransfer();
              transfer.items.add(wav);
              if (audioInput.current) audioInput.current.files = transfer.files;
              setHasAudio(true);
            } catch {
              setError("Your narration couldn't be prepared; the screens will still be sent.");
            }
            setState("review");
          };
          mic.current = rec;
          rec.start();
        } catch {
          setError("Microphone blocked, so recording screens only.");
        }
      }
      setFrames([]);
      setHasAudio(false);
      setSeconds(0);
      setState("recording");
      setTimeout(() => void capture(), 800);
    } catch {
      setError("Screen sharing was cancelled.");
    }
  }

  function stop() {
    if (!screen.current) return;
    void capture().finally(() => {
      screen.current?.getTracks().forEach((t) => t.stop());
      screen.current = null;
      if (video.current) video.current.srcObject = null;
      if (mic.current && mic.current.state !== "inactive") {
        setState("processing");
        mic.current.stop();
      } else {
        setState("review");
      }
    });
  }

  const clock = `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;

  return (
    <div className="space-y-4">
      <input
        ref={framesInput}
        type="file"
        name="frames"
        multiple
        hidden
        tabIndex={-1}
        aria-hidden
      />
      <input ref={audioInput} type="file" name="audio" hidden tabIndex={-1} aria-hidden />
      <video ref={video} muted playsInline className="hidden" />

      <div className="rounded-md border border-warn/40 bg-warn/8 p-3 text-sm text-muted">
        <strong className="text-foreground">Share one window, not your whole screen.</strong> Close
        anything confidential first. You&apos;ll see every captured frame and can delete any before
        sending. Frames and audio are used once to describe your method, then discarded; only the
        resulting rules (with names and numbers removed) are kept.
      </div>

      {state === "idle" && (
        <div className="flex flex-wrap items-center gap-4">
          <button type="button" onClick={start} className={buttonClass("secondary")}>
            ▣ Share a window and start
          </button>
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={narrate}
              onChange={(e) => setNarrate(e.target.checked)}
            />
            Record my narration too
          </label>
        </div>
      )}

      {state === "recording" && (
        <div className="flex flex-wrap items-center gap-3">
          <button type="button" onClick={() => void capture()} className={buttonClass("secondary")}>
            Capture this step
          </button>
          <button type="button" onClick={stop} className={buttonClass("danger")}>
            ■ Stop ({clock})
          </button>
          <span className="text-sm text-danger" role="status">
            Recording · {frames.length} frame{frames.length === 1 ? "" : "s"} · a frame every 8s, up
            to 5 minutes
          </span>
        </div>
      )}

      {state === "processing" && (
        <p className="text-sm text-muted" role="status">
          Preparing your narration…
        </p>
      )}

      {frames.length > 0 && (
        <div>
          <p className="label-mono mb-2 text-muted">
            {state === "review" ? "Review before sending" : "Captured"} · {frames.length} frame
            {frames.length === 1 ? "" : "s"}
            {state === "review" && hasAudio && " · narration recorded"}
          </p>
          <ul className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            {frames.map((f, i) => (
              <li key={f.id} className="relative overflow-hidden rounded-md border border-line">
                {/* eslint-disable-next-line @next/next/no-img-element -- local blob preview */}
                <img src={f.url} alt={`Captured frame ${i + 1}`} className="block w-full" />
                {state !== "recording" && (
                  <button
                    type="button"
                    onClick={() => setFrames((all) => all.filter((x) => x.id !== f.id))}
                    className="label-mono absolute right-1 top-1 rounded-sm bg-card/90 px-1.5 py-0.5 text-danger"
                    aria-label={`Delete frame ${i + 1}`}
                  >
                    Delete
                  </button>
                )}
              </li>
            ))}
          </ul>
          {state === "review" && (
            <button
              type="button"
              onClick={() => {
                setFrames([]);
                setHasAudio(false);
                if (audioInput.current) audioInput.current.value = "";
                setState("idle");
              }}
              className="label-mono mt-2 text-muted hover:text-foreground"
            >
              Discard and start over
            </button>
          )}
        </div>
      )}

      {error && (
        <p role="alert" className="text-sm text-danger">
          {error}
        </p>
      )}
    </div>
  );
}
