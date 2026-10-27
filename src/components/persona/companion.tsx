"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import {
  personaChatAction,
  personaCheckInAction,
  personaObserveAction,
  personaTeachNoteAction,
  personaTranscribeAction,
} from "@/app/actions/persona";
import { toTranscribableWav } from "@/lib/audio/convert";
import { MAX_LOOKS, startWatching, type Watcher } from "./screen-watch";

export interface CompanionMessage {
  id: string;
  role: "user" | "assistant";
  kind: string;
  content: string;
  link?: { href: string; label: string } | null;
}

export interface CompanionProps {
  name: string;
  avatar: string;
  focus: string | null;
  focusSkill: { slug: string; name: string } | null;
  messages: CompanionMessage[];
}

type Status = "idle" | "thinking" | "listening" | "transcribing";

const SIZE = 56;
const today = () => new Date().toLocaleDateString("en-CA");

function stored<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
}
function store(key: string, value: unknown) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // Private windows can refuse storage; the companion still works.
  }
}

/**
 * Persona on screen: a small avatar that sits in a corner (drag it anywhere),
 * asks what you're working on each day, chats by text or voice, can read its
 * replies aloud, and watches ONE window only after you allow it. Without
 * permission it just sits there.
 */
export function Companion(props: CompanionProps) {
  const [open, setOpen] = useState(false);
  const [messages, setMessages] = useState<CompanionMessage[]>(props.messages);
  const [focus, setFocus] = useState(props.focus);
  const [focusSkill, setFocusSkill] = useState(props.focusSkill);
  const [text, setText] = useState("");
  const [status, setStatus] = useState<Status>("idle");
  const [error, setError] = useState<string | null>(null);
  const [bubble, setBubble] = useState<string | null>(null);
  const [speak, setSpeak] = useState(false);
  const [pos, setPos] = useState({ right: 24, bottom: 24 });
  const [watching, setWatching] = useState(false);
  const [askWatch, setAskWatch] = useState(false);
  const [looks, setLooks] = useState(0);
  const [watchNote, setWatchNote] = useState<string | null>(null);
  const [pip, setPip] = useState<Window | null>(null);
  const watcher = useRef<Watcher | null>(null);
  const recorder = useRef<MediaRecorder | null>(null);
  const list = useRef<HTMLDivElement>(null);
  const drag = useRef<{ x: number; y: number; right: number; bottom: number; moved: boolean }>(
    null,
  );
  const speakRef = useRef(speak);
  speakRef.current = speak;

  // Restore where the avatar was left and whether it talks, then do the daily check-in.
  useEffect(() => {
    const restore = requestAnimationFrame(() => {
      setPos(stored("persona.pos", { right: 24, bottom: 24 }));
      setSpeak(stored("persona.speak", false));
    });
    void personaCheckInAction(today()).then((res) => {
      if (res.ok && res.value) {
        const greeting = res.value;
        setMessages((all) => [...all, { ...greeting, role: "assistant" }]);
        setBubble(greeting.content);
        say(greeting.content);
      }
    });
    return () => {
      cancelAnimationFrame(restore);
      watcher.current?.stop();
    };
  }, []);

  useEffect(() => {
    list.current?.scrollTo({ top: list.current.scrollHeight });
  }, [messages, open, pip]);

  function say(line: string) {
    if (!speakRef.current || typeof speechSynthesis === "undefined") return;
    speechSynthesis.cancel();
    speechSynthesis.speak(new SpeechSynthesisUtterance(line));
  }

  async function send(message: string) {
    const body = message.trim();
    if (!body || status === "thinking") return;
    setError(null);
    setBubble(null);
    setText("");
    const pending: CompanionMessage = {
      id: `pending-${Date.now()}`,
      role: "user",
      kind: "chat",
      content: body,
    };
    setMessages((all) => [...all, pending]);
    setStatus("thinking");
    const res = await personaChatAction(body, today());
    setStatus("idle");
    if (!res.ok) {
      setMessages((all) => all.filter((m) => m.id !== pending.id));
      setText(body);
      setError(res.error);
      return;
    }
    const [mine, reply] = res.value.messages;
    setMessages((all) => [
      ...all.filter((m) => m.id !== pending.id),
      { ...mine, role: "user" },
      { ...reply, role: "assistant", link: res.value.link },
    ]);
    setFocus(res.value.focus.text);
    setFocusSkill(res.value.focus.skill);
    if (!open && !pip) setBubble(reply.content);
    say(reply.content);
  }

  async function toggleMic() {
    setError(null);
    if (status === "listening") {
      recorder.current?.stop();
      return;
    }
    if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === "undefined") {
      setError("This browser can't record audio. Type instead.");
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const rec = new MediaRecorder(stream);
      const chunks: Blob[] = [];
      rec.ondataavailable = (e) => e.data.size && chunks.push(e.data);
      rec.onstop = async () => {
        stream.getTracks().forEach((t) => t.stop());
        setStatus("transcribing");
        try {
          const wav = await toTranscribableWav(
            new Blob(chunks, { type: rec.mimeType || "audio/webm" }),
            "persona",
          );
          const form = new FormData();
          form.append("audio", wav);
          const res = await personaTranscribeAction(form);
          setStatus("idle");
          if (!res.ok) setError(res.error);
          else if (res.value.trim()) void send(res.value);
          else setError("I didn't catch anything. Try again?");
        } catch {
          setStatus("idle");
          setError("That recording couldn't be read. Try again.");
        }
      };
      recorder.current = rec;
      rec.start();
      setStatus("listening");
      // Push-to-talk, capped at a minute.
      setTimeout(() => rec.state === "recording" && rec.stop(), 60_000);
    } catch {
      setError("Microphone access was blocked.");
    }
  }

  async function startWatch() {
    setAskWatch(false);
    setError(null);
    let note: string | null = null;
    let count = 0;
    try {
      watcher.current = await startWatching({
        onFrame: async (frame) => {
          if (count >= MAX_LOOKS) {
            watcher.current?.stop();
            return;
          }
          count += 1;
          setLooks(count);
          const res = await personaObserveAction(frame, note);
          if (!res.ok) {
            setError(res.error);
            return;
          }
          note = res.value.noteId;
          setWatchNote(note);
          if (res.value.message) {
            const line = res.value.message;
            setMessages((all) => [...all, { ...line, role: "assistant" }]);
            if (!open && !pip) setBubble(line.content);
            say(line.content);
          }
        },
        onEnded: () => {
          watcher.current = null;
          setWatching(false);
          setMessages((all) => [
            ...all,
            {
              id: `watch-${Date.now()}`,
              role: "assistant",
              kind: "observation",
              content: note
                ? "I've stopped watching. I wrote the steps I saw into a note."
                : "I've stopped watching. Nothing new to note this time.",
              link: note ? { href: "/persona", label: "Open your notes" } : null,
            },
          ]);
        },
      });
      setLooks(0);
      setWatchNote(null);
      setWatching(true);
    } catch (e) {
      setError(
        e instanceof Error && e.name !== "NotAllowedError" ? e.message : "Sharing was cancelled.",
      );
    }
  }

  async function teachWatched() {
    if (!watchNote) return;
    setStatus("thinking");
    const res = await personaTeachNoteAction(watchNote);
    setStatus("idle");
    if (!res.ok) return setError(res.error);
    setWatchNote(null);
    setMessages((all) => [
      ...all,
      {
        id: `taught-${Date.now()}`,
        role: "assistant",
        kind: "chat",
        content: `Done. I turned what I saw into something you can review for ${focusSkill?.name ?? "your skill"}.`,
        link: res.value,
      },
    ]);
  }

  async function popOut() {
    const api = (
      window as unknown as {
        documentPictureInPicture?: { requestWindow(o: object): Promise<Window> };
      }
    ).documentPictureInPicture;
    if (!api) return;
    const win = await api.requestWindow({ width: 380, height: 560 });
    // Bring the page's styles along so the floating window looks the same.
    document.querySelectorAll('link[rel="stylesheet"], style').forEach((node) => {
      win.document.head.appendChild(node.cloneNode(true));
    });
    win.document.documentElement.className = document.documentElement.className;
    win.document.body.className = "bg-background text-foreground";
    win.addEventListener("pagehide", () => setPip(null));
    setOpen(false);
    setPip(win);
  }

  function onPointerDown(e: React.PointerEvent) {
    drag.current = { x: e.clientX, y: e.clientY, ...pos, moved: false };
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
  }
  function onPointerMove(e: React.PointerEvent) {
    const d = drag.current;
    if (!d) return;
    const dx = e.clientX - d.x;
    const dy = e.clientY - d.y;
    if (!d.moved && Math.hypot(dx, dy) < 5) return;
    d.moved = true;
    setPos({
      right: Math.min(Math.max(8, d.right - dx), window.innerWidth - SIZE - 8),
      bottom: Math.min(Math.max(8, d.bottom - dy), window.innerHeight - SIZE - 8),
    });
  }
  function onPointerUp() {
    const d = drag.current;
    drag.current = null;
    if (!d) return;
    if (d.moved) store("persona.pos", pos);
    else {
      setBubble(null);
      setOpen((o) => !o);
    }
  }

  const state = watching ? "watching" : status;
  const label = {
    idle: "Here",
    thinking: "Thinking…",
    listening: "Listening…",
    transcribing: "Hearing you…",
    watching: `Watching · ${looks} look${looks === 1 ? "" : "s"}`,
  }[state];
  const pipSupported = typeof window !== "undefined" && "documentPictureInPicture" in window;

  const panel = (
    <section
      aria-label={`${props.name}, your assistant`}
      className={`flex flex-col overflow-hidden bg-card text-foreground ${
        pip
          ? "h-screen"
          : "h-[min(560px,calc(100vh-7rem))] w-[min(380px,calc(100vw-2rem))] rounded-lg border border-line shadow-xl"
      }`}
    >
      <header className="flex items-center gap-3 border-b border-line px-4 py-3">
        <span className="text-2xl leading-none" aria-hidden>
          {props.avatar}
        </span>
        <div className="min-w-0 flex-1">
          <p className="font-display text-base font-semibold leading-tight">{props.name}</p>
          <p className="label-mono truncate text-muted" role="status">
            {label}
            {focus && ` · ${focus}`}
          </p>
        </div>
        <button
          type="button"
          onClick={() => {
            const next = !speak;
            setSpeak(next);
            store("persona.speak", next);
            if (!next && typeof speechSynthesis !== "undefined") speechSynthesis.cancel();
          }}
          aria-pressed={speak}
          title={speak ? "Stop reading replies aloud" : "Read replies aloud"}
          className={`rounded-md px-2 py-1 text-sm ${speak ? "bg-accent-soft text-accent" : "text-muted hover:text-foreground"}`}
        >
          {speak ? "🔊" : "🔈"}
        </button>
        {pipSupported && !pip && (
          <button
            type="button"
            onClick={() => void popOut()}
            title="Float over your other windows"
            className="rounded-md px-2 py-1 text-sm text-muted hover:text-foreground"
          >
            ⧉
          </button>
        )}
        <button
          type="button"
          onClick={() => (pip ? pip.close() : setOpen(false))}
          aria-label="Close"
          className="rounded-md px-2 py-1 text-sm text-muted hover:text-foreground"
        >
          ✕
        </button>
      </header>

      <div className="flex items-center gap-2 border-b border-line bg-subtle px-4 py-2 text-sm">
        {watching ? (
          <>
            <span className="text-accent">● Watching one window</span>
            <button
              type="button"
              onClick={() => watcher.current?.stop()}
              className="label-mono ml-auto text-danger"
            >
              Stop
            </button>
          </>
        ) : watchNote && focusSkill ? (
          <>
            <span className="text-muted">Teach what I saw to {focusSkill.name}?</span>
            <button
              type="button"
              onClick={() => void teachWatched()}
              disabled={status === "thinking"}
              className="label-mono ml-auto text-accent"
            >
              Teach it
            </button>
          </>
        ) : (
          <>
            <span className="text-muted">
              {focusSkill ? (
                <>
                  Training{" "}
                  <Link href={`/skills/${focusSkill.slug}`} className="text-accent underline">
                    {focusSkill.name}
                  </Link>
                </>
              ) : (
                "I only watch when you say so."
              )}
            </span>
            <button
              type="button"
              onClick={() => setAskWatch((v) => !v)}
              className="label-mono ml-auto text-accent"
            >
              Watch my screen
            </button>
          </>
        )}
      </div>

      {askWatch && (
        <div className="space-y-2 border-b border-line bg-accent-soft/50 px-4 py-3 text-sm">
          <p>
            <strong>Share one window, not your whole screen.</strong> I look at it every 30 seconds
            (only when it changes), write down the <em>steps</em> you take, and skip names and
            figures. Screenshots are never stored. Stop any time.
          </p>
          <div className="flex gap-3">
            <button
              type="button"
              onClick={() => void startWatch()}
              className="label-mono rounded-md bg-accent px-3 py-1.5 text-accent-ink"
            >
              Choose a window
            </button>
            <button
              type="button"
              onClick={() => setAskWatch(false)}
              className="label-mono text-muted"
            >
              Not now
            </button>
          </div>
        </div>
      )}

      <div ref={list} className="flex-1 space-y-3 overflow-y-auto px-4 py-4" aria-live="polite">
        {messages.length === 0 && (
          <p className="text-sm text-muted">
            Hi, I&apos;m {props.name}. Tell me what we&apos;re working on, ask me to take a note or
            remember something, or say &ldquo;teach me&rdquo; and I&apos;ll learn how you do it.
          </p>
        )}
        {messages.map((m) => (
          <div key={m.id} className={m.role === "user" ? "flex justify-end" : "flex"}>
            <div
              className={`max-w-[85%] whitespace-pre-wrap rounded-lg px-3 py-2 text-sm ${
                m.role === "user"
                  ? "bg-accent text-accent-ink"
                  : m.kind === "observation"
                    ? "border border-dashed border-line-strong text-muted"
                    : "bg-subtle"
              }`}
            >
              {m.content}
              {m.link && (
                <Link
                  href={m.link.href}
                  className="label-mono mt-1.5 block text-accent underline"
                  target={pip ? "_blank" : undefined}
                >
                  {m.link.label} →
                </Link>
              )}
            </div>
          </div>
        ))}
        {status === "thinking" && (
          <p className="label-mono text-muted" role="status">
            {props.name} is thinking…
          </p>
        )}
      </div>

      {error && (
        <p role="alert" className="border-t border-line px-4 py-2 text-sm text-danger">
          {error}
        </p>
      )}

      <form
        className="flex items-end gap-2 border-t border-line p-3"
        onSubmit={(e) => {
          e.preventDefault();
          void send(text);
        }}
      >
        <button
          type="button"
          onClick={() => void toggleMic()}
          disabled={status === "thinking" || status === "transcribing"}
          aria-pressed={status === "listening"}
          title={status === "listening" ? "Stop and send" : "Talk to me"}
          className={`h-10 w-10 shrink-0 rounded-md border text-base ${
            status === "listening"
              ? "border-danger bg-danger text-white"
              : "border-line text-muted hover:text-foreground"
          }`}
        >
          {status === "listening" ? "■" : "🎙"}
        </button>
        <label className="sr-only" htmlFor="persona-input">
          Message {props.name}
        </label>
        <textarea
          id="persona-input"
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              void send(text);
            }
          }}
          rows={1}
          placeholder={status === "listening" ? "Listening… press ■ when done" : "Message…"}
          className="max-h-32 min-h-10 flex-1 resize-none rounded-md border border-line bg-background px-3 py-2 text-sm outline-none focus:border-accent"
        />
        <button
          type="submit"
          disabled={!text.trim() || status === "thinking"}
          className="label-mono h-10 shrink-0 rounded-md bg-ink px-3 text-ink-foreground disabled:opacity-50"
        >
          Send
        </button>
      </form>
    </section>
  );

  return (
    <>
      {pip && createPortal(panel, pip.document.body)}
      <div
        className="fixed z-50 flex flex-col items-end gap-3"
        style={{ right: pos.right, bottom: pos.bottom }}
      >
        {open && !pip && panel}
        {bubble && !open && !pip && (
          <button
            type="button"
            onClick={() => {
              setBubble(null);
              setOpen(true);
            }}
            className="reveal max-w-64 rounded-lg border border-line bg-card px-3 py-2 text-left text-sm shadow-lg"
          >
            {bubble}
          </button>
        )}
        <button
          type="button"
          aria-label={`${open ? "Close" : "Open"} ${props.name} (${label})`}
          aria-expanded={open}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onKeyDown={(e) => {
            if (e.key === "Enter" || e.key === " ") {
              e.preventDefault();
              setBubble(null);
              setOpen((o) => !o);
            }
          }}
          style={{ width: SIZE, height: SIZE, touchAction: "none" }}
          className={`relative grid cursor-grab select-none place-items-center rounded-full border-2 bg-card text-3xl shadow-lg active:cursor-grabbing ${
            watching
              ? "persona-ring border-accent"
              : status === "listening"
                ? "border-danger"
                : "border-line-strong"
          } ${status === "thinking" || status === "transcribing" ? "persona-thinking" : status === "idle" && !watching ? "persona-idle" : ""}`}
        >
          <span aria-hidden>{props.avatar}</span>
          {watching && (
            <span
              aria-hidden
              className="absolute -right-1 -top-1 grid h-5 w-5 place-items-center rounded-full bg-accent text-[10px] text-accent-ink"
            >
              👁
            </span>
          )}
        </button>
      </div>
    </>
  );
}
