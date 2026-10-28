"use client";

import { usePathname, useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";
import {
  personaChatAction,
  personaCheckInAction,
  personaPublishAction,
  personaPulseAction,
  personaSetupAction,
  personaObserveAction,
  personaTeachNoteAction,
  personaTranscribeAction,
  personaVoiceAction,
  personaAgentTurnsAction,
  personaAppConfirmAction,
} from "@/app/actions/persona";
import { toTranscribableWav } from "@/lib/audio/convert";
import type { ChatJob, ChatResult, PublishConfirm } from "@/lib/persona/service";
import type { AppConfirm } from "@/lib/connections/service";
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
import { ExampleCard } from "./example-card";
import { JobCard } from "./job-card";
import { PersonaOrb, type OrbState } from "./orb";
import { MAX_LOOKS, startWatching, watchesWithoutClick, type Watcher } from "./screen-watch";
import { TaskComposer } from "./task-composer";
import {
  chime,
  speak,
  startConversation,
  startHoldRecording,
  stopSpeaking,
  type Conversation,
  type HoldRecording,
  type UtteranceEnd,
} from "./voice";
import { startWakeWord, wakeWordSupported, type WakeListener } from "./wake-listener";
import { startAgentCall, type AgentCall } from "./agent-voice";

export interface CompanionMessage {
  id: string;
  role: "user" | "assistant";
  kind: string;
  content: string;
  jobId?: string | null;
  /** Persuna asked whether to switch to this skill: show Switch / Stay. */
  switchTo?: { slug: string; name: string } | null;
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
  /** On its own page (/companion in a browser tab). */
  standalone?: boolean;
  /** Inside Persona Desktop's see-through layer over the whole screen. */
  overlay?: boolean;
  /** How the server hears speech (VOICE_MODE): "agent" offers ElevenLabs Agents calls. */
  voiceMode?: "listen" | "transcribe" | "agent";
  /** The signed-in person's name, for greetings. */
  userName?: string;
}

type Busy = "idle" | "thinking" | "hearing";

const ORB = 88;

/** What Persona Desktop's preload exposes to the page. */
type DesktopWindow = Window & {
  personaDesktop?: {
    overlay: boolean;
    setInteractive(on: boolean): void;
    hide(): void;
    /** The desktop app's global shortcut (or tray item) was used to call Persuna. */
    onCall?(handler: () => void): void;
    /** The desktop's call shortcut, which the user can change from the menu bar. */
    shortcut?(): Promise<string | null>;
    onShortcut?(handler: (label: string | null) => void): void;
    /** Hold-to-talk from the desktop's key listener: start, end, cancel, or "type" (double tap). */
    onHold?(handler: (phase: "start" | "end" | "cancel" | "type") => void): void;
    /** The hold-to-talk key's label ("right ⌥"), or null when it's off or not allowed yet. */
    holdKey?(): Promise<string | null>;
    onHoldKey?(handler: (label: string | null) => void): void;
  };
};
/** Gap between Persona and the thing it perches beside. */
const PERCH_GAP = 14;
/** How long Persona stays perched or wandering before flying home. */
const PERCH_MS = 7000;
const WANDER_EVERY_MS = [45_000, 90_000] as const;
const CUT_IN = "Sorry to cut in. ";
const noSubscribe = () => () => {};

/** "Good morning" and friends, by the local hour. */
function greeting(hour = new Date().getHours()) {
  return hour < 5
    ? "Up late"
    : hour < 12
      ? "Good morning"
      : hour < 17
        ? "Good afternoon"
        : "Good evening";
}
const WRAP_UP_OFFER = "It's getting late. Want a wrap-up of today?";
/** After this local hour, Persona offers an end-of-day wrap-up (once a day). */
const WRAP_UP_HOUR = 17;
const REMINDER_POLL_MS = 30_000;
/** With no input on the page for this long, Persona dozes until you move. */
const DOZE_MS = 5 * 60_000;
/** A call ends by itself after this long with nobody talking. */
const CALL_IDLE_MS = 45_000;

const card = "bg-card/95 shadow-[0_10px_34px_-14px_rgba(29,22,29,0.35)] ring-1 ring-foreground/5";

/**
 * The shortcut that calls Persuna on a page: ⌃⌥P on a Mac, Ctrl+Alt+P
 * elsewhere (⌘Space and ⌘⇧Space belong to Spotlight and search tools).
 * Persona Desktop has its own, for the whole computer, that you can change.
 */
function isCallKey(e: KeyboardEvent) {
  return e.code === "KeyP" && e.ctrlKey && e.altKey && !e.metaKey && !e.shiftKey;
}

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
 * Persona on screen. Not a chat: a living drop that hovers over the page (or,
 * in Persona Desktop, over every app). Tap it, or press the call shortcut, and
 * it listens hands-free and answers out loud, its words shown for a moment
 * beside it. Right-click it for the few other things it does. Cards appear
 * only when it needs a decision. The full conversation lives on My Persuna.
 */
export function Companion(props: CompanionProps) {
  const [typing, setTyping] = useState(false);
  const [menu, setMenu] = useState(false);
  // Persona Desktop: the panel under the bar (type, recent, quick things), and hold-to-talk.
  const [panel, setPanel] = useState(false);
  const [holding, setHolding] = useState(false);
  const [holdLabel, setHoldLabel] = useState<string | null>(null);
  const holdRec = useRef<Promise<HoldRecording | null> | null>(null);
  const panelInput = useRef<HTMLInputElement | null>(null);
  const [setupLater, setSetupLater] = useState(false);
  const [desktopShortcut, setDesktopShortcut] = useState<string | null>(null);
  // Building a skill by conversation: the example card and the publish confirmation.
  const [example, setExample] = useState<{ slug: string; name: string } | null>(null);
  const [confirm, setConfirm] = useState<PublishConfirm | null>(null);
  const [confirmLower, setConfirmLower] = useState(false);
  // A send or create in the user's apps, waiting for their OK.
  const [appConfirm, setAppConfirm] = useState<AppConfirm | null>(null);
  const offFocusAsked = useRef(false);
  const [dismissedJob, setDismissedJob] = useState<string | null>(null);
  const [setupDone, setSetupDone] = useState(props.setupDone);
  const [name, setName] = useState(props.name);
  const [look, setLook] = useState(props.avatar);
  const [task, setTask] = useState<{ skill: string | null } | null>(null);
  const [messages, setMessages] = useState<CompanionMessage[]>(props.messages);
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
  const [watching, setWatching] = useState(false);
  const [askWatch, setAskWatch] = useState(false);
  const [looks, setLooks] = useState(0);
  const [watchNote, setWatchNote] = useState<string | null>(null);
  const [wakeOn, setWakeOn] = useState(false);
  const [askWake, setAskWake] = useState(false);
  const router = useRouter();
  const watcher = useRef<Watcher | null>(null);
  const conversation = useRef<Conversation | null>(null);
  const agentCall = useRef<AgentCall | null>(null);
  // With ElevenLabs Agents set up, use it unless the user picked Meta's listening.
  const [agentVoice, setAgentVoice] = useState(true);
  const wake = useRef<WakeListener | null>(null);
  const drag = useRef<{ x: number; y: number; ox: number; oy: number; moved: boolean }>(null);
  const home = useRef<{ x: number; y: number } | null>(null);
  const backHome = useRef(0);
  const talkingNow = useRef(false);
  // Lines queued or being spoken.
  const speaking = useRef(0);
  const lastHeard = useRef(0);
  // The desktop app lets Persuna speak before any click (see desktop/main.js).
  const overlayRef = useRef(Boolean(props.overlay));
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
  const live = useRef({
    voiceOn,
    busy,
    talking,
    name,
    focusName: focusSkill?.name ?? null,
  });
  useEffect(() => {
    live.current = { voiceOn, busy, talking, name, focusName: focusSkill?.name ?? null };
  }, [voiceOn, busy, talking, name, focusSkill]);

  /* ---------- Speaking ---------- */

  const showCaption = useCallback((line: string) => {
    window.clearTimeout(captionTimer.current);
    setCaption(line);
    captionTimer.current = window.setTimeout(
      () => setCaption(null),
      Math.min(20_000, 5000 + line.length * 60),
    );
  }, []);

  /**
   * Says a line in full, after anything already being said. Its words appear
   * as they're spoken (`onSpoken`), not all at once beforehand. Resolves
   * false when it couldn't speak (voice off, or the browser needs a click
   * first), so the caller shows the whole line instead.
   */
  const sayAloud = useCallback(
    async (line: string, onSpoken?: (soFar: string) => void): Promise<boolean> => {
      if (!live.current.voiceOn || !line.trim()) return false;
      // Browsers only allow speech after the person has interacted with the page.
      const activation = (navigator as Navigator & { userActivation?: { hasBeenActive: boolean } })
        .userActivation;
      if (activation && !activation.hasBeenActive && !overlayRef.current) {
        queued.current = line;
        return false;
      }
      let soFar = "";
      speaking.current += 1;
      talkingNow.current = true;
      setTalking(true);
      try {
        await speak(line, {
          onLevel: setLevel,
          onSpoken: (piece) => {
            soFar = soFar ? `${soFar} ${piece}` : piece;
            onSpoken?.(soFar);
          },
        });
      } finally {
        speaking.current = Math.max(0, speaking.current - 1);
        if (speaking.current === 0) {
          talkingNow.current = false;
          setTalking(false);
        }
      }
      return true;
    },
    [],
  );

  /** Stop Persona mid-sentence: tapping it, typing, or talking over it. */
  const interrupt = useCallback(() => {
    if (!talkingNow.current) return;
    stopSpeaking();
    speaking.current = 0;
    talkingNow.current = false;
    setTalking(false);
    setLevel(0);
  }, []);

  /**
   * Persona says something: out loud when its voice is on, its words shown
   * beside it as they're spoken; all at once when it's silent.
   */
  const express = useCallback(
    (line: string, lead = "") => {
      // If you're mid-sentence, Persona says so as it cuts in; your words so far are kept.
      const cutting = conversation.current?.userSpeaking() ? CUT_IN : "";
      if (live.current.voiceOn) setCaption(null);
      void sayAloud(`${lead || cutting}${line}`, showCaption).then((spoke) => {
        if (!spoke) showCaption(line);
      });
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
      // In Persona Desktop it stays in its bar at the top of the screen.
      setSpot(overlayRef.current ? { x: 0, y: 0 } : start);
      setVoiceOn(stored("persona.voice", true));
      setAgentVoice(stored("persona.agentVoice", true));
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
        perchBy(document.querySelector(`main a[href="${n.href}"]`));
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
      setMessages((all) => all.filter((m) => m.id !== pending.id));
      answered(res.value, lead);
    },
    // setupReply and answered read live state through refs.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  );

  /**
   * Persona's answer to something you typed or said: show what it set up, and
   * say it (unless the voice agent already has).
   */
  function answered(value: ChatResult, lead = "", spoken = false) {
    const [mine, reply] = value.messages;
    setMessages((all) => [
      ...all,
      { ...mine, role: "user" },
      { ...reply, role: "assistant", link: value.link, switchTo: value.switchTo },
    ]);
    setFocusSkill(value.focus.skill);
    if (value.task) setTask(value.task);
    // A browser only opens its share picker from a click: ask with a button there.
    if (value.watch === "start" && !watcher.current) {
      if (watchesWithoutClick()) void startWatch();
      else setAskWatch(true);
    }
    if (value.watch === "stop") watcher.current?.stop();
    if (value.example) setExample(value.example.skill);
    if (value.appConfirm) setAppConfirm(value.appConfirm);
    if (value.confirm) {
      setConfirm(value.confirm);
      setConfirmLower(false);
    }
    if (value.navigate) {
      const href = value.navigate;
      // Fly to the top of the page, open it, look at its heading.
      flyTo({ x: 24, y: 72 }, -1);
      window.setTimeout(() => router.push(href), 600);
      window.setTimeout(() => perchBy(document.querySelector("main h1")), 1600);
    }
    if (
      value.reminderSet &&
      typeof Notification !== "undefined" &&
      Notification.permission === "default"
    ) {
      void Notification.requestPermission();
    }
    if (!spoken) express(reply.content, lead);
  }

  const hear = useCallback(
    async (audio: Blob, end: UtteranceEnd = "pause") => {
      lastHeard.current = Date.now();
      setBusy("hearing");
      try {
        const wav = await toTranscribableWav(audio, "persona");
        const form = new FormData();
        form.append("audio", wav);
        // A very long turn: Persona cut in, and says so.
        const lead = end === "long" ? CUT_IN : "";
        if (!setupRef.current.done) {
          // The first meeting is scripted here, so it needs the words.
          const res = await personaTranscribeAction(form);
          setBusy("idle");
          if (!res.ok) return setError(res.error);
          if (res.value.trim()) await send(res.value, lead);
          return;
        }
        // Heard and answered in one go: no separate transcription.
        stopSpeaking();
        const res = await personaVoiceAction(form, clock());
        setBusy("idle");
        if (!res.ok) return setError(res.error);
        setError(null);
        answered(res.value, lead);
      } catch {
        setBusy("idle");
        setError("I couldn't make that out. Try again?");
      }
    },
    // answered reads live state through refs.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [send],
  );

  function endConversation() {
    const agent = agentCall.current;
    if (!conversation.current && !agent) return;
    conversation.current?.stop();
    conversation.current = null;
    agentCall.current = null;
    if (agent) {
      void agent.stop();
      talkingNow.current = false;
      setTalking(false);
    }
    setConversing(false);
    chime(false);
  }

  /** A call through ElevenLabs Agents. False when it isn't set up, so the page listens itself. */
  async function startAgentConversation(): Promise<boolean> {
    const started = await startAgentCall({
      onSpeaking: (on) => {
        talkingNow.current = on;
        setTalking(on);
        lastHeard.current = Date.now();
      },
      onLevel: setLevel,
      onReply: (line) => {
        lastHeard.current = Date.now();
        showCaption(line);
        // ElevenLabs carries only the words: fetch what this turn set up on screen.
        void personaAgentTurnsAction().then((res) => {
          if (res.ok) res.value.forEach((value) => answered(value, "", true));
        });
      },
      onHeard: () => (lastHeard.current = Date.now()),
      onEnd: () => {
        if (agentCall.current) {
          agentCall.current = null;
          talkingNow.current = false;
          setTalking(false);
          setConversing(false);
        }
      },
      onError: (message) => setError(message),
    });
    if (!started) return false;
    agentCall.current = started;
    lastHeard.current = Date.now();
    setConversing(true);
    chime(true);
    return true;
  }

  async function toggleConversation() {
    setError(null);
    if (conversation.current || agentCall.current) return endConversation();
    if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === "undefined") {
      setError("This browser can't use the microphone. Type instead.");
      return;
    }
    if (props.voiceMode === "agent" && agentVoice && setupRef.current.done) {
      try {
        if (await startAgentConversation()) return;
      } catch {
        // The voice service is down: listen here instead.
      }
    }
    try {
      conversation.current = await startConversation({
        onLevel: (l) => !talkingNow.current && setLevel(l),
        onUtterance: (audio, end) => void hear(audio, end),
        speaking: () => talkingNow.current,
        busy: () => live.current.busy !== "idle",
        onBargeIn: interrupt,
      });
      lastHeard.current = Date.now();
      setConversing(true);
      chime(true);
    } catch {
      setError("Microphone access was blocked.");
    }
  }

  /* ---------- Hold to talk (Persona Desktop's key, or the panel's mic button) ---------- */

  function holdStart() {
    if (holdRec.current) return;
    lastInput.current = Date.now();
    setDozing(false);
    setMenu(false);
    setError(null);
    setCaption(null);
    if (talkingNow.current) interrupt();
    if (conversation.current || agentCall.current) endConversation();
    setHolding(true);
    holdRec.current = startHoldRecording(setLevel).catch(() => {
      setError("Microphone access was blocked.");
      return null;
    });
  }

  async function holdEnd() {
    const pending = holdRec.current;
    holdRec.current = null;
    setHolding(false);
    const audio = await (await pending)?.stop();
    // Too short or silent: a slip of the finger, not a question.
    if (audio) void hear(audio);
  }

  function holdCancel() {
    const pending = holdRec.current;
    holdRec.current = null;
    setHolding(false);
    void pending?.then((rec) => rec?.cancel());
  }

  function openPanel() {
    setPanel(true);
    setMenu(false);
    window.setTimeout(() => panelInput.current?.focus(), 50);
  }

  /** Tap, shortcut or tray: stop Persuna talking, or start (or end) a conversation. */
  function call() {
    setMenu(false);
    lastInput.current = Date.now();
    setDozing(false);
    // In a voice-agent call, the shortcut or a tap ends the call.
    if (agentCall.current) return endConversation();
    if (talkingNow.current) return interrupt();
    setCaption(null);
    void toggleConversation();
  }

  // A conversation ends by itself when nobody has said anything for a while.
  useEffect(() => {
    if (!conversing) return;
    const timer = window.setInterval(() => {
      const idle = live.current.busy === "idle" && !talkingNow.current;
      if (idle && Date.now() - lastHeard.current > CALL_IDLE_MS) endConversation();
    }, 5000);
    return () => clearInterval(timer);
  }, [conversing]);

  // A click anywhere else closes the menu.
  useEffect(() => {
    if (!menu) return;
    const close = (e: PointerEvent) => {
      if (!(e.target as HTMLElement).closest?.("[role=menu]")) setMenu(false);
    };
    window.addEventListener("pointerdown", close);
    return () => window.removeEventListener("pointerdown", close);
  }, [menu]);

  // The call shortcut on the page, and the desktop app's global one.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (isCallKey(e)) {
        e.preventDefault();
        call();
      } else if (e.key === "Escape") {
        setMenu(false);
        if (talkingNow.current) interrupt();
      }
    };
    window.addEventListener("keydown", onKey);
    const desktop = (window as DesktopWindow).personaDesktop;
    desktop?.onCall?.(call);
    desktop?.onHold?.((phase) => {
      if (phase === "start") void holdStart();
      else if (phase === "end") void holdEnd();
      else if (phase === "cancel") holdCancel();
      else openPanel();
    });
    void desktop?.holdKey?.().then(setHoldLabel);
    desktop?.onHoldKey?.(setHoldLabel);
    void desktop?.shortcut?.().then(setDesktopShortcut);
    desktop?.onShortcut?.(setDesktopShortcut);
    return () => window.removeEventListener("keydown", onKey);
    // call reads live state through refs.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /* ---------- Wake word ---------- */

  useEffect(() => {
    if (!wakeOn || !setupDone) return;
    try {
      wake.current = startWakeWord({
        name: () => live.current.name,
        onWake: (rest) => {
          lastInput.current = Date.now();
          setDozing(false);
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
    if (overlayRef.current) return;
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
      if (el.closest("[data-persona]")) return;
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
    if (overlayRef.current || window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    let timer = 0;
    const plan = () => {
      const [min, max] = WANDER_EVERY_MS;
      timer = window.setTimeout(wander, min + Math.random() * (max - min));
    };
    const wander = () => {
      const s = live.current;
      if (s.busy === "idle" && !s.talking && !drag.current && !document.hidden) {
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
      perchBy(document.querySelector("main h1"), 3500);
    }, 700);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [path]);

  /* ---------- Persona Desktop: clicks pass through except on Persona ---------- */

  useEffect(() => {
    const desktop = (window as DesktopWindow).personaDesktop;
    if (!props.overlay || !desktop) return;
    let interactive = false;
    const onMove = (e: MouseEvent) => {
      // While dragging Persona, keep it holding the pointer.
      if (e.buttons && interactive) return;
      const hit = Boolean(
        (document.elementFromPoint(e.clientX, e.clientY) as HTMLElement | null)?.closest(
          ".pointer-events-auto",
        ),
      );
      if (hit !== interactive) {
        interactive = hit;
        desktop.setInteractive(hit);
      }
    };
    window.addEventListener("mousemove", onMove);
    return () => window.removeEventListener("mousemove", onMove);
  }, [props.overlay]);

  /* ---------- Watching (only with permission) ---------- */

  async function startWatch() {
    setAskWatch(false);
    setError(null);
    let note: string | null = null;
    let count = 0;
    offFocusAsked.current = false;
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
          // What's on screen isn't today's skill: ask once per watching session.
          if (res.value.offFocus && !offFocusAsked.current) {
            offFocusAsked.current = true;
            const line = `This looks like ${res.value.offFocus}${
              live.current.focusName ? `, not ${live.current.focusName}` : ""
            }. Want me to switch? Tell me which skill, or say "new skill" and what it is.`;
            setMessages((all) => [
              ...all,
              { id: `offfocus-${Date.now()}`, role: "assistant", kind: "chat", content: line },
            ]);
            express(line);
          }
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

  /* ---------- Dragging ---------- */

  function onPointerDown(e: React.PointerEvent) {
    // Right-click opens the menu; only the main button drags or taps.
    if (!spot || e.button !== 0) return;
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
    } else onTap();
  }
  function onTap() {
    if (!setupDone && setupLater) return setSetupLater(false);
    // Tapping the wrap-up offer asks for it.
    if (caption === WRAP_UP_OFFER && !talkingNow.current) {
      setCaption(null);
      return void send("Wrap up my day");
    }
    call();
  }

  /* ---------- What it looks like ---------- */

  const orbState: OrbState = holding
    ? "listening"
    : watching
      ? "watching"
      : talking
        ? "speaking"
        : busy !== "idle"
          ? "thinking"
          : conversing
            ? "listening"
            : dozing
              ? "sleeping"
              : "idle";
  const isMac = useSyncExternalStore(
    noSubscribe,
    () => /Mac|iPhone|iPad/.test(navigator.platform),
    () => true,
  );
  const shortcut = desktopShortcut ?? (isMac ? "⌃⌥P" : "Ctrl+Alt+P");
  const status = {
    idle: wakeOn ? `Say "Hey ${name}"` : `Tap or ${shortcut}`,
    listening: "Listening…",
    thinking: busy === "hearing" ? "Hearing you…" : "Thinking…",
    speaking: "Tap to stop",
    watching: `Watching · ${looks} look${looks === 1 ? "" : "s"}`,
    sleeping: "Dozing",
  }[orbState];
  const canWake = useSyncExternalStore(noSubscribe, wakeWordSupported, () => false);
  const published = props.skills.filter((s) => s.published);

  // Quick choices during the first meeting: looks and first tasks.
  const setupChips = (
    <>
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
  );

  // What Persuna is asking you to decide right now (permissions, a task, teaching).
  /** Publishes after the user confirms it. */
  async function publishConfirmed() {
    if (!confirm) return;
    setBusy("thinking");
    const res = await personaPublishAction(confirm.skill.slug, confirm.versionId, confirmLower);
    setBusy("idle");
    if (!res.ok) return setError(res.error);
    setConfirm(null);
    setMessages((all) => [
      ...all,
      { ...res.value.message, role: "assistant", link: res.value.link },
    ]);
    express(res.value.message.content);
  }

  /** Does the send or create the user just OK'd. */
  async function appConfirmed() {
    if (!appConfirm) return;
    setBusy("thinking");
    const res = await personaAppConfirmAction(appConfirm.token);
    setBusy("idle");
    setAppConfirm(null);
    if (!res.ok) return setError(res.error);
    setMessages((all) => [
      ...all,
      { ...res.value.message, role: "assistant", link: res.value.link },
    ]);
    express(res.value.message.content);
  }

  const lastMessage = messages.at(-1);
  const switchOffer = lastMessage?.role === "assistant" ? lastMessage.switchTo : null;

  const assistCards = (
    <>
      {switchOffer && busy === "idle" && (
        <div
          className={`persona-in flex items-center gap-2 self-start rounded-full px-2 py-1.5 text-sm ${card}`}
        >
          <button
            type="button"
            onClick={() => void send(`Yes, switch to ${switchOffer.name}`)}
            className="rounded-full bg-accent px-4 py-1.5 text-accent-ink"
          >
            Switch to {switchOffer.name}
          </button>
          <button
            type="button"
            onClick={() => void send(`No, stay on ${focusSkill?.name ?? "this"}`)}
            className="rounded-full px-3 py-1.5 text-muted hover:text-foreground"
          >
            Stay
          </button>
        </div>
      )}
      {example && (
        <div className={`persona-in rounded-[22px] ${card}`}>
          <ExampleCard
            skill={example}
            onCancel={() => setExample(null)}
            onDone={(message) => {
              setExample(null);
              setMessages((all) => [...all, message]);
              express(message.content);
            }}
          />
        </div>
      )}
      {confirm && (
        <div className={`persona-in space-y-3 rounded-[22px] p-4 text-sm ${card}`}>
          <p>
            <strong>
              Publish {confirm.skill.name} version {confirm.version}?
            </strong>{" "}
            It scored {confirm.score} against your held-back examples. Real jobs will use it, and
            its trust level starts again at 0, so I&apos;ll send you everything to approve.
          </p>
          {confirm.lowerThan !== null && (
            <label className="flex items-start gap-2 text-warn">
              <input
                type="checkbox"
                checked={confirmLower}
                onChange={(e) => setConfirmLower(e.target.checked)}
                className="mt-1"
              />
              It scores lower than the version live now ({confirm.lowerThan}). Publish anyway.
            </label>
          )}
          <div className="flex gap-2">
            <button
              type="button"
              disabled={busy !== "idle" || (confirm.lowerThan !== null && !confirmLower)}
              onClick={() => void publishConfirmed()}
              className="rounded-full bg-accent px-4 py-1.5 text-accent-ink disabled:opacity-50"
            >
              Publish
            </button>
            <button
              type="button"
              onClick={() => setConfirm(null)}
              className="rounded-full px-3 py-1.5 text-muted hover:text-foreground"
            >
              Not yet
            </button>
          </div>
        </div>
      )}
      {appConfirm && (
        <div className={`persona-in space-y-3 rounded-[22px] p-4 text-sm ${card}`}>
          <p className="label-mono text-muted">{appConfirm.app}</p>
          <p className="max-h-48 overflow-y-auto whitespace-pre-wrap">{appConfirm.preview}</p>
          <div className="flex gap-2">
            <button
              type="button"
              disabled={busy !== "idle"}
              onClick={() => void appConfirmed()}
              className="rounded-full bg-accent px-4 py-1.5 text-accent-ink disabled:opacity-50"
            >
              Go ahead
            </button>
            <button
              type="button"
              onClick={() => setAppConfirm(null)}
              className="rounded-full px-3 py-1.5 text-muted hover:text-foreground"
            >
              Cancel
            </button>
          </div>
        </div>
      )}
      {askWake && (
        <div className={`persona-in space-y-2 rounded-[22px] p-4 text-sm ${card}`}>
          <p>
            <strong>Say &ldquo;Hey {name}&rdquo; to wake me.</strong> While this is on, your browser
            listens for my name. In Chrome and Edge, that listening is done by the browser
            maker&apos;s speech service, not by PERSUNA. I start a conversation when I hear my name;
            nothing else is kept. Turn it off any time.
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
            {props.overlay ? (
              <>
                <strong>Let me watch while you work.</strong> I&apos;ll watch your whole screen or
                one app you choose (I&apos;ll ask once, and remember). I never see myself.
              </>
            ) : (
              <>
                <strong>Pick one window for me to watch.</strong> It can be any app (Figma, your
                video editor, a spreadsheet): choose it under &ldquo;Window&rdquo;.
              </>
            )}{" "}
            I look every 30 seconds while it changes, write down your <em>steps</em>, skip names and
            figures, and keep no screenshots. Stop any time.
          </p>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => void startWatch()}
              className="rounded-full bg-accent px-4 py-1.5 text-sm text-accent-ink"
            >
              {props.overlay ? "Start watching" : "Choose a window"}
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
  );

  if (!spot) return null;
  const right = spot.x + ORB / 2 > window.innerWidth / 2;
  const low = spot.y > 360;
  const side = right ? "right-[calc(100%+12px)] items-end" : "left-[calc(100%+12px)] items-start";
  const latestJob = [...messages].reverse().find((m) => m.jobId && m.jobId !== dismissedJob);
  // The first meeting's box can be put away until they're ready (it can sit over a page's buttons).
  const showSetupInput = !setupDone && busy === "idle" && !setupLater;
  const hasCards =
    (!setupDone && (setupStep === "look" || setupStep === "task")) ||
    (setupDone &&
      (askWake ||
        askWatch ||
        Boolean(task) ||
        Boolean(example) ||
        Boolean(confirm) ||
        Boolean(appConfirm) ||
        Boolean(switchOffer && busy === "idle") ||
        Boolean(watchNote && !watching))) ||
    Boolean(latestJob);

  const menuItems: { label: string; onSelect: () => void; hidden?: boolean }[] = [
    { label: "Type instead", onSelect: () => (props.overlay ? openPanel() : setTyping(true)) },
    {
      label: watching ? "Stop watching" : "Watch my screen",
      onSelect: () => (watching ? watcher.current?.stop() : setAskWatch(true)),
    },
    {
      label: voiceOn ? "Mute my voice" : "Talk out loud",
      onSelect: () => {
        const next = !voiceOn;
        setVoiceOn(next);
        store("persona.voice", next);
        if (!next) stopSpeaking();
      },
    },
    {
      label: agentVoice ? "Hear me with Meta instead" : "Hear me with ElevenLabs (faster)",
      onSelect: () => {
        endConversation();
        setAgentVoice(!agentVoice);
        store("persona.agentVoice", !agentVoice);
      },
      hidden: props.voiceMode !== "agent",
    },
    {
      label: wakeOn ? `Stop listening for "Hey ${name}"` : `Listen for "Hey ${name}"`,
      onSelect: () => (wakeOn ? setWake(false) : setAskWake(true)),
      hidden: !canWake,
    },
    {
      label: "Conversation and notes",
      onSelect: () => window.open("/persona#conversation", props.overlay ? "_blank" : "_self"),
    },
    {
      label: `Hide ${name}`,
      onSelect: () => (window as DesktopWindow).personaDesktop?.hide(),
      hidden: !props.overlay,
    },
  ];

  if (props.overlay) {
    const talkHint = holdLabel ? `Hold ${holdLabel} to talk` : `${shortcut} to talk`;
    const barStatus =
      orbState === "idle" || orbState === "sleeping"
        ? setupDone
          ? talkHint
          : "Say hello"
        : holding
          ? "Listening… let go when you're done"
          : status;
    const recent = messages.filter((m) => m.kind === "chat").slice(-2);
    const firstName = props.userName?.split(/\s+/)[0] ?? "";
    return (
      <section
        data-persona
        aria-label={`${name}, your assistant`}
        className="pointer-events-none fixed inset-x-0 top-2 z-50 flex flex-col items-center gap-2"
      >
        {/* The bar: Persuna and what it's doing. Click for the panel, right-click for more. */}
        <div
          className={`pointer-events-auto flex items-center gap-3 rounded-full py-1.5 pl-1.5 pr-5 ${glass} ring-accent/15 ${
            holding ? "ring-2 ring-accent/50" : ""
          }`}
        >
          <button
            type="button"
            aria-label={`${name}: ${panel ? "close" : "open"} (${barStatus})`}
            aria-expanded={panel}
            aria-haspopup="menu"
            onClick={() =>
              talkingNow.current ? interrupt() : panel ? setPanel(false) : openPanel()
            }
            onContextMenu={(e) => {
              e.preventDefault();
              setMenu((m) => !m);
            }}
            className="flex items-center gap-3 rounded-full text-left outline-none focus-visible:ring-2 focus-visible:ring-accent"
          >
            <PersonaOrb look={look} state={orbState} level={level} size={38} gaze={null} />
            <span className="flex min-w-36 flex-col">
              <span className="font-display text-sm font-medium leading-tight">{name}</span>
              <span className="label-mono text-[10px] text-muted" role="status">
                {barStatus}
              </span>
            </span>
          </button>
          {(holding || orbState === "listening") && (
            <span aria-hidden className="flex h-5 items-center gap-[3px]">
              {[0.5, 0.8, 1, 0.8, 0.5].map((w, i) => (
                <span
                  key={i}
                  className="w-[3px] rounded-full bg-accent transition-[height] duration-75"
                  style={{ height: `${Math.max(3, Math.min(20, level * 26 * w + 3))}px` }}
                />
              ))}
            </span>
          )}
        </div>

        {caption && (
          <button
            type="button"
            onClick={onTap}
            className={`persona-in pointer-events-auto max-w-[min(34rem,90vw)] rounded-[22px] px-5 py-3 text-left text-sm leading-snug ${glass}`}
          >
            {caption.length > 320 ? `${caption.slice(0, 320)}…` : caption}
          </button>
        )}
        {error && (
          <p className="persona-in pointer-events-auto rounded-full bg-danger/10 px-3 py-1.5 text-sm text-danger backdrop-blur">
            {error}
          </p>
        )}

        {panel && setupDone && (
          <div
            className={`persona-in pointer-events-auto w-[min(28rem,92vw)] space-y-4 rounded-[26px] p-5 ${glass}`}
          >
            <div>
              <p className="label-mono text-[10px] text-muted">{greeting()}</p>
              <h2 className="font-display text-xl font-medium tracking-[-0.02em]">
                {firstName ? `${firstName}, what's next?` : "What's next?"}
              </h2>
              <p className="mt-1 text-sm text-muted">
                {focusSkill
                  ? `Today: ${focusSkill.name}.`
                  : (props.focus ?? "Tell me what you're working on.")}{" "}
                {talkHint}, or type below.
              </p>
            </div>
            {recent.length > 0 && (
              <ul className="space-y-1.5 text-sm">
                {recent.map((m) => (
                  <li key={m.id} className={m.role === "user" ? "text-muted" : "text-foreground"}>
                    <span className="label-mono mr-2 text-[10px] text-faint">
                      {m.role === "user" ? "You" : name}
                    </span>
                    {m.content.length > 160 ? `${m.content.slice(0, 160)}…` : m.content}
                  </li>
                ))}
              </ul>
            )}
            <form
              onSubmit={(e) => {
                e.preventDefault();
                void send(text);
              }}
              className="flex items-center gap-1.5 rounded-full bg-card p-1.5 pl-4 ring-1 ring-line-strong focus-within:ring-accent"
            >
              <label className="sr-only" htmlFor="persona-panel-input">
                Message {name}
              </label>
              <input
                id="persona-panel-input"
                ref={panelInput}
                value={text}
                onChange={(e) => {
                  interrupt();
                  setText(e.target.value);
                }}
                onKeyDown={(e) => e.key === "Escape" && setPanel(false)}
                autoComplete="off"
                placeholder={`Ask ${name} anything…`}
                className="min-w-0 flex-1 bg-transparent text-sm outline-none placeholder:text-faint focus-visible:outline-none"
              />
              <button
                type="button"
                aria-label="Hold to talk"
                title="Hold to talk"
                onPointerDown={() => holdStart()}
                onPointerUp={() => void holdEnd()}
                onPointerLeave={() => holding && void holdEnd()}
                className={`grid h-8 w-8 shrink-0 place-items-center rounded-full ${
                  holding ? "bg-accent text-accent-ink" : "text-muted hover:text-accent"
                }`}
              >
                <Icon name="mic" />
              </button>
              <button
                type="submit"
                disabled={!text.trim()}
                aria-label="Send"
                className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-accent text-accent-ink disabled:opacity-30"
              >
                <Icon name="send" />
              </button>
            </form>
            <div className="flex flex-wrap gap-1.5">
              {[
                [
                  watching ? "Stop watching" : "Watch my screen",
                  () => (watching ? watcher.current?.stop() : setAskWatch(true)),
                ],
                ["Wrap up my day", () => void send("Wrap up my day")],
                ["My to-dos", () => void send("What's on my to-do list?")],
              ].map(([label, act]) => (
                <button
                  key={label as string}
                  type="button"
                  onClick={act as () => void}
                  className="label-mono rounded-full px-3 py-1.5 text-[10px] text-muted ring-1 ring-line-strong hover:text-accent hover:ring-accent/40"
                >
                  {label as string}
                </button>
              ))}
            </div>
          </div>
        )}

        {(hasCards || showSetupInput) && (
          <div className="pointer-events-auto flex w-[min(28rem,92vw)] flex-col gap-2">
            {!setupDone ? setupChips : assistCards}
            {latestJob?.jobId && (
              <div className={`persona-in rounded-[22px] p-3 text-sm ${glass}`}>
                <div className="flex items-center gap-2">
                  <span className="flex-1">{latestJob.content}</span>
                  <button
                    type="button"
                    onClick={() => setDismissedJob(latestJob.jobId!)}
                    aria-label="Close"
                    className="text-muted hover:text-foreground"
                  >
                    ×
                  </button>
                </div>
                <JobCard jobId={latestJob.jobId} initial={latestJob.job} />
              </div>
            )}
            {showSetupInput && (
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  void send(text);
                }}
                className={`persona-in flex items-center gap-1.5 rounded-full p-1.5 pl-4 ${glass}`}
              >
                <input
                  aria-label={`Message ${name}`}
                  value={text}
                  onChange={(e) => setText(e.target.value)}
                  onKeyDown={(e) => e.key === "Escape" && setSetupLater(true)}
                  autoComplete="off"
                  placeholder="Type, or hold to talk"
                  className="min-w-0 flex-1 bg-transparent text-sm outline-none placeholder:text-faint"
                />
                <button
                  type="submit"
                  disabled={!text.trim()}
                  aria-label="Send"
                  className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-accent text-accent-ink disabled:opacity-30"
                >
                  <Icon name="send" />
                </button>
              </form>
            )}
          </div>
        )}

        {menu && setupDone && (
          <div
            role="menu"
            aria-label={`${name}'s menu`}
            className={`persona-in pointer-events-auto flex w-60 flex-col rounded-2xl p-1.5 text-sm ${glass}`}
          >
            {menuItems
              .filter((item) => !item.hidden)
              .map((item) => (
                <button
                  key={item.label}
                  type="button"
                  role="menuitem"
                  onClick={() => {
                    setMenu(false);
                    item.onSelect();
                  }}
                  className="rounded-xl px-3 py-2 text-left hover:bg-accent-soft hover:text-accent"
                >
                  {item.label}
                </button>
              ))}
            <p className="label-mono px-3 pb-1 pt-2 text-[10px] text-muted">
              {talkHint} · double-tap to type
            </p>
          </div>
        )}
      </section>
    );
  }

  return (
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
      {/* Beside Persuna: what it's saying, and a card when it needs a decision. */}
      <div
        className={`absolute flex w-max max-w-80 flex-col gap-2 ${side} ${low ? "bottom-6" : "top-2"}`}
        aria-live="polite"
      >
        {hasCards && (
          <div className="pointer-events-auto flex w-80 flex-col gap-2">
            {!setupDone ? setupChips : assistCards}
            {latestJob?.jobId && (
              <div className={`persona-in rounded-[22px] p-3 text-sm ${glass}`}>
                <div className="flex items-center gap-2">
                  <span className="flex-1">{latestJob.content}</span>
                  <button
                    type="button"
                    onClick={() => setDismissedJob(latestJob.jobId!)}
                    aria-label="Close"
                    className="text-muted hover:text-foreground"
                  >
                    ×
                  </button>
                </div>
                <JobCard jobId={latestJob.jobId} initial={latestJob.job} />
              </div>
            )}
          </div>
        )}
        {caption && (
          <button
            type="button"
            onClick={onTap}
            className={`persona-in pointer-events-auto max-w-80 px-4 py-2.5 text-left text-sm leading-snug ${glass} rounded-[22px] ${
              right ? "rounded-tr-md" : "rounded-tl-md"
            }`}
          >
            {caption.length > 260 ? `${caption.slice(0, 260)}…` : caption}
          </button>
        )}
        {error && (
          <p className="persona-in pointer-events-auto rounded-full bg-danger/10 px-3 py-1.5 text-sm text-danger backdrop-blur">
            {error}
          </p>
        )}
        {(typing || showSetupInput) && (
          <form
            onSubmit={(e) => {
              e.preventDefault();
              void send(text);
              if (setupDone) setTyping(false);
            }}
            className={`persona-in pointer-events-auto flex w-80 items-center gap-1.5 rounded-full p-1.5 pl-4 ${glass}`}
          >
            <label className="sr-only" htmlFor="persona-input">
              Message {name}
            </label>
            <input
              id="persona-input"
              autoFocus
              value={text}
              onChange={(e) => {
                interrupt();
                setText(e.target.value);
              }}
              onKeyDown={(e) => {
                if (e.key !== "Escape") return;
                if (setupDone) setTyping(false);
                else setSetupLater(true);
              }}
              onBlur={() => setupDone && !text.trim() && setTyping(false)}
              autoComplete="off"
              placeholder={setupDone ? `Type to ${name}…` : "Type, or tap me and just talk"}
              className="min-w-0 flex-1 bg-transparent text-sm outline-none placeholder:text-faint"
            />
            <button
              type="submit"
              disabled={!text.trim()}
              aria-label="Send"
              className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-ink text-ink-foreground disabled:opacity-30"
            >
              <Icon name="send" />
            </button>
            {!setupDone && (
              <button
                type="button"
                onClick={() => setSetupLater(true)}
                title="Put this away; tap me when you're ready"
                className="label-mono shrink-0 px-2 text-[10px] text-muted hover:text-foreground"
              >
                Later
              </button>
            )}
          </form>
        )}
      </div>

      {menu && setupDone && (
        <div
          role="menu"
          aria-label={`${name}'s menu`}
          className={`persona-in pointer-events-auto absolute bottom-[calc(100%+6px)] flex w-56 flex-col rounded-2xl p-1.5 text-sm ${glass} ${
            right ? "right-0" : "left-0"
          }`}
        >
          {menuItems
            .filter((item) => !item.hidden)
            .map((item) => (
              <button
                key={item.label}
                type="button"
                role="menuitem"
                onClick={() => {
                  setMenu(false);
                  item.onSelect();
                }}
                className="rounded-xl px-3 py-2 text-left hover:bg-accent-soft hover:text-accent"
              >
                {item.label}
              </button>
            ))}
          <p className="label-mono px-3 pb-1 pt-2 text-[10px] text-muted">
            {shortcut} calls me from anywhere
          </p>
        </div>
      )}

      {/* Persuna. Tap to talk, right-click for more, drag to move. */}
      <button
        type="button"
        aria-label={`${name}: ${conversing ? "stop talking" : talking ? "interrupt" : "talk"} (${status})`}
        aria-pressed={conversing}
        aria-haspopup="menu"
        title={`Tap to talk · right-click for more · ${shortcut}`}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onContextMenu={(e) => {
          e.preventDefault();
          setMenu((m) => !m);
        }}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            onTap();
          } else if (e.key === "ContextMenu" || (e.shiftKey && e.key === "F10")) {
            e.preventDefault();
            setMenu((m) => !m);
          }
        }}
        style={{
          touchAction: "none",
          transform: `rotate(${tilt}deg)`,
          transition: "transform .6s ease",
        }}
        className="pointer-events-auto cursor-grab select-none rounded-full outline-none focus-visible:ring-2 focus-visible:ring-accent active:cursor-grabbing"
      >
        <span className="flex flex-col items-center">
          <span className={orbState === "sleeping" ? "" : "persona-float"}>
            <PersonaOrb look={look} state={orbState} level={level} size={ORB} gaze={gaze} />
          </span>
          <span className="label-mono -mt-1 max-w-44 truncate text-[10px] text-muted" role="status">
            {status}
          </span>
        </span>
      </button>
      {/* Talking or typing: both are always one step away. */}
      {setupDone && !typing && (
        <button
          type="button"
          onClick={() => setTyping(true)}
          className="label-mono pointer-events-auto mx-auto mt-1 flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] text-muted hover:text-accent"
        >
          <Icon name="keyboard" /> Type
        </button>
      )}
    </section>
  );
}
