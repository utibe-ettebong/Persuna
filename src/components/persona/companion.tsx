"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";
import { createPortal } from "react-dom";
import {
  personaChatAction,
  personaCheckInAction,
  personaPulseAction,
  personaSetupAction,
  personaObserveAction,
  personaTeachNoteAction,
  personaTranscribeAction,
} from "@/app/actions/persona";
import { toTranscribableWav } from "@/lib/audio/convert";
import type { ChatJob } from "@/lib/persona/service";
import { LOOKS, LOOK_IDS, lookOf } from "@/lib/persona/looks";
import {
  SETUP_QUESTIONS,
  parseFirstTask,
  parseLook,
  parseName,
  type SetupStep,
} from "@/lib/persona/onboarding";
import { clock } from "./clock";
import { Icon } from "./icons";
import { JobCard } from "./job-card";
import { PersonaOrb, type OrbState } from "./orb";
import { MAX_LOOKS, startWatching, type Watcher } from "./screen-watch";
import { TaskComposer } from "./task-composer";
import {
  speak,
  startConversation,
  stopSpeaking,
  type Conversation,
  type UtteranceEnd,
} from "./voice";
import { startWakeWord, wakeWordSupported, type WakeListener } from "./wake-listener";

export interface CompanionMessage {
  id: string;
  role: "user" | "assistant";
  kind: string;
  content: string;
  jobId?: string | null;
  link?: { href: string; label: string } | null;
  job?: ChatJob;
}

export interface CompanionProps {
  name: string;
  /** The persona's look (see `lib/persona/looks`). */
  avatar: string;
  focus: string | null;
  focusSkill: { slug: string; name: string } | null;
  messages: CompanionMessage[];
  setupDone: boolean;
  wrapupDay: string | null;
  skills: { slug: string; name: string; published: boolean }[];
  /** Fills its window: the /companion page and the desktop app. */
  standalone?: boolean;
}

type Busy = "idle" | "thinking" | "hearing";

const ORB = 88;
/** Gap between Persona and the thing it perches beside. */
const PERCH_GAP = 14;
/** How long Persona stays perched or wandering before flying home. */
const PERCH_MS = 7000;
const WANDER_EVERY_MS = [45_000, 90_000] as const;
const CUT_IN = "Sorry to cut in. ";
const noSubscribe = () => () => {};
const WRAP_UP_OFFER = "It's getting late. Want a wrap-up of today?";
/** After this local hour, Persona offers an end-of-day wrap-up (once a day). */
const WRAP_UP_HOUR = 17;
const REMINDER_POLL_MS = 30_000;
/** With no input on the page for this long, Persona dozes until you move. */
const DOZE_MS = 5 * 60_000;
/** Spoken replies stop after this many sentences; the rest stays on screen. */
const SPOKEN_SENTENCES = 4;

/** Inside the fading conversation: no backdrop blur (it shows as a box under the fade). */
const card = "bg-card/95 shadow-[0_10px_34px_-14px_rgba(29,22,29,0.35)] ring-1 ring-foreground/5";

export const glass =
  "bg-card/75 backdrop-blur-xl shadow-[0_10px_40px_-12px_rgba(29,22,29,0.35)] ring-1 ring-foreground/5";

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
 * Persona on screen. Not a chat box: a living drop that hovers over the page,
 * looks at what you do, talks back out loud, and listens hands-free when you
 * turn on conversation. Its words float beside it as captions; open it and
 * the conversation flows above it, fading out at the top. It watches one
 * window only after you choose one; otherwise it just hovers, and dozes
 * when you leave.
 */
export function Companion(props: CompanionProps) {
  const [open, setOpen] = useState(Boolean(props.standalone) || !props.setupDone);
  const [setupDone, setSetupDone] = useState(props.setupDone);
  const [name, setName] = useState(props.name);
  const [look, setLook] = useState(props.avatar);
  const [task, setTask] = useState<{ skill: string | null } | null>(null);
  const [messages, setMessages] = useState<CompanionMessage[]>(props.messages);
  const [focus, setFocus] = useState(props.focus);
  const [focusSkill, setFocusSkill] = useState(props.focusSkill);
  const [text, setText] = useState("");
  const [busy, setBusy] = useState<Busy>("idle");
  const [error, setError] = useState<string | null>(null);
  const [caption, setCaption] = useState<string | null>(null);
  const [voiceOn, setVoiceOn] = useState(true);
  const [talking, setTalking] = useState(false);
  const [conversing, setConversing] = useState(false);
  const [level, setLevel] = useState(0);
  const [dozing, setDozing] = useState(false);
  // Where Persona is (top-left of the orb, in px). It roams and returns home.
  const [spot, setSpot] = useState<{ x: number; y: number } | null>(null);
  const [glide, setGlide] = useState(false);
  const [tilt, setTilt] = useState(0);
  const [gaze, setGaze] = useState<{ x: number; y: number } | null>(null);
  const [setupStep, setSetupStep] = useState<SetupStep>("name");
  const [setupMessages, setSetupMessages] = useState<CompanionMessage[]>([]);
  const [watching, setWatching] = useState(false);
  const [askWatch, setAskWatch] = useState(false);
  const [looks, setLooks] = useState(0);
  const [watchNote, setWatchNote] = useState<string | null>(null);
  const [pip, setPip] = useState<Window | null>(null);
  const [wakeOn, setWakeOn] = useState(false);
  const [askWake, setAskWake] = useState(false);
  const router = useRouter();
  const watcher = useRef<Watcher | null>(null);
  const conversation = useRef<Conversation | null>(null);
  const wake = useRef<WakeListener | null>(null);
  const stream = useRef<HTMLDivElement>(null);
  const drag = useRef<{ x: number; y: number; ox: number; oy: number; moved: boolean }>(null);
  const home = useRef<{ x: number; y: number } | null>(null);
  const backHome = useRef(0);
  const talkingNow = useRef(false);
  // The first meeting's answers and transcript. Refs, because `send` (which
  // routes replies here) is created once and must see the latest.
  const setupDraft = useRef<{
    name: string;
    look: string;
    taskName: string;
    log: CompanionMessage[];
  }>({ name: "", look: props.avatar, taskName: "", log: [] });
  const wrapOffered = useRef<string | null>(null);
  const queued = useRef<string | null>(null);
  const captionTimer = useRef(0);
  const lastInput = useRef(0);
  // Read by callbacks that outlive a render (voice loop, reminders).
  const live = useRef({ voiceOn, busy, talking, open, pip, name });
  useEffect(() => {
    live.current = { voiceOn, busy, talking, open, pip, name };
  }, [voiceOn, busy, talking, open, pip, name]);

  /* ---------- Speaking ---------- */

  const showCaption = useCallback((line: string) => {
    window.clearTimeout(captionTimer.current);
    setCaption(line);
    captionTimer.current = window.setTimeout(
      () => setCaption(null),
      Math.min(20_000, 5000 + line.length * 60),
    );
  }, []);

  const sayAloud = useCallback(async (line: string) => {
    if (!live.current.voiceOn || !line.trim()) return;
    // Browsers only allow speech after the person has interacted with the page.
    const activation = (navigator as Navigator & { userActivation?: { hasBeenActive: boolean } })
      .userActivation;
    if (activation && !activation.hasBeenActive) {
      queued.current = line;
      return;
    }
    const sentences = line.match(/[^.!?]+[.!?]*/g) ?? [line];
    const spoken =
      sentences.length > SPOKEN_SENTENCES
        ? `${sentences.slice(0, SPOKEN_SENTENCES).join(" ")} The rest is on screen.`
        : line;
    talkingNow.current = true;
    setTalking(true);
    await speak(spoken, setLevel);
    talkingNow.current = false;
    setTalking(false);
  }, []);

  /** Stop Persona mid-sentence: tapping it, typing, or talking over it. */
  const interrupt = useCallback(() => {
    if (!talkingNow.current) return;
    stopSpeaking();
    talkingNow.current = false;
    setTalking(false);
    setLevel(0);
  }, []);

  /** Persona says something: a caption by the orb (when closed) and out loud. */
  const express = useCallback(
    (line: string, lead = "") => {
      if (!live.current.open && !live.current.pip) showCaption(line);
      // If you're mid-sentence, Persona says so as it cuts in; your words so far are kept.
      const cutting = conversation.current?.userSpeaking() ? CUT_IN : "";
      void sayAloud(`${lead || cutting}${line}`);
    },
    [sayAloud, showCaption],
  );

  // First interaction anywhere: say whatever was waiting, and wake up.
  useEffect(() => {
    const onInput = () => {
      lastInput.current = Date.now();
      setDozing(false);
      const line = queued.current;
      if (line) {
        queued.current = null;
        void sayAloud(line);
      }
    };
    window.addEventListener("pointerdown", onInput);
    window.addEventListener("keydown", onInput);
    window.addEventListener("pointermove", onInput, { passive: true });
    lastInput.current = Date.now();
    const doze = window.setInterval(() => {
      if (Date.now() - lastInput.current > DOZE_MS) setDozing(true);
    }, 15_000);
    return () => {
      window.removeEventListener("pointerdown", onInput);
      window.removeEventListener("keydown", onInput);
      window.removeEventListener("pointermove", onInput);
      clearInterval(doze);
    };
  }, [sayAloud]);

  /* ---------- Daily rhythm: check-in, reminders, wrap-up ---------- */

  useEffect(() => {
    const restore = requestAnimationFrame(() => {
      const saved = stored<{ fx: number; fy: number } | null>("persona.home", null);
      const start = clampSpot(
        saved
          ? { x: saved.fx * window.innerWidth, y: saved.fy * window.innerHeight }
          : { x: window.innerWidth - ORB - 28, y: window.innerHeight - ORB - 44 },
      );
      home.current = start;
      setSpot(start);
      setVoiceOn(stored("persona.voice", true));
      setWakeOn(stored("persona.wake", false) && wakeWordSupported());
    });
    void personaCheckInAction(clock().day).then((res) => {
      if (res.ok && res.value && props.setupDone) {
        const greeting = res.value;
        setMessages((all) => [...all, { ...greeting, role: "assistant" }]);
        express(greeting.content);
      }
    });
    return () => {
      cancelAnimationFrame(restore);
      watcher.current?.stop();
      conversation.current?.stop();
      stopSpeaking();
    };
    // Runs once on mount; later prop changes don't redo the check-in.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Heartbeat: due reminders, plus anything worth speaking up about. Also
  // runs shortly after you open another page, so Persona reacts to it.
  const path = usePathname();
  useEffect(() => {
    const check = async () => {
      const res = await personaPulseAction(clock(), window.location.pathname);
      if (!res.ok) return;
      for (const r of res.value.reminders) {
        const line = `Reminder: ${r.text}`;
        setMessages((all) => [
          ...all,
          { id: `reminder-${r.id}`, role: "assistant", kind: "reminder", content: line },
        ]);
        express(line);
        if (typeof Notification !== "undefined" && Notification.permission === "granted") {
          new Notification(`${live.current.name} · reminder`, { body: r.text, tag: r.id });
        }
      }
      for (const n of res.value.notices) {
        setMessages((all) => [
          ...all,
          { ...n.message, role: "assistant", link: { href: n.href, label: "Take a look" } },
        ]);
        express(n.message.content);
        // If the thing it's talking about is on screen, go and point at it.
        if (!live.current.open) perchBy(document.querySelector(`main a[href="${n.href}"]`));
      }
    };
    const timer = setInterval(() => void check(), REMINDER_POLL_MS);
    const soon = setTimeout(() => void check(), 1500);
    const onVisible = () => document.visibilityState === "visible" && void check();
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      clearInterval(timer);
      clearTimeout(soon);
      document.removeEventListener("visibilitychange", onVisible);
    };
    // perchBy only reads refs and the page.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [express, path]);

  useEffect(() => {
    if (!setupDone) return;
    const offer = () => {
      const { day } = clock();
      if (new Date().getHours() < WRAP_UP_HOUR || wrapOffered.current === day) return;
      if (props.wrapupDay === day) return;
      wrapOffered.current = day;
      showCaption(WRAP_UP_OFFER);
    };
    const first = setTimeout(offer, 4000);
    const timer = setInterval(offer, 10 * 60_000);
    return () => {
      clearTimeout(first);
      clearInterval(timer);
    };
  }, [setupDone, props.wrapupDay, showCaption]);

  useEffect(() => {
    stream.current?.scrollTo({ top: stream.current.scrollHeight, behavior: "smooth" });
  }, [messages, open, pip, task, askWatch, askWake]);

  /* ---------- Talking with Persona ---------- */

  const send = useCallback(
    async (message: string, lead = "") => {
      const body = message.trim();
      if (!body || live.current.busy === "thinking") return;
      stopSpeaking();
      talkingNow.current = false;
      if (!setupRef.current.done) return setupReply(body);
      setError(null);
      setCaption(null);
      setText("");
      const pending: CompanionMessage = {
        id: `pending-${Date.now()}`,
        role: "user",
        kind: "chat",
        content: body,
      };
      setMessages((all) => [...all, pending]);
      setBusy("thinking");
      const res = await personaChatAction(body, clock());
      setBusy("idle");
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
      if (res.value.task) {
        setTask(res.value.task);
        setOpen(true);
      }
      if (res.value.navigate) {
        const href = res.value.navigate;
        // Get out of the way, fly to the top of the page, open it, look at its heading.
        setOpen(false);
        live.current.open = false; // so the reply shows as a caption right away
        flyTo({ x: 24, y: 72 }, -1);
        window.setTimeout(() => router.push(href), 600);
        window.setTimeout(() => perchBy(document.querySelector("main h1")), 1600);
      }
      if (
        res.value.reminderSet &&
        typeof Notification !== "undefined" &&
        Notification.permission === "default"
      ) {
        void Notification.requestPermission();
      }
      express(reply.content, lead);
    },
    // setupReply, flyTo and perchBy read live state through refs.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [express, router],
  );

  const hear = useCallback(
    async (audio: Blob, end: UtteranceEnd = "pause") => {
      setBusy("hearing");
      try {
        const wav = await toTranscribableWav(audio, "persona");
        const form = new FormData();
        form.append("audio", wav);
        const res = await personaTranscribeAction(form);
        setBusy("idle");
        if (!res.ok) return setError(res.error);
        // A very long turn: Persona cut in, and says so.
        if (res.value.trim()) await send(res.value, end === "long" ? CUT_IN : "");
      } catch {
        setBusy("idle");
        setError("I couldn't make that out. Try again?");
      }
    },
    [send],
  );

  async function toggleConversation() {
    setError(null);
    if (conversation.current) {
      conversation.current.stop();
      conversation.current = null;
      setConversing(false);
      return;
    }
    if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === "undefined") {
      setError("This browser can't use the microphone. Type instead.");
      return;
    }
    try {
      conversation.current = await startConversation({
        onLevel: (l) => !talkingNow.current && setLevel(l),
        onUtterance: (audio, end) => void hear(audio, end),
        speaking: () => talkingNow.current,
        busy: () => live.current.busy !== "idle",
        onBargeIn: interrupt,
      });
      setConversing(true);
      if (!live.current.open) setOpen(true);
    } catch {
      setError("Microphone access was blocked.");
    }
  }

  /* ---------- Wake word ---------- */

  useEffect(() => {
    if (!wakeOn || !setupDone) return;
    try {
      wake.current = startWakeWord({
        name: () => live.current.name,
        onWake: (rest) => {
          lastInput.current = Date.now();
          setDozing(false);
          setOpen(true);
          if (rest.split(/\s+/).filter(Boolean).length >= 2) void send(rest);
          else {
            void sayAloud("Yes?");
            if (!conversation.current) void toggleConversation();
          }
        },
        onError: (message) => {
          setError(message);
          setWakeOn(false);
          store("persona.wake", false);
        },
      });
    } catch (e) {
      const message = (e as Error).message;
      queueMicrotask(() => {
        setError(message);
        setWakeOn(false);
      });
    }
    return () => {
      wake.current?.stop();
      wake.current = null;
    };
    // toggleConversation and send read live state through refs.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [wakeOn, setupDone]);

  // Don't listen for the wake word while already talking.
  useEffect(() => {
    wake.current?.pause(conversing || talking);
  }, [conversing, talking]);

  function setWake(next: boolean) {
    setAskWake(false);
    setWakeOn(next);
    store("persona.wake", next);
  }

  /* ---------- First meeting, by conversation ---------- */

  const setupRef = useRef({ done: setupDone, step: setupStep });
  useEffect(() => {
    setupRef.current = { done: setupDone, step: setupStep };
  }, [setupDone, setupStep]);

  function addSetupMessage(m: Omit<CompanionMessage, "id" | "kind">) {
    const log = setupDraft.current.log;
    log.push({ ...m, id: `setup-${log.length}`, kind: "chat" });
    setSetupMessages([...log]);
  }

  function personaSays(line: string) {
    addSetupMessage({ role: "assistant", content: line });
    express(line);
  }

  // Persona opens the conversation itself (spoken after your first click or key).
  useEffect(() => {
    if (props.setupDone) return;
    const first = window.setTimeout(() => personaSays(SETUP_QUESTIONS.name("")), 600);
    return () => clearTimeout(first);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function setupReply(answer: string) {
    setText("");
    addSetupMessage({ role: "user", content: answer });
    const step = setupRef.current.step;
    if (step === "name") {
      const picked = parseName(answer) ?? "Nova";
      setupDraft.current.name = picked;
      setName(picked);
      setSetupStep("look");
      personaSays(
        parseName(answer)
          ? SETUP_QUESTIONS.look(picked)
          : `Then I'll be ${picked}. ${SETUP_QUESTIONS.look(picked).split(". ").slice(1).join(". ")}`,
      );
    } else if (step === "look") {
      const chosen = parseLook(answer);
      if (!chosen) return personaSays("Say a colour, like blue or purple, or tap one of me.");
      setLook(chosen);
      setupDraft.current.look = chosen;
      setSetupStep("task");
      personaSays(SETUP_QUESTIONS.task(setupDraft.current.name));
    } else if (step === "task") {
      const first = parseFirstTask(answer, props.skills);
      if (first.kind === "new") {
        setupDraft.current.taskName = first.name;
        setSetupStep("describe");
        return personaSays(`${first.name}. ${SETUP_QUESTIONS.describe(setupDraft.current.name)}`);
      }
      await finishSetup(first);
    } else if (answer.length < 10) {
      personaSays("Tell me a little more: what do you start with, and what do you hand over?");
    } else {
      await finishSetup({ kind: "new", name: setupDraft.current.taskName, description: answer });
    }
  }

  async function finishSetup(task: Parameters<typeof personaSetupAction>[0]["task"]) {
    setBusy("thinking");
    const res = await personaSetupAction({
      name: setupDraft.current.name || name,
      avatar: lookOf(setupDraft.current.look),
      task,
    });
    setBusy("idle");
    if (!res.ok) return personaSays(`Hmm, that didn't work: ${res.error}`);
    setSetupDone(true);
    setMessages((all) => [
      ...all,
      ...setupDraft.current.log,
      {
        ...res.value.message,
        role: "assistant",
        link: res.value.href ? { href: res.value.href, label: "Open the skill" } : null,
      },
    ]);
    express(res.value.message.content);
    router.refresh();
  }

  /* ---------- Roaming: Persona moves around the screen ---------- */

  function clampSpot(p: { x: number; y: number }) {
    return {
      x: Math.min(Math.max(8, p.x), window.innerWidth - ORB - 8),
      y: Math.min(Math.max(8, p.y), window.innerHeight - ORB - 30),
    };
  }

  /** Glide somewhere; unless `stay` is -1, come home again after `stay` ms. */
  function flyTo(target: { x: number; y: number }, stay = PERCH_MS) {
    const next = clampSpot(target);
    setSpot((current) => {
      if (current) setTilt(Math.max(-12, Math.min(12, (next.x - current.x) / 40)));
      return next;
    });
    setGlide(true);
    window.setTimeout(() => setTilt(0), 900);
    window.clearTimeout(backHome.current);
    if (stay >= 0) backHome.current = window.setTimeout(goHome, stay);
  }

  function goHome() {
    setGaze(null);
    if (home.current && !drag.current) flyTo(home.current, -1);
  }

  /** Perch beside an element on the page and look at it. */
  function perchBy(el: Element | null, stay = PERCH_MS) {
    if (!(el instanceof HTMLElement) || el.closest("[data-persona]")) return;
    const r = el.getBoundingClientRect();
    if (r.bottom < 0 || r.top > window.innerHeight || r.width === 0) return;
    const right = r.right + PERCH_GAP + ORB < window.innerWidth;
    flyTo(
      {
        x: right ? r.right + PERCH_GAP : r.left - PERCH_GAP - ORB,
        y: r.top + r.height / 2 - ORB / 2,
      },
      stay,
    );
    setGaze({ x: r.left + r.width / 2, y: r.top + r.height / 2 });
  }

  // Stay on screen when the window changes size.
  useEffect(() => {
    const onResize = () => {
      if (home.current) home.current = clampSpot(home.current);
      setSpot((p) => (p ? clampSpot(p) : p));
    };
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);

  // Keep you company: hover beside the field you're typing in.
  useEffect(() => {
    let leave = 0;
    const onFocus = (e: FocusEvent) => {
      const el = e.target as HTMLElement;
      if (live.current.open || el.closest("[data-persona]")) return;
      if (!el.matches("input:not([type=hidden]):not([type=checkbox]):not([type=radio]), textarea"))
        return;
      window.clearTimeout(leave);
      perchBy(el, -1);
    };
    const onBlur = (e: FocusEvent) => {
      if ((e.target as HTMLElement).closest("[data-persona]")) return;
      leave = window.setTimeout(goHome, 1500);
    };
    document.addEventListener("focusin", onFocus);
    document.addEventListener("focusout", onBlur);
    return () => {
      document.removeEventListener("focusin", onFocus);
      document.removeEventListener("focusout", onBlur);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Now and then, when nothing is happening, wander along the edges of the screen.
  useEffect(() => {
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    let timer = 0;
    const plan = () => {
      const [min, max] = WANDER_EVERY_MS;
      timer = window.setTimeout(wander, min + Math.random() * (max - min));
    };
    const wander = () => {
      const s = live.current;
      if (
        !s.open &&
        !s.pip &&
        s.busy === "idle" &&
        !s.talking &&
        !drag.current &&
        !document.hidden
      ) {
        const w = window.innerWidth;
        const h = window.innerHeight;
        const edge = Math.floor(Math.random() * 3);
        flyTo(
          edge === 0
            ? { x: 16 + Math.random() * 40, y: 120 + Math.random() * (h - 260) }
            : edge === 1
              ? { x: w - ORB - 24 - Math.random() * 40, y: 120 + Math.random() * (h - 260) }
              : { x: 80 + Math.random() * (w - 260), y: h - ORB - 40 },
          5000,
        );
      }
      plan();
    };
    plan();
    return () => clearTimeout(timer);
    // flyTo only reads refs and the window.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // A new page: glance at its heading for a moment.
  useEffect(() => {
    if (!home.current) return;
    const t = window.setTimeout(() => {
      if (!live.current.open) perchBy(document.querySelector("main h1"), 3500);
    }, 700);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [path]);

  /* ---------- Watching (only with permission) ---------- */

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
            express(line.content);
          }
        },
        onEnded: () => {
          watcher.current = null;
          setWatching(false);
          const line = note
            ? "I've stopped watching. I wrote the steps I saw into a note."
            : "I've stopped watching. Nothing new to note this time.";
          setMessages((all) => [
            ...all,
            {
              id: `watch-${Date.now()}`,
              role: "assistant",
              kind: "observation",
              content: line,
              link: note ? { href: "/persona", label: "Open your notes" } : null,
            },
          ]);
          express(line);
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
    setBusy("thinking");
    const res = await personaTeachNoteAction(watchNote);
    setBusy("idle");
    if (!res.ok) return setError(res.error);
    setWatchNote(null);
    const line = `Done. I turned what I saw into something you can review for ${focusSkill?.name ?? "your skill"}.`;
    setMessages((all) => [
      ...all,
      {
        id: `taught-${Date.now()}`,
        role: "assistant",
        kind: "chat",
        content: line,
        link: res.value,
      },
    ]);
    express(line);
  }

  /* ---------- Floating window and dragging ---------- */

  async function popOut() {
    const api = (
      window as unknown as {
        documentPictureInPicture?: { requestWindow(o: object): Promise<Window> };
      }
    ).documentPictureInPicture;
    if (!api) return;
    const win = await api.requestWindow({ width: 380, height: 600 });
    // Bring the page's styles along so the floating window looks the same.
    document.querySelectorAll('link[rel="stylesheet"], style').forEach((node) => {
      win.document.head.appendChild(node.cloneNode(true));
    });
    win.document.documentElement.className = document.documentElement.className;
    win.document.body.className = "persona-backdrop text-foreground";
    win.addEventListener("pagehide", () => setPip(null));
    setOpen(false);
    setPip(win);
  }

  function onPointerDown(e: React.PointerEvent) {
    if (!spot) return;
    drag.current = { x: e.clientX, y: e.clientY, ox: spot.x, oy: spot.y, moved: false };
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
  }
  function onPointerMove(e: React.PointerEvent) {
    const d = drag.current;
    if (!d) return;
    const dx = e.clientX - d.x;
    const dy = e.clientY - d.y;
    if (!d.moved && Math.hypot(dx, dy) < 5) return;
    d.moved = true;
    setGlide(false);
    window.clearTimeout(backHome.current);
    setSpot(clampSpot({ x: d.ox + dx, y: d.oy + dy }));
  }
  function onPointerUp() {
    const d = drag.current;
    drag.current = null;
    if (!d) return;
    if (d.moved && spot) {
      // Where you put it becomes home.
      home.current = spot;
      store("persona.home", { fx: spot.x / window.innerWidth, fy: spot.y / window.innerHeight });
    } else toggleOpen();
  }
  function toggleOpen() {
    // Tapping Persona while it talks just stops it talking.
    if (talkingNow.current) return interrupt();
    const wrap = caption === WRAP_UP_OFFER;
    setCaption(null);
    setOpen((o) => !o);
    if (wrap) void send("Wrap up my day");
  }

  /* ---------- What it looks like ---------- */

  const orbState: OrbState = watching
    ? "watching"
    : talking
      ? "speaking"
      : busy !== "idle"
        ? "thinking"
        : conversing
          ? "listening"
          : dozing && !open
            ? "sleeping"
            : "idle";
  const status = {
    idle: wakeOn ? `Say "Hey ${name}"` : focus ? `On ${focus}` : "Here with you",
    listening: "Listening…",
    thinking: busy === "hearing" ? "Hearing you…" : "Thinking…",
    speaking: "Speaking",
    watching: `Watching · ${looks} look${looks === 1 ? "" : "s"}`,
    sleeping: "Dozing",
  }[orbState];
  const pipSupported = useSyncExternalStore(
    noSubscribe,
    () => !props.standalone && "documentPictureInPicture" in window,
    () => false,
  );
  const canWake = useSyncExternalStore(noSubscribe, wakeWordSupported, () => false);
  const inDesktopApp = useSyncExternalStore(
    noSubscribe,
    () => /Electron/.test(navigator.userAgent),
    () => false,
  );
  const published = props.skills.filter((s) => s.published);
  const column = Boolean(props.standalone || pip);

  const conversationView = (
    <div
      ref={stream}
      aria-live="polite"
      aria-label={`Conversation with ${name}`}
      className={`persona-stream flex flex-col gap-2.5 overflow-y-auto px-1 pb-2 pt-10 ${
        column
          ? "min-h-0 flex-1"
          : "max-h-[min(62vh,560px,var(--room))] w-[min(380px,calc(100vw-2rem))]"
      }`}
    >
      {!setupDone ? (
        <>
          {setupMessages.map((m) => (
            <Bubble key={m.id} role={m.role}>
              {m.content}
            </Bubble>
          ))}
          {setupStep === "look" && (
            <div className="persona-in flex flex-wrap gap-1 self-start" aria-label="Looks">
              {LOOK_IDS.map((id) => (
                <button
                  key={id}
                  type="button"
                  onClick={() => void setupReply(LOOKS[id].label)}
                  aria-label={`${LOOKS[id].label} look`}
                  title={LOOKS[id].label}
                  className="rounded-2xl p-1 hover:bg-accent-soft"
                >
                  <PersonaOrb look={id} size={38} animate={false} />
                </button>
              ))}
            </div>
          )}
          {setupStep === "task" && (
            <div className="persona-in flex flex-wrap gap-1.5 self-start">
              {[...props.skills.map((s) => s.name), "Try the sample", "Later"].map((label) => (
                <button
                  key={label}
                  type="button"
                  onClick={() => void setupReply(label === "Try the sample" ? "sample" : label)}
                  className={`rounded-full px-3 py-1.5 text-sm ${card} hover:text-accent`}
                >
                  {label}
                </button>
              ))}
            </div>
          )}
        </>
      ) : (
        <>
          {messages.length === 0 && (
            <Bubble role="assistant">
              Hi, I&apos;m {name}. Talk to me (tap the wave), tell me what we&apos;re working on, or
              hand me a task.
            </Bubble>
          )}
          {messages.slice(-60).map((m) => (
            <Bubble key={m.id} role={m.role} kind={m.kind} wide={Boolean(m.jobId)}>
              {m.content}
              {m.jobId && <JobCard jobId={m.jobId} initial={m.job} />}
              {m.link && (
                <Link
                  href={m.link.href}
                  target={pip ? "_blank" : undefined}
                  className="label-mono mt-1.5 block text-accent hover:underline"
                >
                  {m.link.label} →
                </Link>
              )}
            </Bubble>
          ))}
          {busy !== "idle" && (
            <div className="persona-in flex gap-1 self-start px-3 py-2" aria-label={status}>
              {[0, 1, 2].map((i) => (
                <span
                  key={i}
                  className="persona-dot h-2 w-2 rounded-full bg-accent"
                  style={{ animationDelay: `${i * 0.15}s` }}
                />
              ))}
            </div>
          )}
          {askWake && (
            <div className={`persona-in space-y-2 rounded-[22px] p-4 text-sm ${card}`}>
              <p>
                <strong>Say &ldquo;Hey {name}&rdquo; to wake me.</strong> While this is on, your
                browser listens for my name. In Chrome and Edge, that listening is done by the
                browser maker&apos;s speech service, not by PERSUNA. I start a conversation when I
                hear my name; nothing else is kept. Turn it off any time.
              </p>
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={() => setWake(true)}
                  className="rounded-full bg-accent px-4 py-1.5 text-sm text-accent-ink"
                >
                  Turn it on
                </button>
                <button
                  type="button"
                  onClick={() => setAskWake(false)}
                  className="rounded-full px-3 py-1.5 text-sm text-muted hover:text-foreground"
                >
                  Not now
                </button>
              </div>
            </div>
          )}
          {askWatch && (
            <div className={`persona-in space-y-2 rounded-[22px] p-4 text-sm ${card}`}>
              <p>
                <strong>Pick one window for me to watch.</strong> It can be any app (Figma, your
                video editor, a spreadsheet): choose it under &ldquo;Window&rdquo;. I look every 30
                seconds while it changes, write down your <em>steps</em>, skip names and figures,
                and keep no screenshots. Stop any time.
              </p>
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={() => void startWatch()}
                  className="rounded-full bg-accent px-4 py-1.5 text-sm text-accent-ink"
                >
                  Choose a window
                </button>
                <button
                  type="button"
                  onClick={() => setAskWatch(false)}
                  className="rounded-full px-3 py-1.5 text-sm text-muted hover:text-foreground"
                >
                  Not now
                </button>
              </div>
            </div>
          )}
          {!watching && watchNote && focusSkill && (
            <div
              className={`persona-in flex items-center gap-3 rounded-full px-4 py-2 text-sm ${card}`}
            >
              <span className="flex-1">Teach what I saw to {focusSkill.name}?</span>
              <button
                type="button"
                onClick={() => void teachWatched()}
                className="rounded-full bg-accent px-3 py-1 text-accent-ink"
              >
                Teach it
              </button>
            </div>
          )}
          {task && (
            <div className={`persona-in rounded-[22px] ${card}`}>
              <TaskComposer
                skills={published}
                initial={task.skill}
                onCancel={() => setTask(null)}
                onDone={(added, job) => {
                  setTask(null);
                  setMessages((all) => [
                    ...all,
                    ...added.map((m) => (m.jobId === job.id ? { ...m, job } : m)),
                  ]);
                  void sayAloud(added.at(-1)?.content ?? "");
                }}
              />
            </div>
          )}
        </>
      )}
      {error && (
        <p
          role="alert"
          className="persona-in self-start rounded-full bg-danger/10 px-3 py-1.5 text-sm text-danger"
        >
          {error}
        </p>
      )}
    </div>
  );

  const actions = setupDone && (
    <div className="flex items-center gap-1.5">
      <Chip
        label={voiceOn ? "Mute my voice" : "Let me talk out loud"}
        active={voiceOn}
        onClick={() => {
          const next = !voiceOn;
          setVoiceOn(next);
          store("persona.voice", next);
          if (!next) stopSpeaking();
        }}
      >
        <Icon name={voiceOn ? "sound" : "mute"} />
      </Chip>
      <Chip
        label="Give me a task"
        active={Boolean(task)}
        onClick={() => setTask(task ? null : { skill: focusSkill?.slug ?? null })}
      >
        <Icon name="task" />
      </Chip>
      <Chip
        label={watching ? "Stop watching" : "Watch a window"}
        active={watching}
        onClick={() => (watching ? watcher.current?.stop() : setAskWatch((v) => !v))}
      >
        <Icon name="eye" />
      </Chip>
      {canWake && (
        <Chip
          label={wakeOn ? `Stop listening for "Hey ${name}"` : `Listen for "Hey ${name}"`}
          active={wakeOn}
          onClick={() => (wakeOn ? setWake(false) : setAskWake((v) => !v))}
        >
          <Icon name="ear" />
        </Chip>
      )}
      {pipSupported && (
        <Chip label="Float over other apps" onClick={() => void popOut()}>
          <Icon name="float" />
        </Chip>
      )}
      {focusSkill && (
        <Link
          href={`/skills/${focusSkill.slug}`}
          target={pip ? "_blank" : undefined}
          className="label-mono ml-1 max-w-36 truncate rounded-full px-2 py-1 text-muted hover:text-accent"
          title={`Training ${focusSkill.name}`}
        >
          {focusSkill.name}
        </Link>
      )}
    </div>
  );

  const dock = (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        void send(text);
      }}
      className={`flex items-center gap-1.5 rounded-full p-1.5 pl-2 ${glass} ${
        column ? "w-full" : "w-[min(380px,calc(100vw-2rem))]"
      }`}
    >
      <button
        type="button"
        onClick={() => void toggleConversation()}
        aria-pressed={conversing}
        title={conversing ? "Stop talking" : "Talk with me, hands-free"}
        aria-label={conversing ? "Stop talking" : "Talk with me"}
        className={`grid h-9 w-9 shrink-0 place-items-center rounded-full transition-colors ${
          conversing
            ? "bg-accent text-accent-ink"
            : "text-muted hover:bg-accent-soft hover:text-accent"
        }`}
      >
        <Wave level={conversing ? level : 0} />
      </button>
      <label className="sr-only" htmlFor="persona-input">
        Message {name}
      </label>
      <input
        id="persona-input"
        value={text}
        onChange={(e) => {
          // Typing over Persona stops it talking.
          interrupt();
          setText(e.target.value);
        }}
        autoComplete="off"
        placeholder={
          conversing
            ? "I'm listening… talk over me any time"
            : setupDone
              ? `Talk to ${name}…`
              : "Type, or tap the wave and just talk"
        }
        className="min-w-0 flex-1 bg-transparent px-1 text-sm outline-none placeholder:text-faint"
      />
      <button
        type="submit"
        disabled={!text.trim() || busy === "thinking"}
        aria-label="Send"
        className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-ink text-ink-foreground transition-opacity disabled:opacity-30"
      >
        <Icon name="send" />
      </button>
    </form>
  );

  const orb = (big: boolean) => (
    <div className="flex flex-col items-center">
      <div className={orbState === "sleeping" ? "" : "persona-float"}>
        <PersonaOrb
          look={look}
          state={orbState}
          level={level}
          size={big ? 120 : ORB}
          gaze={big ? null : gaze}
        />
      </div>
      <span className="label-mono -mt-1 max-w-44 truncate text-[10px] text-muted" role="status">
        {status}
      </span>
    </div>
  );

  // The desktop app and the pop-out window: Persona on top, the conversation, the dock.
  const columnView = (
    <section
      aria-label={`${name}, your assistant`}
      className="persona-backdrop flex h-screen flex-col gap-3 px-4 pb-4 pt-3 text-foreground"
    >
      <div className="persona-drag relative flex items-start justify-center pt-1">
        {orb(true)}
        {inDesktopApp && (
          <button
            type="button"
            onClick={() => window.close()}
            aria-label={`Close ${name}`}
            className="absolute right-0 top-0 grid h-7 w-7 place-items-center rounded-full text-muted hover:bg-accent-soft hover:text-accent"
          >
            ×
          </button>
        )}
      </div>
      {conversationView}
      <div className="persona-no-drag space-y-2">
        {actions}
        {dock}
      </div>
    </section>
  );

  if (props.standalone) return columnView;

  if (!spot) return pip ? createPortal(columnView, pip.document.body) : null;
  const onRight = spot.x + ORB / 2 > window.innerWidth / 2;
  // Open upwards when there's room, like speech rising from Persona; otherwise downwards.
  const below = spot.y < 360;
  const room = below ? window.innerHeight - spot.y - ORB - 40 : spot.y - 16;

  return (
    <>
      {pip && createPortal(columnView, pip.document.body)}
      <section
        data-persona
        aria-label={`${name}, your assistant`}
        className="pointer-events-none fixed z-50"
        style={{
          left: spot.x,
          top: spot.y,
          width: ORB,
          transition: glide
            ? "left 1.1s cubic-bezier(.45,.05,.25,1), top 1.1s cubic-bezier(.45,.05,.25,1)"
            : "none",
        }}
      >
        {open && !pip && (
          <div
            className={`pointer-events-auto absolute flex flex-col gap-2 ${
              onRight ? "right-0 items-end" : "left-0 items-start"
            }`}
            style={below ? { top: "calc(100% + 10px)" } : { bottom: "calc(100% + 10px)" }}
          >
            <div style={{ "--room": `${Math.max(180, room - 110)}px` } as React.CSSProperties}>
              {conversationView}
            </div>
            {actions && <div className={`rounded-full px-1.5 py-1 ${glass}`}>{actions}</div>}
            {dock}
          </div>
        )}
        {caption && !open && !pip && (
          <button
            type="button"
            onClick={toggleOpen}
            className={`persona-in pointer-events-auto absolute top-2 w-max max-w-72 px-4 py-2.5 text-left text-sm leading-snug ${glass} ${
              onRight
                ? "right-[calc(100%+10px)] rounded-[22px] rounded-tr-md"
                : "left-[calc(100%+10px)] rounded-[22px] rounded-tl-md"
            }`}
          >
            {caption.length > 220 ? `${caption.slice(0, 220)}…` : caption}
          </button>
        )}
        <button
          type="button"
          aria-label={`${open ? "Close" : "Open"} ${name} (${status})`}
          aria-expanded={open}
          title={talking ? "Tap to interrupt" : undefined}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onKeyDown={(e) => {
            if (e.key === "Enter" || e.key === " ") {
              e.preventDefault();
              toggleOpen();
            }
          }}
          style={{
            touchAction: "none",
            transform: `rotate(${tilt}deg)`,
            transition: "transform .6s ease",
          }}
          className="pointer-events-auto cursor-grab select-none rounded-full outline-none focus-visible:ring-2 focus-visible:ring-accent active:cursor-grabbing"
        >
          {orb(false)}
        </button>
      </section>
    </>
  );
}

function Bubble({
  role,
  kind,
  wide,
  children,
}: {
  role: "user" | "assistant";
  kind?: string;
  wide?: boolean;
  children: React.ReactNode;
}) {
  if (role === "user") {
    return (
      <div className="persona-in max-w-[85%] self-end whitespace-pre-wrap rounded-[22px] rounded-br-md bg-gradient-to-br from-accent to-plum-2 px-4 py-2.5 text-sm text-white shadow-[0_8px_24px_-12px_var(--accent)]">
        {children}
      </div>
    );
  }
  const quiet = kind === "observation" || kind === "reminder";
  return (
    <div
      className={`persona-in self-start whitespace-pre-wrap rounded-[22px] rounded-bl-md px-4 py-2.5 text-sm leading-relaxed ${
        wide ? "w-full" : "max-w-[90%]"
      } ${quiet ? "bg-accent-soft text-foreground" : card}`}
    >
      {children}
    </div>
  );
}

function Chip({
  label,
  active,
  onClick,
  children,
}: {
  label: string;
  active?: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={label}
      aria-label={label}
      aria-pressed={active}
      className={`grid h-8 w-8 place-items-center rounded-full transition-colors ${
        active ? "bg-accent-soft text-accent" : "text-muted hover:bg-accent-soft hover:text-accent"
      }`}
    >
      {children}
    </button>
  );
}

/** A small live waveform: flat when quiet, moving with your voice. */
function Wave({ level }: { level: number }) {
  const bars = [0.5, 0.9, 1, 0.75, 0.45];
  return (
    <svg viewBox="0 0 20 20" width="18" height="18" aria-hidden>
      {bars.map((b, i) => {
        const h = 3 + (level > 0.02 ? b * level * 14 : b * 7);
        return (
          <rect
            key={i}
            x={2 + i * 3.4}
            y={10 - h / 2}
            width="2"
            height={h}
            rx="1"
            fill="currentColor"
            style={{ transition: "all 80ms linear" }}
          />
        );
      })}
    </svg>
  );
}
