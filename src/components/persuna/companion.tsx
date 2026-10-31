"use client";

import { usePathname, useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";
import {
  persunaCheckInAction,
  persunaPublishAction,
  persunaPulseAction,
  persunaSetupAction,
  persunaObserveAction,
  persunaFastAction,
  persunaTeachNoteAction,
  persunaTranscribeAction,
  persunaAgentTurnsAction,
  persunaAppConfirmAction,
  persunaMcpConfirmAction,
  persunaOperateApproveAction,
  persunaOperateCancelAction,
  persunaOperateSettleAction,
  persunaFileAction,
  persunaWorkAction,
  persunaEpisodeBatchAction,
  persunaEpisodeFinalizeAction,
} from "@/app/actions/persuna";
import { toTranscribableWav } from "@/lib/audio/convert";
import type { ChatJob, ChatResult, Drawing, MadeFile, PublishConfirm } from "@/lib/persuna/service";
import type { AppConfirm } from "@/lib/connections/service";
import type { McpConfirm } from "@/lib/mcp/service";
import type { OperateConfirm } from "@/lib/operate/service";
import type { OperateAction } from "@/lib/operate/actions";
import { parseFastIntent } from "@/lib/persuna/intents";
import { warmHearing } from "@/components/persuna/live-hearing";
import {
  pictureNeeded,
  sceneIsThin,
  sceneWithin,
  type Scene,
  type Spot,
} from "@/lib/persuna/scene";
import { LOOKS, LOOK_IDS, lookOf } from "@/lib/persuna/looks";
import {
  SETUP_QUESTIONS,
  parseFirstTask,
  parseLook,
  parseName,
  type SetupStep,
} from "@/lib/persuna/onboarding";
import { clock } from "./clock";
import { Icon } from "./icons";
import { ExampleCard } from "./example-card";
import { JobCard } from "./job-card";
import { PersunaOrb, type OrbState } from "./orb";
import { MAX_LOOKS, startWatching, watchesWithoutClick, type Watcher } from "./screen-watch";
import { TaskComposer } from "./task-composer";
import { MadeFileCard } from "./made-file";
import { WorkDot, type DotTone } from "./work-dot";
import { dotLine, islandQuiet, talkStatus } from "./dot-talk";
import { stayOnScreen, wantsSight } from "./sight-gate";
import {
  isExcludedApp,
  modeForTurn,
  workAutoOffDue,
  type TurnMode,
} from "@/lib/persuna/screen-mode";
import { FRESH_CHECK_MS, shouldRefresh } from "./fresh";
import { CircleLayer, CircledMark, DrawingLayer, cropPicture, type Area } from "./screen-drawing";
import {
  WORK_EVERY_MS,
  mayInterrupt,
  extendTrail,
  sceneDigest,
  trailLine,
} from "@/lib/persuna/work";
import {
  chime,
  createSpeechQueue,
  readTurnStream,
  warmVoice,
  ackTick,
  speak,
  startConversation,
  startHoldRecording,
  stopSpeaking,
  type Conversation,
  type HoldRecording,
  type SpeechQueue,
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
  /** The persuna's look (see `lib/persuna/looks`). */
  avatar: string;
  focus: string | null;
  focusSkill: { slug: string; name: string } | null;
  messages: CompanionMessage[];
  setupDone: boolean;
  wrapupDay: string | null;
  skills: { slug: string; name: string; published: boolean }[];
  /** On its own page (/companion in a browser tab). */
  standalone?: boolean;
  /** Inside Persuna Desktop's see-through layer over the whole screen. */
  overlay?: boolean;
  /** The deployment this page came from, to notice a newer one (see fresh.ts). */
  build?: string | null;
  /** How the server hears speech (VOICE_MODE): "agent" offers ElevenLabs Agents calls. */
  voiceMode?: "listen" | "transcribe" | "agent";
  /** The signed-in person's name, for greetings. */
  userName?: string;
}

type Busy = "idle" | "thinking" | "hearing";

const ORB = 88;

/** What Persuna Desktop's preload exposes to the page. */
/** One batch from the desktop's Learn stream: events, and a screenshot at most. */
type LearnBatch = {
  events: {
    at: string;
    app: string;
    window: string;
    action: "switch" | "focus" | "select" | "open" | "close";
    role: string;
    label: string;
  }[];
  frame: { image: string; at: string } | null;
  denied?: boolean;
};

type DesktopBridge = {
  overlay: boolean;
  setInteractive(on: boolean): void;
  hide(): void;
  /** The desktop app's global shortcut (or tray item) was used to call Persuna. */
  onCall?(handler: () => void): void;
  /** The desktop's call shortcut, which the user can change from the menu bar. */
  shortcut?(): Promise<string | null>;
  onShortcut?(handler: (label: string | null) => void): void;
  /**
   * A screenshot of the screen right now (Persuna itself left out), or null
   * without Screen Recording. Taken as you speak or send, so it can see what you mean.
   * `{ excluded: true }` when the front app is on the never-read list: nothing
   * was captured, and nothing about the screen travels with this turn.
   */
  look?(): Promise<{ image: string; scene: Scene | null } | { excluded: true; app: string } | null>;
  /** The front apps never to read, by name; the desktop refuses looks at them. */
  setExcludedApps?(apps: string[]): void;
  /** Tell the desktop's menu bar whether Work mode is on. */
  setMode?(mode: { work: boolean }): void;
  /** The desktop's menu bar toggled Work mode. */
  onSetWork?(handler: (on: boolean) => void): void;
  /** Learn mode: stream accessibility events while recording, or stop. */
  startLearn?(): void;
  stopLearn?(): void;
  onLearn?(handler: (batch: LearnBatch) => void): void;
  /** Hold-to-talk from the desktop's key listener: start, end, cancel, or "type" (double tap). */
  onHold?(handler: (phase: "start" | "end" | "cancel" | "type") => void): void;
  /** The hold-to-talk key's label ("right ⌥"), or null when it's off or not allowed yet. */
  holdKey?(): Promise<string | null>;
  onHoldKey?(handler: (label: string | null) => void): void;
  /** Tell the app watching started or stopped. */
  watching?(on: boolean): void;
  island?(): Promise<{ notch: boolean; height: number; notchWidth: number }>;
  permissions?(): Promise<Record<
    Permission,
    "granted" | "denied" | "not-determined" | string
  > | null>;
  askPermission?(kind: Permission): Promise<string>;
  focus?(): void;
  onCircle?(handler: () => void): void;
  nudge?(): void;
  updateState?(): Promise<UpdateState | null>;
  onUpdate?(handler: (state: UpdateState) => void): void;
  installUpdate?(): void;
  copy?(text: string): void;
  paste?(text: string): Promise<boolean>;
  /**
   * Work mode: run one approved desktop action. Reports how it went: done,
   * took_over (the user moved the mouse), failed, or denied (no permission).
   */
  operate?(action: OperateAction): Promise<{
    status: "done" | "took_over" | "failed" | "denied";
    detail?: string | null;
  }>;
  /** Stop word: abort the running action. */
  cancelOperate?(): void;
  saveFile?(file: { name: string; ext: string; data: string }): Promise<string | null>;
  savePdf?(doc: { name: string; html: string }): Promise<string | null>;
  onIsland?(handler: (shape: { notch: boolean; height: number; notchWidth: number }) => void): void;
};

type DesktopWindow = Window & {
  persunaDesktop?: DesktopBridge;
  /** The same bridge under its pre-rename name, from Persuna Desktop before 0.7. */
  personaDesktop?: DesktopBridge;
};

/**
 * The desktop app's bridge, whichever name the installed version exposes.
 * Desktop releases before the Persuna rename call it personaDesktop; the
 * page must keep working with them until everyone has updated the app.
 */
function desktopBridge(): DesktopBridge | undefined {
  if (typeof window === "undefined") return undefined;
  const w = window as DesktopWindow;
  return w.persunaDesktop ?? w.personaDesktop;
}
/** Gap between Persuna and the thing it perches beside. */
const PERCH_GAP = 14;
/** How long Persuna stays perched or wandering before flying home. */
const PERCH_MS = 7000;
const WANDER_EVERY_MS = [45_000, 90_000] as const;
const CUT_IN = "Sorry to cut in. ";
const noSubscribe = () => () => {};
/** How long a highlight stays on screen. */
const POINT_MS = 9000;
/** Work mode looks again once the pointer has rested on one thing this long. */
const LINGER_MS = 4000;

/** Things Persuna Desktop needs the Mac's permission for, asked for in the island. */
/** Persuna Desktop's updater, as the island shows it (see desktop/updater.js). */
interface UpdateState {
  status: "idle" | "checking" | "downloading" | "ready" | "manual" | "error";
  version?: string;
  progress?: number;
}

type Permission = "mic" | "screen" | "keyboard";
const NEEDS: Record<Permission, string> = {
  mic: "I need your microphone to hear you.",
  screen:
    "I need Screen Recording to see your screen. Switch Persuna on in the list that opens, then quit and reopen Persuna.",
  keyboard:
    "I need Accessibility for the talk key, reading apps and pasting. Switch Persuna on in the list that opens.",
};

const WRAP_UP_OFFER = "It's getting late. Want a wrap-up of today?";
/** After this local hour, Persuna offers an end-of-day wrap-up (once a day). */
const WRAP_UP_HOUR = 17;
const REMINDER_POLL_MS = 30_000;
/** With no input on the page for this long, Persuna dozes until you move. */
const DOZE_MS = 5 * 60_000;
/** A call ends by itself after this long with nobody talking. */
const CALL_IDLE_MS = 45_000;

const CARD = "bg-card/95 shadow-[0_10px_34px_-14px_rgba(29,22,29,0.35)] ring-1 ring-foreground/5";
/** Everything that comes out of the island is solid black, like the notch it grows from. */
const ISLAND_CARD =
  "bg-black text-white shadow-[0_14px_40px_-16px_rgba(0,0,0,0.75)] ring-1 ring-white/10";
const CHIP =
  "label-mono rounded-full bg-white/10 px-3 py-1.5 text-[10px] text-white/85 hover:bg-white/20 disabled:opacity-40";

/**
 * The shortcut that calls Persuna on a page: ⌃⌥P on a Mac, Ctrl+Alt+P
 * elsewhere (⌘Space and ⌘⇧Space belong to Spotlight and search tools).
 * Persuna Desktop has its own, for the whole computer, that you can change.
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
 * Persuna on screen. Not a chat: a living drop that hovers over the page (or,
 * in Persuna Desktop, over every app). Tap it, or press the call shortcut, and
 * it listens hands-free and answers out loud, its words shown for a moment
 * beside it. Right-click it for the few other things it does. Cards appear
 * only when it needs a decision. The full conversation lives on My Persuna.
 */
export function Companion(props: CompanionProps) {
  const [typing, setTyping] = useState(false);
  const [menu, setMenu] = useState(false);
  // Persuna Desktop: the panel under the bar (type, recent, quick things), and hold-to-talk.
  const [panel, setPanel] = useState(false);
  const [holding, setHolding] = useState(false);
  const [holdLabel, setHoldLabel] = useState<string | null>(null);
  // Where Persuna is pointing on screen (Persuna Desktop), for a few seconds.
  const [pointAt, setPointAt] = useState<Spot | null>(null);
  const pointTimer = useRef(0);
  // Persuna Desktop's island: on the notch, or hanging from the top centre.
  const [island, setIsland] = useState({ notch: false, height: 34, notchWidth: 0 });
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
  // A tool call on one of the user's MCP servers, waiting for their OK.
  const [mcpConfirm, setMcpConfirm] = useState<McpConfirm | null>(null);
  // One desktop action in Work mode, waiting for their OK — then running it.
  const [operateConfirm, setOperateConfirm] = useState<OperateConfirm | null>(null);
  const [operating, setOperating] = useState<{ preview: string } | null>(null);
  const operatingRef = useRef<{ execToken: string; proposalToken: string } | null>(null);
  const stoppedRef = useRef(false);
  const offFocusAsked = useRef(false);
  const [dismissedJob, setDismissedJob] = useState<string | null>(null);
  const [setupDone, setSetupDone] = useState(props.setupDone);
  const [name, setName] = useState(props.name);
  const [look, setLook] = useState(props.avatar);
  const [task, setTask] = useState<{ skill: string | null } | null>(null);
  const [messages, setMessages] = useState<CompanionMessage[]>(props.messages);
  const messagesRef = useRef(messages);
  useEffect(() => {
    messagesRef.current = messages;
  }, [messages]);
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
  // Where Persuna is (top-left of the orb, in px). It roams and returns home.
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
  // What Persuna drew over the screen, and a file it made.
  const [drawing, setDrawing] = useState<Drawing | null>(null);
  // While a drawing is read out, its steps follow the spoken words.
  const [speakProgress, setSpeakProgress] = useState<number | null>(null);
  const spokenChars = useRef(0);
  const speakTotal = useRef(0);
  const [made, setMade] = useState<MadeFile | null>(null);
  // Circle something to ask about it: picking, then the area picked (until the next message).
  const [circling, setCircling] = useState(false);
  const [circled, setCircled] = useState<{ area: Area; path: string } | null>(null);
  // A permission the island is asking for (only when you use what needs it).
  const [need, setNeed] = useState<Permission | null>(null);
  // A new Persuna Desktop downloading or ready (shown in the island), and
  // the version you said "Later" to.
  const [update, setUpdate] = useState<UpdateState | null>(null);
  const [updateLater, setUpdateLater] = useState<string | null>(null);
  const perms = useRef<Record<string, string> | null>(null);
  // Work mode learned enough steps to teach today's skill.
  const [teachOffer, setTeachOffer] = useState<{
    noteId: string;
    skill: string;
    steps: number;
  } | null>(null);
  const [drawPace, setDrawPace] = useState(1100);
  // Work mode's dot: its colour, whether it's looking, and what it's saying.
  const [dotTone, setDotTone] = useState<DotTone>("new");
  const [dotLooking, setDotLooking] = useState(false);
  const [dotBubble, setDotBubble] = useState<string | null>(null);
  // In Work mode the dot also carries talk: the last reply or error said there.
  const [dotTalk, setDotTalk] = useState<string | null>(null);
  const dotTalkTimer = useRef(0);
  const dotTalkRef = useRef<string | null>(null);
  const workModeRef = useRef(false);
  // The screen, read a moment ago: back-to-back turns reuse it for a few
  // seconds, and holding the talk key starts the next read straight away.
  const sightCache = useRef<{
    at: number;
    value: { scene: Scene | null; image: string | null };
  } | null>(null);
  const sightPromise = useRef<Promise<{ scene: Scene | null; image: string | null } | null> | null>(
    null,
  );
  // The last turn was about the screen, so a follow-up probably is too.
  const screenyRef = useRef(false);
  // When you last talked or typed to Persuna (moving the pointer doesn't count).
  const lastTalked = useRef(0);
  const circledRef = useRef<Area | null>(null);
  // A file handed to Persuna, waiting for what to do with it.
  const [attached, setAttached] = useState<File | null>(null);
  const fileInput = useRef<HTMLInputElement | null>(null);
  // Typing in the island (it opens on Persuna, not on a text box).
  const [islandTyping, setIslandTyping] = useState(false);
  // Work mode: Persuna keeps an eye on your work and steps in when it can help.
  const [workMode, setWorkMode] = useState(false);
  const [askWork, setAskWork] = useState(false);
  // Look mode: one consented read for this Talk turn. The reason shown is why
  // this turn wants the screen (a circled question, a question about it).
  const [askLook, setAskLook] = useState<string | null>(null);
  const lookResolve = useRef<((granted: boolean) => void) | null>(null);
  // A Look read in flight: the island's indicator flashes while it reads.
  const [looking, setLooking] = useState(false);
  // Work mode turns itself off after this many quiet minutes (0: never).
  const [workAutoOffMin, setWorkAutoOffMin] = useState(30);
  // Front apps never to read, by name; the desktop refuses looks at them.
  const [excludedApps, setExcludedApps] = useState<string[]>([]);
  const [editingExcluded, setEditingExcluded] = useState(false);
  const [excludedDraft, setExcludedDraft] = useState("");
  const watchingRef = useRef(false);
  // The last Work tick or frame sent: Work mode is only quiet without these.
  const lastWorkTick = useRef(0);
  // Learn mode: recording an episode for a skill (inside Work mode).
  const [learning, setLearning] = useState<{
    episodeId: string;
    skill: { slug: string; name: string };
  } | null>(null);
  const learningRef = useRef<typeof learning>(null);
  const learnEvents = useRef<LearnBatch["events"]>([]);
  const learnFrame = useRef<LearnBatch["frame"]>(null);
  const learnNarration = useRef<string[]>([]);
  const learnFlushTimer = useRef(0);
  const learnFinishing = useRef(false);
  const [offer, setOffer] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const toastTimer = useRef(0);
  const wake = useRef<WakeListener | null>(null);
  const drag = useRef<{ x: number; y: number; ox: number; oy: number; moved: boolean }>(null);
  const home = useRef<{ x: number; y: number } | null>(null);
  const backHome = useRef(0);
  const talkingNow = useRef(false);
  // Lines queued or being spoken.
  const speaking = useRef(0);
  /** Aborts the in-flight streamed voice turn, if any. */
  const streamAbort = useRef<AbortController | null>(null);
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
    panel,
  });
  useEffect(() => {
    live.current = { voiceOn, busy, talking, name, focusName: focusSkill?.name ?? null, panel };
  }, [voiceOn, busy, talking, name, focusSkill, panel]);

  // The desktop keeps this page open for days: pick up new versions, and have
  // the address for hearing you ready before the first turn.
  useEffect(() => {
    if (!props.overlay) return;
    void warmHearing();
    const timer = window.setInterval(async () => {
      const res = await fetch("/api/health").catch(() => null);
      const { build } = res?.ok ? ((await res.json()) as { build?: unknown }) : { build: null };
      const { busy, talking, panel } = live.current;
      const occupied =
        busy !== "idle" ||
        talking ||
        panel ||
        Boolean(holdRec.current || conversation.current || agentCall.current);
      const quietFor = Date.now() - Math.max(lastTalked.current, lastHeard.current);
      if (shouldRefresh(props.build, build, quietFor, occupied)) window.location.reload();
    }, FRESH_CHECK_MS);
    return () => window.clearInterval(timer);
  }, [props.overlay, props.build]);

  /* ---------- Speaking ---------- */

  const showDotTalk = useCallback((line: string) => {
    window.clearTimeout(dotTalkTimer.current);
    dotTalkRef.current = line;
    setDotTalk(line);
    setDotBubble(null);
    dotTalkTimer.current = window.setTimeout(
      () => {
        dotTalkRef.current = null;
        setDotTalk(null);
      },
      Math.min(20_000, 5000 + line.length * 60),
    );
  }, []);

  const showCaption = useCallback(
    (line: string) => {
      // In Work mode, replies appear beside the dot, not in the island.
      if (workModeRef.current && overlayRef.current && setupRef.current.done) {
        showDotTalk(line);
        return;
      }
      window.clearTimeout(captionTimer.current);
      setCaption(line);
      captionTimer.current = window.setTimeout(
        () => setCaption(null),
        Math.min(20_000, 5000 + line.length * 60),
      );
    },
    [showDotTalk],
  );

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

  /** Stop Persuna mid-sentence: tapping it, typing, or talking over it. */
  const interrupt = useCallback(() => {
    if (!talkingNow.current) return;
    streamAbort.current?.abort();
    stopSpeaking();
    speaking.current = 0;
    talkingNow.current = false;
    setTalking(false);
    setLevel(0);
    // Stopped mid-explanation: show the whole drawing.
    setSpeakProgress(1);
  }, []);

  /**
   * Persuna says something: out loud when its voice is on, its words shown
   * beside it as they're spoken; all at once when it's silent.
   */
  const express = useCallback(
    (line: string, lead = "") => {
      // If you're mid-sentence, Persuna says so as it cuts in; your words so far are kept.
      const cutting = conversation.current?.userSpeaking() ? CUT_IN : "";
      if (live.current.voiceOn) {
        setCaption(null);
        dotTalkRef.current = null;
        setDotTalk(null);
      }
      void sayAloud(`${lead || cutting}${line}`, (chunk) => {
        showCaption(chunk);
        // A drawing being explained follows the words, step by step.
        spokenChars.current += chunk.length;
        if (speakTotal.current > 0) {
          setSpeakProgress(Math.min(1, spokenChars.current / speakTotal.current));
        }
      }).then((spoke) => {
        if (!spoke) showCaption(line);
        setSpeakProgress(1);
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
      const saved = stored<{ fx: number; fy: number } | null>("persuna.home", null);
      const start = clampSpot(
        saved
          ? { x: saved.fx * window.innerWidth, y: saved.fy * window.innerHeight }
          : { x: window.innerWidth - ORB - 28, y: window.innerHeight - ORB - 44 },
      );
      home.current = start;
      // In Persuna Desktop it stays in its bar at the top of the screen.
      setSpot(overlayRef.current ? { x: 0, y: 0 } : start);
      setVoiceOn(stored("persuna.voice", true));
      setAgentVoice(stored("persuna.agentVoice", true));
      setWorkMode(stored("persuna.workMode", false));
      setWorkAutoOffMin(stored("persuna.workAutoOffMin", 30));
      setExcludedApps(stored("persuna.excludedApps", []));
      setWakeOn(stored("persuna.wake", false) && wakeWordSupported());
    });
    void persunaCheckInAction(clock().day).then((res) => {
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
  // runs shortly after you open another page, so Persuna reacts to it.
  const path = usePathname();
  useEffect(() => {
    const check = async () => {
      const res = await persunaPulseAction(clock(), window.location.pathname);
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

  /* ---------- Talking with Persuna ---------- */

  /** When a fast-path reply says the reminder lands ("in 20 minutes", "today at 4:30pm"). */
  function whenDue(due: Date): string {
    const mins = Math.round((due.getTime() - Date.now()) / 60_000);
    if (mins < 90) return `in ${Math.max(1, mins)} minutes`;
    const time = due
      .toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })
      .replace(/\s/g, "")
      .toLowerCase();
    return `${new Date().toDateString() === due.toDateString() ? "today" : "tomorrow"} at ${time}`;
  }

  /** A fast-path exchange joins the conversation like any other. */
  function fastExchange(
    userText: string,
    replyText: string,
    link: CompanionMessage["link"] = null,
  ) {
    const stamp = Date.now();
    setMessages((all) => [
      ...all,
      { id: `fast-${stamp}`, role: "user" as const, kind: "chat", content: userText },
      { id: `fast-${stamp}-r`, role: "assistant" as const, kind: "chat", content: replyText, link },
    ]);
    express(replyText);
  }

  /**
   * Reminders, to-dos, notes and copying, done here with no model call:
   * instant, and nothing can be misheard. False only when it isn't one, so
   * the normal chat path takes it.
   */
  async function fastPath(body: string): Promise<boolean> {
    // While an action runs, "stop" stops it first: safety before anything else.
    if (operatingRef.current && /^\s*stop\b/i.test(body)) {
      takeOver();
      fastExchange(body, "Stopped.");
      return true;
    }
    // While recording, "done" ends the episode: instant, and it can't be misheard.
    if (
      learningRef.current &&
      /^(done|finished|stop( recording| learning)?|that's it|that is it)\b/i.test(body.trim())
    ) {
      const done = await finishLearn();
      if (done) fastExchange(body, done.line, done.link);
      return true;
    }
    const intent = parseFastIntent(body, new Date());
    if (!intent) return false;
    if (intent.kind === "copy") {
      const last = [...messagesRef.current]
        .reverse()
        .find((m) => m.kind === "chat" && m.role === "assistant");
      if (!last) return false;
      await doClipboard({ op: "copy", text: last.content });
      fastExchange(body, "Copied that for you.");
      return true;
    }
    const todo = /^to-?do\b/i.test(body);
    const res = await persunaFastAction(
      intent.kind === "reminder"
        ? { kind: "reminder", text: intent.text, dueIso: intent.due.toISOString() }
        : todo
          ? { kind: "todo", text: intent.body }
          : { kind: "note", title: intent.title, body: intent.body },
    );
    if (!res.ok) return false;
    fastExchange(
      body,
      intent.kind === "reminder"
        ? `Done — I'll remind you ${whenDue(intent.due)}.`
        : todo
          ? "Done — it's on your to-do list."
          : "Done — I've made a note of that.",
      res.value.link,
    );
    return true;
  }

  /**
   * One turn, streamed from the server: each sentence is spoken and shown while
   * the rest is being written. The screenshot stays here unless the turn needs
   * it, and goes up in a second request if the model asks to look closer.
   * Returns what went wrong, or null (a turn you talked over ends quietly).
   */
  const streamTurn = useCallback(
    async (
      message: { audio: File } | { text: string; heardLive?: boolean },
      sight: Awaited<ReturnType<typeof screenNow>>,
      opts: {
        lead?: string;
        mode: TurnMode;
        show?: boolean;
        onWords?: (soFar: string) => void;
        onEnd?: () => void;
        /** When the speech itself ended, for voice turns; timing counts from there. */
        heardAt?: number;
      },
    ): Promise<string | null> => {
      const controller = new AbortController();
      streamAbort.current = controller;
      const typed = "text" in message ? message.text : null;
      const heardLive = "text" in message && Boolean(message.heardLive);
      const label = typed === null || heardLive ? "voice" : "typed";
      const started = opts.heardAt ?? performance.now();
      // This turn's own id, so its first-sound report joins its timing row.
      const turnId =
        typeof crypto.randomUUID === "function"
          ? crypto.randomUUID()
          : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
      const post = (form: FormData, withPicture: boolean) => {
        form.append("client-turn", turnId);
        if (sight?.scene) form.append("scene", JSON.stringify(sight.scene));
        if (sight?.circled) form.append("circled", "1");
        if (sight?.image && withPicture) form.append("screen", sight.image);
        else if (sight?.image) form.append("picture-held", "1");
        form.append("mode", opts.mode);
        if (opts.show) form.append("show", "1");
        if (heardLive) form.append("heard-live", "1");
        const { day, now, offset } = clock();
        form.append("day", day);
        form.append("now", now);
        form.append("offset", String(offset));
        return fetch("/api/persuna/chat-stream", {
          method: "POST",
          body: form,
          signal: controller.signal,
        });
      };
      let queue: SpeechQueue | null = null;
      const settleSpeech = () => {
        const settled = queue;
        queue = null;
        return settled?.finish().then(() => {
          speaking.current = Math.max(0, speaking.current - 1);
          if (speaking.current === 0) {
            talkingNow.current = false;
            setTalking(false);
          }
        });
      };
      const close = () => {
        setBusy("idle");
        if (streamAbort.current === controller) streamAbort.current = null;
        opts.onEnd?.();
      };
      try {
        const form = new FormData();
        if (typed === null) form.append("audio", (message as { audio: File }).audio);
        else form.append("text", typed);
        let res = await post(form, Boolean(sight && pictureNeeded(sight, typed)));
        if (!res.ok || !res.body) {
          close();
          return res.status === 401 ? "Sign in first" : "The voice service didn't answer.";
        }
        let spoken = "";
        let written = "";
        let firstAudioLogged = false;
        if (live.current.voiceOn) {
          speaking.current += 1;
          talkingNow.current = true;
          setTalking(true);
          queue = createSpeechQueue({
            onLevel: setLevel,
            onSpoken: (piece) => {
              if (!firstAudioLogged) {
                firstAudioLogged = true;
                const firstAudioMs = Math.round(performance.now() - started);
                console.info(`[persuna] ${label} first-audio=${firstAudioMs}ms`);
                // Heard, for real: tell the server, so the measures page
                // shows true first sound, not just first sentence.
                try {
                  const report = JSON.stringify({ turn: turnId, ms: firstAudioMs });
                  if (typeof navigator.sendBeacon === "function") {
                    navigator.sendBeacon(
                      "/api/persuna/voice-first-audio",
                      new Blob([report], { type: "application/json" }),
                    );
                  } else {
                    void fetch("/api/persuna/voice-first-audio", {
                      method: "POST",
                      headers: { "content-type": "application/json" },
                      body: report,
                      keepalive: true,
                    });
                  }
                } catch {
                  // Timing must never break a turn.
                }
              }
              spoken = spoken ? `${spoken} ${piece}` : piece;
              showCaption(spoken);
              spokenChars.current += piece.length;
              if (speakTotal.current > 0) {
                setSpeakProgress(Math.min(1, spokenChars.current / speakTotal.current));
              }
            },
          });
          if (opts.lead) queue.push(opts.lead);
        }
        let firstSentenceLogged = false;
        const on = {
          heard: (text: string) => {
            showCaption(`“${text}”`);
            narrateLearn(text);
          },
          sentence: (text: string) => {
            if (!firstSentenceLogged) {
              firstSentenceLogged = true;
              console.info(
                `[persuna] ${label} first-sentence=${Math.round(performance.now() - started)}ms`,
              );
            }
            written = written ? `${written} ${text}` : text;
            opts.onWords?.(written);
            if (queue) queue.push(text);
            else showCaption(written);
          },
        };
        let outcome = await readTurnStream<ChatResult>(res.body, on);
        if (outcome.closer && sight?.image) {
          const again = new FormData();
          again.append("text", outcome.closer.heard);
          again.append("said-first", outcome.closer.said);
          res = await post(again, true);
          outcome = res.body
            ? await readTurnStream<ChatResult>(res.body, on)
            : { result: null, failed: null, closer: null };
        }
        const { result, failed } = outcome;
        console.info(
          `[persuna] ${label} turn total=${Math.round(performance.now() - started)}ms mode=${opts.mode} sight=${Boolean(sight)}`,
        );
        close();
        if (failed || !result) {
          stopSpeaking();
          void settleSpeech();
          return failed ?? "The voice service didn't answer.";
        }
        setError(null);
        screenyRef.current = stayOnScreen(
          typed,
          Boolean(sight?.circled),
          Boolean(result.drawing || result.point),
        );
        if (queue) {
          // The reply is already being spoken; show the messages and cards.
          void settleSpeech();
          answered(result, "", true);
        } else {
          answered(result, opts.lead);
        }
        return null;
      } catch {
        close();
        // Died mid-read (aborted or cut off): settle the speech it started.
        void settleSpeech();
        // Talking over Persuna stops its turn silently; anything else is news.
        return controller.signal.aborted ? null : "The voice service didn't answer.";
      }
    },
    // answered and screenNow read live state through refs.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [showCaption],
  );

  const send = useCallback(
    async (message: string, lead = "", opts?: { show?: boolean }) => {
      const body = message.trim();
      // "Stop" works while Persuna is busy: that's when it matters most.
      if (operatingRef.current && /^\s*stop\b/i.test(body)) {
        takeOver();
        fastExchange(body, "Stopped.");
        return;
      }
      if (!body || live.current.busy === "thinking") return;
      lastTalked.current = Date.now();
      stopSpeaking();
      talkingNow.current = false;
      if (!setupRef.current.done) return setupReply(body);
      // A few things need no model at all (and can't be misheard).
      if (await fastPath(body)) return;
      narrateLearn(body);
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
      if (live.current.voiceOn) void warmVoice();
      // The screen goes with the message in Work mode, or as one consented
      // look when the message is about it: reading it costs seconds that
      // plain chat shouldn't pay.
      const { sight, mode } = await turnSight(body, Boolean(opts?.show));
      const writing = `${pending.id}-reply`;
      streamAbort.current?.abort();
      const failure = await streamTurn({ text: body }, sight, {
        lead,
        mode,
        show: opts?.show,
        onWords: (soFar) =>
          setMessages((all) => [
            ...all.filter((m) => m.id !== writing),
            { id: writing, role: "assistant", kind: "chat", content: soFar },
          ]),
        onEnd: () =>
          setMessages((all) => all.filter((m) => m.id !== pending.id && m.id !== writing)),
      });
      if (failure) {
        setText(body);
        setError(failure);
      }
    },
    // setupReply and answered read live state through refs.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  );

  /**
   * Persuna's answer to something you typed or said: show what it set up, and
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
    if (value.episode?.op === "start") {
      void startLearnFlow(value.episode.episodeId, value.episode.skill);
    }
    if (value.episode?.op === "stop") void finishLearn().then(announceLearned);
    if (props.overlay && desktopBridge()?.look) {
      // On the desktop, "watch my screen" is Work mode.
      if (value.watch === "start") void enableWork();
      if (value.watch === "stop") {
        watcher.current?.stop();
        setWork(false);
      }
    } else {
      // A browser only opens its share picker from a click: ask with a button there.
      if (value.watch === "start" && !watcher.current) {
        if (watchesWithoutClick()) void startWatch();
        else setAskWatch(true);
      }
      if (value.watch === "stop") watcher.current?.stop();
    }
    if (value.example) setExample(value.example.skill);
    if (value.appConfirm) setAppConfirm(value.appConfirm);
    if (value.mcpConfirm) setMcpConfirm(value.mcpConfirm);
    if (value.operateConfirm) setOperateConfirm(value.operateConfirm);
    // Showing something on screen: the island folds up so it doesn't cover it.
    if (value.point || value.drawing) setPanel(false);
    if (value.point) showPoint(value.point);
    if (value.clipboard) void doClipboard(value.clipboard);
    if (value.drawing) {
      // Each step of the drawing appears as Persuna gets to it.
      const steps = value.drawing.marks.length + (value.drawing.flow?.nodes.length ?? 0);
      setDrawPace(Math.min(2600, Math.max(700, (reply.content.length * 60) / Math.max(1, steps))));
      setDrawing(value.drawing);
      // Steps follow the voice when it's on; the pace above is the fallback.
      spokenChars.current = 0;
      speakTotal.current = reply.content.length;
      setSpeakProgress(live.current.voiceOn ? 0 : null);
    }
    if (value.file) setMade(value.file);
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

  function showPoint(spot: Spot) {
    window.clearTimeout(pointTimer.current);
    setPointAt(spot);
    pointTimer.current = window.setTimeout(() => setPointAt(null), POINT_MS);
  }

  function flash(line: string) {
    window.clearTimeout(toastTimer.current);
    setToast(line);
    toastTimer.current = window.setTimeout(() => setToast(null), 3500);
  }

  /** Copies text, or pastes it where your cursor is (Persuna Desktop presses ⌘V for you). */
  async function doClipboard({ op, text }: { op: "copy" | "paste"; text: string }) {
    const desktop = desktopBridge();
    const pasteKey = /Mac/.test(navigator.platform) ? "⌘V" : "Ctrl+V";
    if (op === "paste" && desktop?.paste) {
      const pasted = await desktop.paste(text).catch(() => false);
      return flash(pasted ? "Pasted" : `Copied. Press ${pasteKey} to paste it`);
    }
    if (desktop?.copy) desktop.copy(text);
    else {
      try {
        await navigator.clipboard.writeText(text);
      } catch {
        // The browser wants a click first: show it with a Copy button.
        return setMade({ kind: "document", title: "To copy", body: text, flow: null });
      }
    }
    flash(op === "paste" ? `Copied. Press ${pasteKey} where you want it` : "Copied");
  }

  /** A file handed to Persuna, with what to do with it. */
  async function sendFile(file: File, said: string) {
    setAttached(null);
    setError(null);
    setCaption(null);
    stopSpeaking();
    setBusy("thinking");
    const form = new FormData();
    form.append("file", file);
    form.append("text", said.trim());
    const res = await persunaFileAction(form, clock());
    setBusy("idle");
    if (!res.ok) return setError(res.error);
    setText("");
    answered(res.value);
  }

  function pickFile(file: File | null | undefined) {
    if (!file) return;
    setAttached(file);
    setPanel(true);
    setIslandTyping(false);
  }

  function setWork(on: boolean) {
    setAskWork(false);
    // Turning it on is an invitation: it may help straight away.
    if (on) {
      lastTalked.current = 0;
      lastWorkTick.current = Date.now();
    }
    setWorkMode(on);
    store("persuna.workMode", on);
    desktopBridge()?.setMode?.({ work: on });
    if (!on) {
      // Work mode is what allowed this proposal: it doesn't outlive it.
      operateDeclined();
      setOffer(null);
      setTeachOffer(null);
      // A Work read never leaks into a later Talk turn.
      sightPromise.current = null;
      sightCache.current = null;
      // Watching runs in Work mode: it ends with it (saying so on screen).
      watcher.current?.stop();
      // So does a Learn recording (what it caught is still learned from).
      if (learningRef.current) void finishLearn().then(announceLearned);
    }
    flash(on ? "Work mode is on" : "Work mode is off");
  }

  /** The Mac's permissions as they are now (null off the desktop app). */
  async function checkPerms() {
    const desktop = desktopBridge();
    perms.current = (await desktop?.permissions?.().catch(() => null)) ?? null;
    return perms.current;
  }

  /** True when Persuna may use it; otherwise the island asks for it. */
  async function allowed(kind: Permission) {
    const now = perms.current ?? (await checkPerms());
    if (!now || now[kind] === "granted") return true;
    setNeed(kind);
    return false;
  }

  async function askFor(kind: Permission) {
    const desktop = desktopBridge();
    const result = await desktop?.askPermission?.(kind).catch(() => "denied");
    await checkPerms();
    if (result === "granted") {
      setNeed(null);
      flash(kind === "mic" ? "Thanks. Hold the key and talk." : "Thanks");
    }
  }

  function addExcluded() {
    const name = excludedDraft.trim();
    if (!name) return;
    if (!isExcludedApp(name, excludedApps)) {
      const next = [...excludedApps, name];
      setExcludedApps(next);
      store("persuna.excludedApps", next);
    }
    setExcludedDraft("");
  }

  function removeExcluded(name: string) {
    const next = excludedApps.filter((app) => app !== name);
    setExcludedApps(next);
    store("persuna.excludedApps", next);
  }

  /** Work mode on, by voice or the island (it needs to see the screen). */
  async function enableWork() {
    if (!(await allowed("screen"))) return;
    setWork(true);
  }

  async function startCircle() {
    if (!(await allowed("screen"))) return;
    setPanel(false);
    setCircling(true);
  }

  async function teachSteps() {
    if (!teachOffer) return;
    const offer = teachOffer;
    setTeachOffer(null);
    setBusy("thinking");
    const res = await persunaTeachNoteAction(offer.noteId);
    setBusy("idle");
    if (!res.ok) return setError(res.error);
    const line = `Done. I added what I learned to ${offer.skill} for you to review.`;
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

  const hear = useCallback(
    async (
      audio: Blob,
      end: UtteranceEnd = "pause",
      words: Promise<string | null> | null = null,
      speechEnd: number | null = null,
    ) => {
      lastHeard.current = Date.now();
      // Straight away, before anything travels: you've been heard.
      ackTick();
      setBusy(words && setupRef.current.done ? "thinking" : "hearing");
      if (live.current.voiceOn) void warmVoice();
      try {
        // A very long turn: Persuna cut in, and says so.
        const lead = end === "long" ? CUT_IN : "";
        const said = words ? await words : null;
        if (said && operatingRef.current && /^\s*stop\b/i.test(said)) {
          takeOver();
          setBusy("idle");
          return;
        }
        if (said) showCaption(`“${said}”`);
        if (said) narrateLearn(said);
        const recording = async () => {
          setBusy("hearing");
          return toTranscribableWav(audio, "persuna");
        };
        if (!setupRef.current.done) {
          // The first meeting is scripted here, so it needs the words.
          let spoken = said;
          if (!spoken) {
            const form = new FormData();
            form.append("audio", await recording());
            const res = await persunaTranscribeAction(form);
            if (!res.ok) {
              setBusy("idle");
              return setError(res.error);
            }
            spoken = res.value.trim();
          }
          setBusy("idle");
          if (spoken) await send(spoken, lead);
          return;
        }
        // Answered as it streams. In Work mode the screen read started when
        // the key went down (or a moment ago); in Talk mode nothing travels
        // without a look granted for this turn.
        streamAbort.current?.abort();
        stopSpeaking();
        const { sight, mode } = await turnSight(said, false);
        const failure = await streamTurn(
          said ? { text: said, heardLive: true } : { audio: await recording() },
          sight,
          { lead, mode, heardAt: speechEnd ?? undefined },
        );
        if (failure) setError(failure);
      } catch {
        setBusy("idle");
        setError("I couldn't make that out. Try again?");
      }
    },
    // answered reads live state through refs.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [send, showCaption, streamTurn],
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
        void persunaAgentTurnsAction().then((res) => {
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
        onUtterance: (audio, end, words, speechEnd) => void hear(audio, end, words, speechEnd),
        onWords: showCaption,
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

  /* ---------- Hold to talk (Persuna Desktop's key, or the panel's mic button) ---------- */

  function holdStart() {
    if (holdRec.current) return;
    lastTalked.current = Date.now();
    if (live.current.voiceOn) void warmVoice();
    // No microphone yet: the island asks for it instead of recording silence.
    if (perms.current && perms.current.mic !== "granted") {
      setNeed("mic");
      return;
    }
    lastInput.current = Date.now();
    setDozing(false);
    setMenu(false);
    setError(null);
    setCaption(null);
    setDotBubble(null);
    if (talkingNow.current) interrupt();
    if (conversation.current || agentCall.current) endConversation();
    setHolding(true);
    // In Work mode, start reading the screen now, while you're still talking,
    // so it's ready the moment you let go instead of costing seconds then. In
    // Talk mode nothing is read until the turn grants a look.
    if (workModeRef.current) sightPromise.current ??= lookNow(true);
    void warmHearing();
    holdRec.current = startHoldRecording(setLevel, showCaption).catch(() => {
      setError("Microphone access was blocked.");
      return null;
    });
  }

  async function holdEnd() {
    const pending = holdRec.current;
    holdRec.current = null;
    setHolding(false);
    const heard = await (await pending)?.stop();
    // Too short or silent: a slip of the finger, not a question.
    // Letting go of the key is the end of the speech: timing counts from here.
    if (heard) void hear(heard.audio, "pause", heard.words, performance.now());
  }

  function holdCancel() {
    const pending = holdRec.current;
    holdRec.current = null;
    setHolding(false);
    void pending?.then((rec) => rec?.cancel());
  }

  /** The island opens on Persuna; typing opens only when asked (the Type chip, or a double tap). */
  function openPanel(typing = false) {
    setPanel(true);
    setMenu(false);
    setIslandTyping(typing);
    // Taking the keyboard means a click anywhere else closes it again.
    desktopBridge()?.focus?.();
    if (typing) window.setTimeout(() => panelInput.current?.focus(), 50);
  }

  /**
   * A Talk turn wants one look at the screen. Asked once: "always" is
   * remembered, "just this once" grants this turn. Work mode never asks.
   */
  function ensureLook(reason: string): Promise<boolean> {
    if (workModeRef.current || stored("persuna.lookConsent", false)) {
      return Promise.resolve(true);
    }
    setAskLook(reason);
    return new Promise<boolean>((resolve) => {
      // Two turns asking together share the one answer.
      const prev = lookResolve.current;
      lookResolve.current = (granted: boolean) => {
        prev?.(granted);
        resolve(granted);
      };
    });
  }

  function answerLook(granted: boolean, always: boolean) {
    if (granted && always) store("persuna.lookConsent", true);
    setAskLook(null);
    lookResolve.current?.(granted);
    lookResolve.current = null;
  }

  /**
   * What screen, if any, goes with this turn. Work mode reads; Talk mode reads
   * once with consent (a circled question, showing something, a follow-up to a
   * turn about the screen, or a question about it); otherwise nothing travels.
   */
  async function turnSight(
    said: string | null,
    show: boolean,
  ): Promise<{ sight: Awaited<ReturnType<typeof screenNow>>; mode: TurnMode }> {
    if (workModeRef.current) return { sight: await screenNow("work"), mode: "work" };
    const reason = circledRef.current
      ? "what you circled"
      : show
        ? "what you're showing me"
        : screenyRef.current || (said && wantsSight(said))
          ? "your question is about the screen"
          : null;
    if (!reason) return { sight: null, mode: "talk" };
    if (!(await ensureLook(reason))) {
      // Said no: the circle goes too, so it doesn't hang over the answer.
      circledRef.current = null;
      setCircled(null);
      return { sight: null, mode: "talk" };
    }
    const sight = await screenNow("look");
    return { sight, mode: modeForTurn(false, Boolean(sight)) };
  }

  /**
   * The desktop's eyes, reused for a few seconds in Work mode: back-to-back
   * turns are one read. A Look never reuses another turn's read, and a look at
   * an excluded app comes back empty (nothing about it travels).
   */
  async function lookNow(cached: boolean): Promise<{
    scene: Scene | null;
    image: string | null;
  } | null> {
    const desktop = desktopBridge();
    if (!desktop?.look) return null;
    if (cached) {
      const hit = sightCache.current;
      if (hit && Date.now() - hit.at < 4_000) return hit.value;
    }
    const sight = await desktop.look().catch(() => null);
    if (!sight) return null;
    if ("excluded" in sight) {
      if (sight.app) flash(`Skipped ${sight.app} — it's on your never-read list`);
      return null;
    }
    if (cached) sightCache.current = { at: Date.now(), value: sight };
    return sight;
  }

  /**
   * What Persuna sees with your message: in Work mode the screen as you speak
   * or send, in Look mode one fresh read for this turn, in Talk mode nothing.
   * On the web, the window it's watching, if any.
   */
  async function screenNow(mode: TurnMode | null): Promise<{
    image: string | null;
    scene: Scene | null;
    circled?: boolean;
  } | null> {
    if (!mode || mode === "talk") {
      sightPromise.current = null;
      return null;
    }
    const desktop = desktopBridge();
    const area = circledRef.current;
    if (desktop?.look) {
      const fresh = mode === "look";
      if (fresh) setLooking(true);
      try {
        // A circled question reads the screen as it is now; in Work mode
        // anything else takes the read already started (key-down) or the one
        // from a moment ago. A Look never reuses another turn's read.
        const sight =
          area || mode === "look"
            ? await lookNow(false)
            : await (sightPromise.current ?? lookNow(true));
        sightPromise.current = null;
        if (!sight || !area) return sight;
        // You circled something: only that part goes with this message.
        circledRef.current = null;
        setCircled(null);
        const width = sight.scene?.screen.w ?? window.innerWidth;
        return {
          image:
            sight.image && (await cropPicture(sight.image, area, width).catch(() => sight.image)),
          scene: sight.scene && sceneWithin(sight.scene, area),
          circled: true,
        };
      } finally {
        if (fresh) setLooking(false);
      }
    }
    const image = watcher.current?.latest() ?? null;
    return image ? { image, scene: null } : null;
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
    const desktop = desktopBridge();
    desktop?.onCall?.(call);
    desktop?.onHold?.((phase) => {
      if (phase === "start") void holdStart();
      else if (phase === "end") void holdEnd();
      else if (phase === "cancel") holdCancel();
      else openPanel(true);
    });
    void desktop?.holdKey?.().then(setHoldLabel);
    void desktop?.island?.().then((shape) => shape && setIsland(shape));
    desktop?.onIsland?.(setIsland);
    desktop?.onCircle?.(() => void startCircle());
    void desktop?.updateState?.().then((state) => state && setUpdate(state));
    desktop?.onUpdate?.(setUpdate);
    // Without Accessibility the talk key can't work: say so in the island
    // straight away (only on the desktop, and only once set up).
    void checkPerms().then((now) => {
      if (now?.keyboard && now.keyboard !== "granted" && setupRef.current.done) setNeed("keyboard");
    });
    desktop?.onHoldKey?.(setHoldLabel);
    void desktop?.shortcut?.().then(setDesktopShortcut);
    desktop?.onShortcut?.(setDesktopShortcut);
    // The desktop enforces the never-read list and shows Work mode in its
    // menu bar; its menu bar can also turn Work mode off.
    desktop?.setExcludedApps?.(stored("persuna.excludedApps", []));
    desktop?.setMode?.({ work: stored("persuna.workMode", false) });
    desktop?.onSetWork?.((on) => {
      if (on) void enableWork();
      else setWork(false);
    });
    desktop?.onLearn?.((batch) => {
      if (!learningRef.current) return;
      if (batch.denied) {
        flash("Recording your narration — Persuna can't see the screen");
        return;
      }
      const room = Math.max(0, 200 - learnEvents.current.length);
      learnEvents.current.push(...batch.events.slice(0, room));
      if (batch.frame) learnFrame.current = batch.frame;
    });
    return () => window.removeEventListener("keydown", onKey);
    // call reads live state through refs.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // The island closes when you click anywhere else (Persuna loses the keyboard then).
  useEffect(() => {
    if (!props.overlay || !panel) return;
    const close = () => {
      setPanel(false);
      setMenu(false);
      setIslandTyping(false);
    };
    window.addEventListener("blur", close);
    return () => window.removeEventListener("blur", close);
  }, [props.overlay, panel]);

  /* ---------- Work mode ---------- */

  useEffect(() => {
    const desktop = desktopBridge();
    if (!workMode || !setupDone || !props.overlay || !desktop?.look) return;
    let stopped = false;
    let running = false;
    let last = "";
    let trail: string[] = [];
    let spokeAt = 0;
    let failures = 0;
    let bubbleTimer = 0;
    // Where the pointer is, and since when it has stayed there.
    const pointer = { x: -1, y: -1, since: Date.now(), askedAbout: -1 };
    const onMove = (e: MouseEvent) => {
      if (Math.hypot(e.clientX - pointer.x, e.clientY - pointer.y) < 12) return;
      pointer.x = e.clientX;
      pointer.y = e.clientY;
      pointer.since = Date.now();
    };
    window.addEventListener("mousemove", onMove, { passive: true });

    const tick = async (lingering = false) => {
      // Not while you're talking to Persuna, or it's busy, speaking or you're circling.
      if (running || stopped || live.current.busy !== "idle" || talkingNow.current) return;
      if (holdRec.current || circledRef.current) return;
      running = true;
      setDotLooking(true);
      try {
        const sight = await desktop.look!().catch(() => null);
        if (stopped) return;
        // The front app is on the never-read list: skip this tick silently
        // (a toast here would nag every ten seconds).
        if (sight && "excluded" in sight) return;
        if (!sight?.scene) return failed();
        const digest = sceneDigest(sight.scene);
        // Nothing changed and the pointer isn't lingering: nothing to look at.
        if (digest === last && !lingering) return;
        last = digest;
        const before = trail;
        trail = extendTrail(trail, trailLine(sight.scene));
        // Quiet for a while after it spoke up, or after you talked to it
        // (moving the pointer doesn't count).
        const now = Date.now();
        lastWorkTick.current = now;
        const res = await persunaWorkAction(
          {
            scene: sight.scene,
            // The picture only when the list can't say enough (a canvas, a photo).
            image: sceneIsThin(sight.scene) ? sight.image : null,
            trail: before,
            mayInterrupt: mayInterrupt(now, spokeAt, lastTalked.current),
            pointer:
              pointer.x >= 0
                ? { x: pointer.x, y: pointer.y, still: (Date.now() - pointer.since) / 1000 }
                : null,
          },
          clock(),
        );
        if (stopped) return;
        if (!res.ok) return failed(res.error);
        failures = 0;
        const { message, point, offer: next, switchTo, teachOffer: teach, mode, fit } = res.value;
        setDotTone(
          mode === "explain" ? "explain" : mode === "correct" ? "off" : (fit ?? "on_track"),
        );
        if (teach) setTeachOffer(teach);
        if (switchTo && !offFocusAsked.current) {
          // Once per session: the work looks like another of their skills.
          offFocusAsked.current = true;
          const line = `This looks like ${switchTo.name}. Want me to learn it there?`;
          setMessages((all) => [
            ...all,
            {
              id: `work-switch-${Date.now()}`,
              role: "assistant",
              kind: "chat",
              content: line,
              switchTo,
            },
          ]);
          express(line);
        }
        if (message) {
          spokeAt = Date.now();
          setMessages((all) => [...all, { ...message, role: "assistant" }]);
          // Right where you are: beside the dot, with a tap on the trackpad,
          // a soft chime, and said out loud. Not while talk owns the dot:
          // the words still go there through express() below.
          window.clearTimeout(bubbleTimer);
          if (
            !holdRec.current &&
            live.current.busy === "idle" &&
            !talkingNow.current &&
            !dotTalkRef.current
          ) {
            setDotBubble(message.content);
          }
          bubbleTimer = window.setTimeout(
            () => setDotBubble(null),
            Math.min(20_000, 5000 + message.content.length * 70),
          );
          desktop.nudge?.();
          chime(true);
          express(message.content);
        }
        if (point) showPoint(point);
        if (next) setOffer(next);
      } finally {
        running = false;
        if (!stopped) setDotLooking(false);
      }
    };

    /** Three looks in a row that couldn't see the screen: say why, once. */
    function failed(reason?: string) {
      failures += 1;
      if (failures !== 3) return;
      void checkPerms().then((now) => {
        if (now && now.screen !== "granted") setNeed("screen");
        else
          setError(
            reason ??
              "Work mode can't read your screen right now. I'll keep trying; check Screen Recording for Persuna in System Settings.",
          );
      });
    }

    const timer = window.setInterval(() => void tick(), WORK_EVERY_MS);
    // A pointer resting on one thing for a few seconds is a good moment to help.
    const linger = window.setInterval(() => {
      const still = Date.now() - pointer.since;
      if (pointer.x >= 0 && still >= LINGER_MS && pointer.askedAbout !== pointer.since) {
        pointer.askedAbout = pointer.since;
        void tick(true);
      }
    }, 1000);
    void tick(true);
    return () => {
      stopped = true;
      window.clearInterval(timer);
      window.clearInterval(linger);
      window.clearTimeout(bubbleTimer);
      window.removeEventListener("mousemove", onMove);
      setDotLooking(false);
      setDotBubble(null);
    };
    // express, showPoint, checkPerms and the refs read live state.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [workMode, setupDone, props.overlay]);

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
          store("persuna.wake", false);
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
    store("persuna.wake", next);
  }

  /* ---------- First meeting, by conversation ---------- */

  const setupRef = useRef({ done: setupDone, step: setupStep });
  useEffect(() => {
    setupRef.current = { done: setupDone, step: setupStep };
  }, [setupDone, setupStep]);
  useEffect(() => {
    workModeRef.current = workMode;
  }, [workMode]);
  useEffect(() => {
    watchingRef.current = watching;
  }, [watching]);
  useEffect(() => {
    learningRef.current = learning;
  }, [learning]);
  // The desktop holds a copy of the never-read list; keep it in step.
  useEffect(() => {
    desktopBridge()?.setExcludedApps?.(excludedApps);
  }, [excludedApps]);

  // Work mode turns itself off after its quiet minutes: no talking, no
  // watching, nothing sent. Watching is never quiet (it was asked to watch).
  useEffect(() => {
    if (!workMode) return;
    const check = () => {
      if (watchingRef.current) return;
      const lastActive = Math.max(lastTalked.current, lastHeard.current, lastWorkTick.current);
      if (workAutoOffDue(Date.now(), lastActive, workAutoOffMin)) {
        setWork(false);
        flash(`Work mode off — quiet for ${workAutoOffMin} minutes`);
      }
    };
    const timer = window.setInterval(check, 30_000);
    return () => window.clearInterval(timer);
    // setWork and flash read live state through refs.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [workMode, workAutoOffMin]);

  // In Work mode, errors speak from the dot instead of the island. Each new
  // error is routed once, so toggling Work mode never resurfaces an old one.
  const routedError = useRef<string | null>(null);
  useEffect(() => {
    if (!error) {
      routedError.current = null;
      return;
    }
    if (!workMode || !props.overlay || !setupDone || routedError.current === error) return;
    routedError.current = error;
    showDotTalk(error);
  }, [error, workMode, props.overlay, setupDone, showDotTalk]);

  function addSetupMessage(m: Omit<CompanionMessage, "id" | "kind">) {
    const log = setupDraft.current.log;
    log.push({ ...m, id: `setup-${log.length}`, kind: "chat" });
  }

  function persunaSays(line: string) {
    addSetupMessage({ role: "assistant", content: line });
    express(line);
  }

  // Persuna opens the conversation itself (spoken after your first click or key).
  useEffect(() => {
    if (props.setupDone) return;
    const first = window.setTimeout(() => persunaSays(SETUP_QUESTIONS.name("")), 600);
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
      persunaSays(
        parseName(answer)
          ? SETUP_QUESTIONS.look(picked)
          : `Then I'll be ${picked}. ${SETUP_QUESTIONS.look(picked).split(". ").slice(1).join(". ")}`,
      );
    } else if (step === "look") {
      const chosen = parseLook(answer);
      if (!chosen) return persunaSays("Say a colour, like blue or purple, or tap one of me.");
      setLook(chosen);
      setupDraft.current.look = chosen;
      setSetupStep("task");
      persunaSays(SETUP_QUESTIONS.task(setupDraft.current.name));
    } else if (step === "task") {
      const first = parseFirstTask(answer, props.skills);
      if (first.kind === "new") {
        setupDraft.current.taskName = first.name;
        setSetupStep("describe");
        return persunaSays(`${first.name}. ${SETUP_QUESTIONS.describe(setupDraft.current.name)}`);
      }
      await finishSetup(first);
    } else if (answer.length < 10) {
      persunaSays("Tell me a little more: what do you start with, and what do you hand over?");
    } else {
      await finishSetup({ kind: "new", name: setupDraft.current.taskName, description: answer });
    }
  }

  async function finishSetup(task: Parameters<typeof persunaSetupAction>[0]["task"]) {
    setBusy("thinking");
    const res = await persunaSetupAction({
      name: setupDraft.current.name || name,
      avatar: lookOf(setupDraft.current.look),
      task,
    });
    setBusy("idle");
    if (!res.ok) return persunaSays(`Hmm, that didn't work: ${res.error}`);
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

  /* ---------- Roaming: Persuna moves around the screen ---------- */

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
    if (!(el instanceof HTMLElement) || el.closest("[data-persuna]")) return;
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
      if (el.closest("[data-persuna]")) return;
      if (!el.matches("input:not([type=hidden]):not([type=checkbox]):not([type=radio]), textarea"))
        return;
      window.clearTimeout(leave);
      perchBy(el, -1);
    };
    const onBlur = (e: FocusEvent) => {
      if ((e.target as HTMLElement).closest("[data-persuna]")) return;
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

  /* ---------- Persuna Desktop: clicks pass through except on Persuna ---------- */

  useEffect(() => {
    const desktop = desktopBridge();
    if (!props.overlay || !desktop) return;
    let interactive = false;
    const onMove = (e: MouseEvent) => {
      // While dragging Persuna, keep it holding the pointer.
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
          lastWorkTick.current = Date.now();
          const res = await persunaObserveAction(
            frame,
            note,
            workModeRef.current ? "work" : "talk",
          );
          // A missed look isn't worth interrupting you for: keep watching, try the next one.
          if (!res.ok) return;
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
          desktopBridge()?.watching?.(false);
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
              link: note ? { href: "/persuna", label: "Open your notes" } : null,
            },
          ]);
          express(line);
        },
      });
      setLooks(0);
      setWatchNote(null);
      setWatching(true);
      // Watching is continuous: it runs in Work mode.
      if (!workModeRef.current) setWork(true);
    } catch (e) {
      setError(
        e instanceof Error && e.name !== "NotAllowedError" ? e.message : "Sharing was cancelled.",
      );
    }
  }

  /* ---------- Learn mode: recording an episode ---------- */

  /** Sends the buffered stream to the episode (a miss just waits for the next flush). */
  async function flushLearn() {
    const rec = learningRef.current;
    if (!rec) return;
    const events = learnEvents.current.splice(0, learnEvents.current.length);
    const frame = learnFrame.current;
    learnFrame.current = null;
    if (events.length === 0 && !frame) return;
    lastWorkTick.current = Date.now();
    const res = await persunaEpisodeBatchAction(rec.episodeId, events, frame);
    if (!res.ok) {
      learnEvents.current.unshift(...events.slice(-50));
      if (frame) learnFrame.current ??= frame;
    }
  }

  function narrateLearn(text: string) {
    if (!learningRef.current) return;
    const lines = learnNarration.current;
    // Live words and the server's transcript of them arrive separately.
    if (lines[lines.length - 1] === text) return;
    if (lines.join("\n").length + text.length > 3500) return;
    lines.push(text);
  }

  async function startLearnFlow(episodeId: string, skill: { slug: string; name: string }) {
    if (!workModeRef.current) await enableWork();
    if (learningRef.current) {
      desktopBridge()?.startLearn?.();
      return;
    }
    learnEvents.current = [];
    learnFrame.current = null;
    learnNarration.current = [];
    setLearning({ episodeId, skill });
    const desktop = desktopBridge();
    if (desktop?.startLearn && (await allowed("screen"))) desktop.startLearn();
    else flash("Recording your narration — the screen needs Persuna Desktop");
    window.clearInterval(learnFlushTimer.current);
    learnFlushTimer.current = window.setInterval(() => void flushLearn(), 5000);
    flash(`Recording ${skill.name} — say "done" when finished`);
  }

  /** Stops the stream, learns from the episode, and says what came of it. */
  async function finishLearn(): Promise<{
    line: string;
    link: { href: string; label: string };
  } | null> {
    const rec = learningRef.current;
    if (!rec || learnFinishing.current) return null;
    learnFinishing.current = true;
    try {
      desktopBridge()?.stopLearn?.();
      window.clearInterval(learnFlushTimer.current);
      await flushLearn();
      learningRef.current = null;
      setLearning(null);
      const narration = learnNarration.current.join("\n").slice(0, 4000);
      learnNarration.current = [];
      const res = await persunaEpisodeFinalizeAction(rec.episodeId, narration);
      if (!res.ok) {
        setError(res.error);
        return null;
      }
      const { proposalId, steps, newSteps } = res.value;
      const line =
        newSteps === 0 && !proposalId
          ? `Done — nothing new to learn in that one.`
          : `Done — ${newSteps} new step${newSteps === 1 ? "" : "s"} for ${rec.skill.name} (${steps} in all)${proposalId ? ", and proposed rule changes for you to review" : ""}.`;
      return {
        line,
        link: proposalId
          ? { href: `/corrections/${proposalId}`, label: "Review the proposed change" }
          : { href: `/skills/${rec.skill.slug}`, label: "See the steps" },
      };
    } finally {
      learnFinishing.current = false;
    }
  }

  function announceLearned(done: { line: string; link: { href: string; label: string } } | null) {
    if (!done) return;
    setMessages((all) => [
      ...all,
      {
        id: `learn-${Date.now()}`,
        role: "assistant",
        kind: "chat",
        content: done.line,
        link: done.link,
      },
    ]);
    express(done.line);
  }

  async function teachWatched() {
    if (!watchNote) return;
    setBusy("thinking");
    const res = await persunaTeachNoteAction(watchNote);
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
      store("persuna.home", { fx: spot.x / window.innerWidth, fy: spot.y / window.innerHeight });
    } else onTap();
  }
  /** Accepting the end-of-day wrap-up offer, wherever it is showing. */
  function acceptWrap() {
    setCaption(null);
    dotTalkRef.current = null;
    setDotTalk(null);
    void send("Wrap up my day");
  }

  function onTap() {
    if (!setupDone && setupLater) return setSetupLater(false);
    // Tapping the wrap-up offer asks for it (in Work mode it shows at the dot).
    if ((caption === WRAP_UP_OFFER || dotTalk === WRAP_UP_OFFER) && !talkingNow.current) {
      return void acceptWrap();
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

  // Over the screen, cards are black like the island; on a page, they're cards.
  const card = props.overlay ? ISLAND_CARD : CARD;

  // Quick choices during the first meeting: looks and first tasks.
  const setupChips = (
    <>
      {setupStep === "look" && (
        <div className="persuna-in flex flex-wrap gap-1 self-start" aria-label="Looks">
          {LOOK_IDS.map((id) => (
            <button
              key={id}
              type="button"
              onClick={() => void setupReply(LOOKS[id].label)}
              aria-label={`${LOOKS[id].label} look`}
              title={LOOKS[id].label}
              className="rounded-2xl p-1 hover:bg-accent-soft"
            >
              <PersunaOrb look={id} size={38} animate={false} />
            </button>
          ))}
        </div>
      )}
      {setupStep === "task" && (
        <div className="persuna-in flex flex-wrap gap-1.5 self-start">
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
    const res = await persunaPublishAction(confirm.skill.slug, confirm.versionId, confirmLower);
    setBusy("idle");
    if (!res.ok) return setError(res.error);
    setConfirm(null);
    setMessages((all) => [
      ...all,
      { ...res.value.message, role: "assistant", link: res.value.link },
    ]);
    express(res.value.message.content);
  }

  /** Runs the MCP tool call the user just OK'd. */
  async function mcpConfirmed() {
    if (!mcpConfirm) return;
    setBusy("thinking");
    const res = await persunaMcpConfirmAction(mcpConfirm.token);
    setBusy("idle");
    setMcpConfirm(null);
    if (!res.ok) return setError(res.error);
    setMessages((all) => [
      ...all,
      { ...res.value.message, role: "assistant", link: res.value.link },
    ]);
    express(res.value.message.content);
  }

  /** Runs the desktop action the user just OK'd, then reports how it went. */
  async function operateApproved() {
    if (!operateConfirm) return;
    if (!workModeRef.current) return operateDeclined();
    const proposal = operateConfirm;
    setBusy("thinking");
    const approved = await persunaOperateApproveAction(proposal.token);
    if (!approved.ok) {
      setBusy("idle");
      setOperateConfirm(null);
      return setError(approved.error);
    }
    setOperateConfirm(null);
    const desktop = desktopBridge();
    if (!desktop?.operate) {
      // No desktop: nothing ran. The denial is still reported and logged.
      const res = await persunaOperateSettleAction(approved.value.execToken, {
        status: "denied",
        detail: "Persuna Desktop isn't running",
      });
      setBusy("idle");
      if (!res.ok) return setError(res.error);
      setMessages((all) => [...all, { ...res.value.message, role: "assistant" }]);
      return express(res.value.message.content);
    }
    setOperating({ preview: approved.value.preview });
    operatingRef.current = {
      execToken: approved.value.execToken,
      proposalToken: proposal.token,
    };
    let outcome: { status: "done" | "took_over" | "failed" | "denied"; detail?: string | null };
    try {
      outcome = await desktop.operate(approved.value.action);
    } catch {
      outcome = { status: "failed", detail: "the desktop didn't answer" };
    }
    operatingRef.current = null;
    setOperating(null);
    if (stoppedRef.current) {
      // The stop word or Take over already said so, and the cancellation is logged.
      stoppedRef.current = false;
      setBusy("idle");
      return;
    }
    const res = await persunaOperateSettleAction(approved.value.execToken, {
      status: outcome.status,
      detail: outcome.detail ?? null,
    });
    setBusy("idle");
    if (!res.ok) return setError(res.error);
    setMessages((all) => [
      ...all,
      { ...res.value.message, role: "assistant", link: res.value.link },
    ]);
    express(res.value.message.content);
  }

  /** The user's hand is on the mouse: abort the running action. */
  function takeOver() {
    const running = operatingRef.current;
    operatingRef.current = null;
    stoppedRef.current = true;
    setOperating(null);
    desktopBridge()?.cancelOperate?.();
    // Logged, but not waited for: stopping is instant.
    if (running) void persunaOperateCancelAction(running.proposalToken);
  }

  /** The proposal card's Cancel: nothing ran, the refusal is logged. */
  function operateDeclined() {
    const proposal = operateConfirm;
    setOperateConfirm(null);
    if (proposal) void persunaOperateCancelAction(proposal.token);
  }

  /** Does the send or create the user just OK'd. */
  async function appConfirmed() {
    if (!appConfirm) return;
    setBusy("thinking");
    const res = await persunaAppConfirmAction(appConfirm.token);
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
          className={`persuna-in flex items-center gap-2 self-start rounded-full px-2 py-1.5 text-sm ${card}`}
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
        <div className={`persuna-in rounded-[22px] ${card}`}>
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
        <div className={`persuna-in space-y-3 rounded-[22px] p-4 text-sm ${card}`}>
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
      {mcpConfirm && (
        <div className={`persuna-in space-y-3 rounded-[22px] p-4 text-sm ${card}`}>
          <p className="label-mono text-muted">
            {mcpConfirm.server} · {mcpConfirm.tool}
          </p>
          <p className="max-h-48 overflow-y-auto whitespace-pre-wrap">{mcpConfirm.preview}</p>
          <div className="flex gap-2">
            <button
              type="button"
              disabled={busy !== "idle"}
              onClick={() => void mcpConfirmed()}
              className="rounded-full bg-accent px-4 py-1.5 text-accent-ink disabled:opacity-50"
            >
              Go ahead
            </button>
            <button
              type="button"
              onClick={() => setMcpConfirm(null)}
              className="rounded-full px-3 py-1.5 text-muted hover:text-foreground"
            >
              Cancel
            </button>
          </div>
        </div>
      )}
      {operateConfirm && (
        <div className={`persuna-in space-y-3 rounded-[22px] p-4 text-sm ${card}`}>
          <p className="label-mono text-muted">On your Mac · Work mode</p>
          <p className="max-h-48 overflow-y-auto whitespace-pre-wrap">{operateConfirm.preview}</p>
          <p className="text-xs text-muted">
            Your hand on the mouse takes over at any point. Say “stop” to stop me.
          </p>
          <div className="flex gap-2">
            <button
              type="button"
              disabled={busy !== "idle"}
              onClick={() => void operateApproved()}
              className="rounded-full bg-accent px-4 py-1.5 text-accent-ink disabled:opacity-50"
            >
              Go ahead
            </button>
            <button
              type="button"
              onClick={() => operateDeclined()}
              className="rounded-full px-3 py-1.5 text-muted hover:text-foreground"
            >
              Cancel
            </button>
          </div>
        </div>
      )}
      {operating && (
        <div className={`persuna-in space-y-3 rounded-[22px] p-4 text-sm ${card}`}>
          <p className="label-mono text-muted">Doing it…</p>
          <p className="whitespace-pre-wrap">{operating.preview}</p>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => takeOver()}
              className="rounded-full bg-accent px-4 py-1.5 text-accent-ink"
            >
              Take over
            </button>
          </div>
        </div>
      )}
      {appConfirm && (
        <div className={`persuna-in space-y-3 rounded-[22px] p-4 text-sm ${card}`}>
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
        <div className={`persuna-in space-y-2 rounded-[22px] p-4 text-sm ${card}`}>
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
        <div className={`persuna-in space-y-2 rounded-[22px] p-4 text-sm ${card}`}>
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
            figures, and keep no screenshots. Watching turns Work mode on. Stop any time.
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
      {askLook && (
        <div className={`persuna-in space-y-2 rounded-[22px] p-4 text-sm ${card}`}>
          <p>
            <strong>Take one look at {askLook}?</strong> Just this turn — I won&apos;t keep
            watching, and I never keep the screenshot.
          </p>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => answerLook(true, false)}
              className="rounded-full bg-accent px-4 py-1.5 text-sm text-accent-ink"
            >
              Just this once
            </button>
            <button
              type="button"
              onClick={() => answerLook(true, true)}
              className="rounded-full bg-accent px-4 py-1.5 text-sm text-accent-ink"
            >
              Always allow
            </button>
            <button
              type="button"
              onClick={() => answerLook(false, false)}
              className="rounded-full px-3 py-1.5 text-sm text-muted hover:text-foreground"
            >
              Not now
            </button>
          </div>
        </div>
      )}
      {!watching && watchNote && focusSkill && (
        <div
          className={`persuna-in flex items-center gap-3 rounded-full px-4 py-2 text-sm ${card}`}
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
        <div className={`persuna-in rounded-[22px] ${card}`}>
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
        Boolean(mcpConfirm) ||
        Boolean(made && !props.overlay) ||
        Boolean(switchOffer && busy === "idle") ||
        Boolean(watchNote && !watching))) ||
    Boolean(latestJob);

  const menuItems: { label: string; onSelect: () => void; hidden?: boolean }[] = [
    { label: "Type instead", onSelect: () => (props.overlay ? openPanel(true) : setTyping(true)) },
    { label: "Give me a file", onSelect: () => fileInput.current?.click() },
    {
      label: "Circle something to ask about it",
      onSelect: () => setCircling(true),
      hidden: !props.overlay,
    },
    {
      label: workMode ? "Turn off Work mode" : "Work mode…",
      onSelect: () => (workMode ? setWork(false) : setAskWork(true)),
      hidden: !props.overlay,
    },
    ...(learning
      ? [
          {
            label: `Stop recording ${learning.skill.name}`,
            onSelect: () =>
              void finishLearn().then((done) => {
                if (done) fastExchange("Stop recording", done.line, done.link);
              }),
            hidden: !props.overlay,
          },
        ]
      : []),
    {
      label: watching ? "Stop watching" : "Watch my screen",
      onSelect: () => (watching ? watcher.current?.stop() : setAskWatch(true)),
    },
    {
      label: `Work mode turns off after: ${workAutoOffMin === 0 ? "never" : `${workAutoOffMin} min quiet`}`,
      onSelect: () => {
        const steps = [15, 30, 60, 0];
        const next = steps[(steps.indexOf(workAutoOffMin) + 1) % steps.length] ?? 30;
        setWorkAutoOffMin(next);
        store("persuna.workAutoOffMin", next);
      },
      hidden: !props.overlay,
    },
    {
      label: "Never read these apps…",
      onSelect: () => {
        setEditingExcluded(true);
        setPanel(true);
      },
      hidden: !props.overlay,
    },
    {
      label: voiceOn ? "Mute my voice" : "Talk out loud",
      onSelect: () => {
        const next = !voiceOn;
        setVoiceOn(next);
        store("persuna.voice", next);
        if (!next) stopSpeaking();
      },
    },
    {
      label: agentVoice ? "Hear me with Meta instead" : "Hear me with ElevenLabs (faster)",
      onSelect: () => {
        endConversation();
        setAgentVoice(!agentVoice);
        store("persuna.agentVoice", !agentVoice);
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
      onSelect: () => window.open("/persuna#conversation", props.overlay ? "_blank" : "_self"),
    },
    {
      label: `Hide ${name}`,
      onSelect: () => desktopBridge()?.hide(),
      hidden: !props.overlay,
    },
  ];

  if (props.overlay) {
    const talkHint = holdLabel ? `Hold ${holdLabel} to talk` : `${shortcut} to talk`;
    const barStatus = holding
      ? "Listening…"
      : orbState === "idle" || orbState === "sleeping"
        ? setupDone
          ? circled
            ? "Ask me about what you circled"
            : talkHint
          : "Say hello"
        : status;
    const recent = messages.filter((m) => m.kind === "chat").slice(-2);
    // In Work mode the island is a silent strip: talk shows at the dot, and
    // the island only grows for Persuna itself, permissions and decision cards.
    const quiet = islandQuiet(workMode, setupDone);
    const islandCaption = quiet ? null : caption;
    const islandError = quiet ? null : error;
    const active = quiet ? Boolean(circled) : holding || orbState !== "idle" || Boolean(circled);
    const firstName = props.userName?.split(/\s+/)[0] ?? "";
    const desktop = desktopBridge() ?? null;
    // The island grows from the notch: wider while it's doing something, and
    // down into a card for a reply, an error or Persuna itself.
    const updateReady = update?.status === "ready" && update.version !== updateLater && setupDone;
    const updating = update?.status === "downloading";
    const grown =
      (panel && setupDone) || Boolean(islandCaption) || Boolean(islandError) || updateReady;
    // Taller than the one strip: something shows in a row below it.
    const tall = grown || Boolean(need) || (island.notch && active);
    const wide = Math.min(480, Math.round(window.innerWidth * 0.94));
    const width = grown
      ? wide
      : island.notch
        ? island.notchWidth + 2 * (active ? 92 : 44)
        : active
          ? 300
          : 236;
    const indicator = quiet ? (
      learning ? (
        <span
          className="h-2 w-2 animate-pulse rounded-full bg-[#e5484d]"
          title={`Recording for ${learning.skill.name}`}
        />
      ) : (
        <span className="h-2 w-2 rounded-full bg-[#5cc98f]" title="Work mode is on" />
      )
    ) : looking ? (
      <span
        className="h-2 w-2 animate-pulse rounded-full bg-[#5cc98f]"
        title="Taking one look at your screen"
      />
    ) : holding || orbState === "listening" ? (
      [0.5, 0.8, 1, 0.8, 0.5].map((w, i) => (
        <span
          key={i}
          className="w-[3px] rounded-full bg-[#b794ff] transition-[height] duration-75"
          style={{ height: `${Math.max(3, Math.min(16, level * 22 * w + 3))}px` }}
        />
      ))
    ) : orbState === "thinking" ? (
      [0, 1, 2].map((i) => (
        <span
          key={i}
          className="h-1.5 w-1.5 animate-pulse rounded-full bg-[#b794ff]"
          style={{ animationDelay: `${i * 160}ms` }}
        />
      ))
    ) : orbState === "speaking" ? (
      [0.6, 1, 0.7].map((w, i) => (
        <span
          key={i}
          className="w-[3px] rounded-full bg-[#ffd27a] transition-[height] duration-75"
          style={{ height: `${Math.max(4, Math.min(16, level * 26 * w + 4))}px` }}
        />
      ))
    ) : orbState === "watching" ? (
      <span className="h-2 w-2 rounded-full bg-[#ff6b6b]" title="Watching" />
    ) : workMode ? (
      <span className="h-2 w-2 rounded-full bg-[#5cc98f]" title="Work mode is on" />
    ) : (
      <span className="h-1.5 w-1.5 rounded-full bg-white/25" />
    );
    // What Persuna can do from the island, as one row of icons (names on hover).
    const tools: {
      label: string;
      icon: ToolIcon;
      act: () => void;
      on?: boolean;
      hidden?: boolean;
    }[] = [
      { label: "Type", icon: "type", act: () => openPanel(true) },
      {
        label: "Circle something (⌃⌥C)",
        icon: "circle",
        act: () => void startCircle(),
        hidden: !desktop?.look,
      },
      {
        label: "Show me: explain with a drawing",
        icon: "show",
        act: () => void send("Show me what's on my screen", "", { show: true }),
        hidden: !desktop?.look,
      },
      { label: "Give me a file", icon: "file", act: () => fileInput.current?.click() },
      {
        label: workMode ? "Work mode is on: turn it off" : "Work mode: follow along and help",
        icon: "work",
        on: workMode,
        act: () => (workMode ? setWork(false) : setAskWork(true)),
        hidden: !desktop?.look,
      },
      {
        label: watching ? "Stop watching" : "Watch my screen",
        icon: "work",
        on: watching,
        act: () => (watching ? watcher.current?.stop() : setAskWatch(true)),
        hidden: Boolean(desktop?.look),
      },
      { label: "Wrap up my day", icon: "wrap", act: () => void send("Wrap up my day") },
    ];
    const islandCards =
      hasCards ||
      showSetupInput ||
      made ||
      offer ||
      askWork ||
      askLook ||
      editingExcluded ||
      teachOffer ||
      (attached && !panel);
    return (
      <section
        data-persuna
        aria-label={`${name}, your assistant`}
        className="island-ink pointer-events-none fixed inset-x-0 top-0 z-50 flex flex-col items-center gap-2"
      >
        <input
          ref={fileInput}
          type="file"
          className="hidden"
          accept=".png,.jpg,.jpeg,.webp,.gif,.pdf,.docx,.md,.markdown,.txt"
          onChange={(e) => {
            pickFile(e.target.files?.[0]);
            e.target.value = "";
          }}
        />

        {/* What Persuna is pointing at: a glowing outline around it, with its name. */}
        {pointAt && (
          <div
            aria-hidden
            className="persuna-in pointer-events-none fixed"
            style={{
              left: pointAt.x - 6,
              top: pointAt.y - 6,
              width: pointAt.w + 12,
              height: pointAt.h + 12,
            }}
          >
            <span className="absolute inset-0 animate-pulse rounded-xl ring-[3px] ring-[#a77bff] shadow-[0_0_0_6px_rgba(167,123,255,0.18),0_0_28px_6px_rgba(167,123,255,0.45)]" />
            <span
              className={`label-mono absolute left-0 whitespace-nowrap rounded-full bg-black px-2.5 py-1 text-[10px] text-white shadow-lg ${
                pointAt.y > 60 ? "-top-8" : "-bottom-8"
              }`}
            >
              {pointAt.label.length > 40 ? `${pointAt.label.slice(0, 40)}…` : pointAt.label}
            </span>
          </div>
        )}
        {drawing && (
          <DrawingLayer
            drawing={drawing}
            paceMs={drawPace}
            progress={speakProgress}
            onDone={() => setDrawing(null)}
          />
        )}
        {circling && (
          <CircleLayer
            onCancel={() => setCircling(false)}
            onPick={(pick) => {
              setCircling(false);
              circledRef.current = pick.area;
              setCircled(pick);
            }}
          />
        )}
        {circled && !circling && <CircledMark path={circled.path} />}
        {workMode && setupDone && desktop?.look && (
          <WorkDot
            tone={dotTone}
            looking={dotLooking || (quiet && (holding || busy !== "idle"))}
            bubble={dotLine({
              quiet,
              status: talkStatus(holding, busy),
              talk: dotTalk,
              bubble: dotBubble,
            })}
            hint={holdLabel ? `Hold ${holdLabel} to answer` : null}
          />
        )}

        {/* The island: on the notch, or a floating rounded pill that expands
            on machines without one. Solid black; click for Persuna,
            right-click for more, drop a file on it. */}
        <div
          style={{
            width,
            // On the notch: tight bottom corners while it's a strip, rounder
            // once grown into a card. Without a notch it floats as a pill,
            // fully round until it grows down into a card.
            ...(island.notch
              ? {
                  borderBottomLeftRadius: tall ? 22 : 11,
                  borderBottomRightRadius: tall ? 22 : 11,
                }
              : { marginTop: 10, borderRadius: tall ? 22 : 999 }),
          }}
          onDragOver={(e) => e.preventDefault()}
          onDrop={(e) => {
            e.preventDefault();
            pickFile(e.dataTransfer.files?.[0]);
          }}
          className={`island pointer-events-auto relative bg-black text-white transition-[width,border-radius] duration-300 ease-out ${
            holding
              ? "shadow-[0_8px_30px_-6px_rgba(139,92,246,0.8)]"
              : "shadow-[0_10px_30px_-12px_rgba(0,0,0,0.7)]"
          }`}
        >
          {/* The notch's shoulders: it flares into the menu bar instead of
              hanging below it. A floating pill has no edge to blend into. */}
          {island.notch && (
            <>
              <span aria-hidden className="island-shoulder island-shoulder-left" />
              <span aria-hidden className="island-shoulder island-shoulder-right" />
            </>
          )}
          <button
            type="button"
            aria-label={`${name}: ${panel ? "close" : "open"} (${barStatus})`}
            aria-expanded={panel}
            aria-haspopup="menu"
            onClick={() => {
              // In Work mode the strip is silent: tapping it with the wrap-up
              // offer showing (at the dot) accepts the offer.
              if (quiet && dotTalk === WRAP_UP_OFFER && !talkingNow.current) {
                return void acceptWrap();
              }
              return talkingNow.current ? interrupt() : panel ? setPanel(false) : openPanel();
            }}
            onContextMenu={(e) => {
              e.preventDefault();
              setMenu((m) => !m);
            }}
            style={{ height: island.height }}
            className="flex w-full items-center justify-between gap-3 px-3 outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[#b794ff]"
          >
            <span className="flex shrink-0 items-center">
              <PersunaOrb
                look={look}
                state={orbState}
                level={level}
                size={Math.min(24, island.height - 10)}
                gaze={null}
                animate={orbState !== "sleeping"}
              />
            </span>
            {/* Beside a notch there's no room for words: they go in the row below.
                In Work mode the strip stays silent: words go to the dot. */}
            {island.notch || quiet ? (
              <span className="sr-only" role="status">
                {barStatus}
              </span>
            ) : (
              <span
                className="label-mono flex-1 truncate text-left text-[10px] text-white/75"
                role="status"
              >
                {barStatus}
              </span>
            )}
            {updating && (
              <span className="sr-only" role="status">
                Downloading Persuna {update?.version}: {Math.round((update?.progress ?? 0) * 100)}%
              </span>
            )}
            <span aria-hidden className="flex h-4 shrink-0 items-center justify-end gap-[3px]">
              {/* A new version downloading: a small ring fills up where the dot sits. */}
              {updating && !holding && !["listening", "thinking", "speaking"].includes(orbState) ? (
                <UpdateRing version={update?.version} progress={update?.progress ?? 0} />
              ) : (
                indicator
              )}
            </span>
          </button>

          {island.notch &&
            (active || Boolean(islandCaption) || Boolean(islandError)) &&
            !(panel && setupDone) &&
            !quiet && (
              <p
                aria-hidden
                className="label-mono flex h-7 items-center justify-center px-4 text-[10px] text-white/80"
              >
                {barStatus}
              </p>
            )}

          {islandCaption && !(panel && setupDone) && (
            <button
              type="button"
              onClick={onTap}
              className="block w-full px-5 pb-4 pt-1 text-left text-[13px] leading-snug text-white/95"
            >
              {islandCaption.length > 420 ? `${islandCaption.slice(0, 420)}…` : islandCaption}
            </button>
          )}
          {islandError && (
            <p className="px-5 pb-3 pt-1 text-[12px] leading-snug text-[#ff8f87]">{islandError}</p>
          )}

          {/* The new version is downloaded: restart into it now, or later (it installs on quit). */}
          {updateReady && (
            <div className="flex items-center gap-2 px-5 pb-3.5 pt-1 text-[12.5px] leading-snug">
              <span className="flex-1 text-white/90">
                Persuna {update?.version} is ready to install.
              </span>
              <button
                type="button"
                onClick={() => desktopBridge()?.installUpdate?.()}
                className="rounded-full bg-white px-3 py-1 text-[11px] font-medium text-black"
              >
                Restart now
              </button>
              <button
                type="button"
                onClick={() => setUpdateLater(update?.version ?? null)}
                title="It installs next time Persuna quits"
                className="rounded-full px-2 py-1 text-[11px] text-white/60 hover:text-white"
              >
                Later
              </button>
            </div>
          )}

          {/* A permission it needs, asked for only when you use what needs it. */}
          {need && (
            <div className="flex items-center gap-2 px-5 pb-3.5 pt-1 text-[12.5px] leading-snug">
              <span className="flex-1 text-white/90">{NEEDS[need]}</span>
              <button
                type="button"
                onClick={() => void askFor(need)}
                className="rounded-full bg-white px-3 py-1 text-[11px] font-medium text-black"
              >
                {perms.current?.[need] === "not-determined" ? "Allow" : "Open Settings"}
              </button>
              <button
                type="button"
                onClick={() => setNeed(null)}
                aria-label="Not now"
                className="px-1 text-white/50 hover:text-white"
              >
                ×
              </button>
            </div>
          )}

          {/* Persuna itself: who it is, what it's on, the last words, and what it can do. */}
          {panel && setupDone && (
            <div className="space-y-2.5 px-4 pb-4 pt-0.5">
              <div className="flex items-center gap-3">
                <PersunaOrb look={look} state={orbState} level={level} size={36} gaze={null} />
                <div className="min-w-0 flex-1">
                  <h2 className="truncate text-[14px] font-medium leading-tight">
                    {firstName ? `${firstName}, what's next?` : "What's next?"}
                  </h2>
                  <p className="truncate text-[11.5px] text-white/50">
                    {focusSkill
                      ? `Today: ${focusSkill.name}`
                      : (props.focus ?? "Tell me what you're working on")}
                    {workMode ? " · Work mode on" : ""}
                  </p>
                </div>
              </div>
              {caption && (
                <p className="text-[13px] leading-snug text-white/90">
                  {caption.length > 420 ? `${caption.slice(0, 420)}…` : caption}
                </p>
              )}
              {!caption && recent.length > 0 && (
                <ul className="space-y-1 text-[13px] leading-snug">
                  {recent.slice(-1).map((m) => (
                    <li
                      key={m.id}
                      className={`line-clamp-2 ${m.role === "user" ? "text-white/50" : "text-white/90"}`}
                    >
                      <span className="label-mono mr-2 text-[9px] text-white/35">
                        {m.role === "user" ? "You" : name}
                      </span>
                      {m.content.length > 160 ? `${m.content.slice(0, 160)}…` : m.content}
                    </li>
                  ))}
                </ul>
              )}
              {attached && (
                <form
                  onSubmit={(e) => {
                    e.preventDefault();
                    void sendFile(attached, text);
                  }}
                  className="space-y-2 rounded-2xl bg-white/[0.06] p-3"
                >
                  <div className="flex items-center gap-2 text-[12px]">
                    <span className="label-mono rounded-full bg-white/10 px-2 py-0.5 text-[9px]">
                      File
                    </span>
                    <span className="flex-1 truncate">{attached.name}</span>
                    <button
                      type="button"
                      aria-label="Remove the file"
                      onClick={() => setAttached(null)}
                      className="text-white/50 hover:text-white"
                    >
                      ×
                    </button>
                  </div>
                  <input
                    aria-label="What should I do with it?"
                    value={text}
                    onChange={(e) => setText(e.target.value)}
                    autoFocus
                    placeholder="What should I do with it?"
                    className="w-full rounded-full bg-white/10 px-3 py-1.5 text-[13px] outline-none placeholder:text-white/35"
                  />
                  <div className="flex flex-wrap gap-1.5">
                    {[
                      "Summarise it",
                      "Make a table",
                      "Draw it as a flow",
                      "What needs my attention?",
                    ].map((ask) => (
                      <button
                        key={ask}
                        type="button"
                        disabled={busy !== "idle"}
                        onClick={() => void sendFile(attached, ask)}
                        className={CHIP}
                      >
                        {ask}
                      </button>
                    ))}
                    <button
                      type="submit"
                      disabled={busy !== "idle"}
                      className="label-mono rounded-full bg-white px-3 py-1.5 text-[10px] text-black disabled:opacity-40"
                    >
                      Send
                    </button>
                  </div>
                </form>
              )}
              {islandTyping && !attached && (
                <form
                  onSubmit={(e) => {
                    e.preventDefault();
                    void send(text);
                  }}
                  className="flex items-center gap-1.5 rounded-full bg-white/10 p-1 pl-4"
                >
                  <label className="sr-only" htmlFor="persuna-panel-input">
                    Message {name}
                  </label>
                  <input
                    id="persuna-panel-input"
                    ref={panelInput}
                    value={text}
                    onChange={(e) => {
                      interrupt();
                      setText(e.target.value);
                    }}
                    onKeyDown={(e) => e.key === "Escape" && setIslandTyping(false)}
                    autoComplete="off"
                    placeholder={`Ask ${name} anything…`}
                    className="min-w-0 flex-1 bg-transparent text-[13px] text-white outline-none placeholder:text-white/35 focus-visible:outline-none"
                  />
                  <button
                    type="submit"
                    disabled={!text.trim()}
                    aria-label="Send"
                    className="grid h-7 w-7 shrink-0 place-items-center rounded-full bg-white text-black disabled:opacity-30"
                  >
                    <Icon name="send" />
                  </button>
                </form>
              )}
              <div className="flex items-center gap-1" role="toolbar" aria-label="What I can do">
                {tools
                  .filter((t) => !t.hidden && !(t.icon === "type" && islandTyping))
                  .map((t) => (
                    <button
                      key={t.label}
                      type="button"
                      onClick={t.act}
                      title={t.label}
                      aria-label={t.label}
                      aria-pressed={t.on}
                      className={`grid h-9 w-9 place-items-center rounded-full transition-colors ${
                        t.on
                          ? "bg-[#5cc98f]/20 text-[#5cc98f]"
                          : "text-white/75 hover:bg-white/10 hover:text-white"
                      }`}
                    >
                      <ToolGlyph icon={t.icon} />
                    </button>
                  ))}
                <span className="label-mono ml-auto text-[9px] text-white/35">{talkHint}</span>
              </div>
            </div>
          )}
        </div>

        {toast && (
          <p className="persuna-in label-mono rounded-full bg-black px-3 py-1.5 text-[10px] text-white ring-1 ring-white/10">
            {toast}
          </p>
        )}

        {islandCards && (
          <div className="pointer-events-auto flex w-[min(30rem,94vw)] flex-col gap-2">
            {!setupDone ? setupChips : assistCards}
            {teachOffer && (
              <div
                className={`persuna-in flex items-center gap-2 rounded-[22px] p-2 pl-4 text-[13px] ${ISLAND_CARD}`}
              >
                <span className="flex-1">
                  I&apos;ve learned {teachOffer.steps} steps of how you work. Teach them to{" "}
                  {teachOffer.skill}?
                </span>
                <button
                  type="button"
                  onClick={() => void teachSteps()}
                  className="rounded-full bg-white px-3 py-1.5 text-xs font-medium text-black"
                >
                  Teach it
                </button>
                <button
                  type="button"
                  onClick={() => setTeachOffer(null)}
                  className="rounded-full px-3 py-1.5 text-xs text-white/60 hover:text-white"
                >
                  Not now
                </button>
              </div>
            )}
            {offer && (
              <div
                className={`persuna-in flex items-center gap-2 rounded-[22px] p-2 pl-4 text-sm ${ISLAND_CARD}`}
              >
                <span className="flex-1 text-[13px]">{offer}?</span>
                <button
                  type="button"
                  onClick={() => {
                    const ask = offer;
                    setOffer(null);
                    void send(ask);
                  }}
                  className="rounded-full bg-white px-3 py-1.5 text-xs font-medium text-black"
                >
                  Do it
                </button>
                <button
                  type="button"
                  onClick={() => setOffer(null)}
                  className="rounded-full px-3 py-1.5 text-xs text-white/60 hover:text-white"
                >
                  Not now
                </button>
              </div>
            )}
            {askWork && (
              <div
                className={`persuna-in space-y-2 rounded-[22px] p-4 text-[13px] leading-snug ${ISLAND_CARD}`}
              >
                <p>
                  <strong>Work mode.</strong> While you work, I keep an eye on what you&apos;re
                  doing (read on this computer, every few seconds when something changes). I learn
                  your steps quietly, give you a pointer when you seem stuck or are hunting for
                  something, and offer to take over the parts I can do, your way. I keep only the
                  steps, never what&apos;s on screen. Turn it off any time.
                </p>
                <div className="flex gap-2">
                  <button
                    type="button"
                    onClick={() => void enableWork()}
                    className="rounded-full bg-white px-4 py-1.5 text-xs font-medium text-black"
                  >
                    Turn on Work mode
                  </button>
                  <button
                    type="button"
                    onClick={() => setAskWork(false)}
                    className="rounded-full px-3 py-1.5 text-xs text-white/60 hover:text-white"
                  >
                    Not now
                  </button>
                </div>
              </div>
            )}
            {askLook && (
              <div
                className={`persuna-in space-y-2 rounded-[22px] p-4 text-[13px] leading-snug ${ISLAND_CARD}`}
              >
                <p>
                  <strong>Take one look at {askLook}?</strong> Just this turn — I won&apos;t keep
                  watching, and I never keep the screenshot.
                </p>
                <div className="flex gap-2">
                  <button
                    type="button"
                    onClick={() => answerLook(true, false)}
                    className="rounded-full bg-white px-4 py-1.5 text-xs font-medium text-black"
                  >
                    Just this once
                  </button>
                  <button
                    type="button"
                    onClick={() => answerLook(true, true)}
                    className="rounded-full bg-white px-4 py-1.5 text-xs font-medium text-black"
                  >
                    Always allow
                  </button>
                  <button
                    type="button"
                    onClick={() => answerLook(false, false)}
                    className="rounded-full px-3 py-1.5 text-xs text-white/60 hover:text-white"
                  >
                    Not now
                  </button>
                </div>
              </div>
            )}
            {editingExcluded && (
              <div
                className={`persuna-in space-y-2 rounded-[22px] p-4 text-[13px] leading-snug ${ISLAND_CARD}`}
              >
                <p>
                  <strong>Never read these apps.</strong> I skip them even in Work mode — nothing
                  about them is captured or sent. Names as they appear, e.g. 1Password.
                </p>
                {excludedApps.length > 0 && (
                  <ul className="space-y-1">
                    {excludedApps.map((app) => (
                      <li key={app} className="flex items-center gap-2">
                        <span className="flex-1 truncate">{app}</span>
                        <button
                          type="button"
                          onClick={() => removeExcluded(app)}
                          aria-label={`Remove ${app}`}
                          className="text-white/60 hover:text-white"
                        >
                          ×
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
                <form
                  onSubmit={(e) => {
                    e.preventDefault();
                    addExcluded();
                  }}
                  className="flex items-center gap-1.5 rounded-full bg-white/10 p-1 pl-4"
                >
                  <label className="sr-only" htmlFor="persuna-excluded-input">
                    App never to read
                  </label>
                  <input
                    id="persuna-excluded-input"
                    value={excludedDraft}
                    onChange={(e) => setExcludedDraft(e.target.value)}
                    autoComplete="off"
                    placeholder="App name…"
                    className="min-w-0 flex-1 bg-transparent text-[13px] text-white outline-none placeholder:text-white/35 focus-visible:outline-none"
                  />
                  <button
                    type="submit"
                    className="rounded-full bg-white px-4 py-1.5 text-xs font-medium text-black"
                  >
                    Add
                  </button>
                </form>
                <div className="flex gap-2">
                  <button
                    type="button"
                    onClick={() => setEditingExcluded(false)}
                    className="rounded-full px-3 py-1.5 text-xs text-white/60 hover:text-white"
                  >
                    Done
                  </button>
                </div>
              </div>
            )}
            {made && (
              <MadeFileCard
                file={made}
                desktop={desktop}
                onClose={() => setMade(null)}
                onCopy={(t) => void doClipboard({ op: "copy", text: t })}
              />
            )}
            {latestJob?.jobId && (
              <div className={`persuna-in rounded-[22px] p-3 text-sm ${ISLAND_CARD}`}>
                <div className="flex items-center gap-2">
                  <span className="flex-1">{latestJob.content}</span>
                  <button
                    type="button"
                    onClick={() => setDismissedJob(latestJob.jobId!)}
                    aria-label="Close"
                    className="text-white/60 hover:text-white"
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
                className={`persuna-in flex items-center gap-1.5 rounded-full p-1.5 pl-4 ${ISLAND_CARD}`}
              >
                <input
                  aria-label={`Message ${name}`}
                  value={text}
                  onChange={(e) => setText(e.target.value)}
                  onKeyDown={(e) => e.key === "Escape" && setSetupLater(true)}
                  autoComplete="off"
                  placeholder="Type, or hold to talk"
                  className="min-w-0 flex-1 bg-transparent text-sm text-white outline-none placeholder:text-white/35"
                />
                <button
                  type="submit"
                  disabled={!text.trim()}
                  aria-label="Send"
                  className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-white text-black disabled:opacity-30"
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
            className={`persuna-in pointer-events-auto flex w-64 flex-col rounded-2xl p-1.5 text-sm ${ISLAND_CARD}`}
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
                  className="rounded-xl px-3 py-2 text-left text-white/90 hover:bg-white/10"
                >
                  {item.label}
                </button>
              ))}
            <p className="label-mono px-3 pb-1 pt-2 text-[10px] text-white/45">
              {talkHint} · double-tap to type
            </p>
          </div>
        )}
      </section>
    );
  }

  return (
    <section
      data-persuna
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
      <input
        ref={fileInput}
        type="file"
        className="hidden"
        accept=".png,.jpg,.jpeg,.webp,.gif,.pdf,.docx,.md,.markdown,.txt"
        onChange={(e) => {
          const file = e.target.files?.[0];
          e.target.value = "";
          if (file) {
            setAttached(file);
            setTyping(true);
          }
        }}
      />
      {drawing && (
        <DrawingLayer drawing={drawing} progress={speakProgress} onDone={() => setDrawing(null)} />
      )}
      {toast && (
        <p className="persuna-in label-mono pointer-events-none fixed bottom-6 left-1/2 -translate-x-1/2 rounded-full bg-black px-3 py-1.5 text-[10px] text-white">
          {toast}
        </p>
      )}
      {/* Beside Persuna: what it's saying, and a card when it needs a decision. */}
      <div
        className={`absolute flex w-max max-w-80 flex-col gap-2 ${side} ${low ? "bottom-6" : "top-2"}`}
        aria-live="polite"
      >
        {hasCards && (
          <div className="pointer-events-auto flex w-80 flex-col gap-2">
            {!setupDone ? setupChips : assistCards}
            {made && (
              <MadeFileCard
                file={made}
                desktop={null}
                onClose={() => setMade(null)}
                onCopy={(t) => void doClipboard({ op: "copy", text: t })}
              />
            )}
            {latestJob?.jobId && (
              <div className={`persuna-in rounded-[22px] p-3 text-sm ${glass}`}>
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
            className={`persuna-in pointer-events-auto max-w-80 px-4 py-2.5 text-left text-sm leading-snug ${glass} rounded-[22px] ${
              right ? "rounded-tr-md" : "rounded-tl-md"
            }`}
          >
            {caption.length > 260 ? `${caption.slice(0, 260)}…` : caption}
          </button>
        )}
        {error && (
          <p className="persuna-in pointer-events-auto rounded-full bg-danger/10 px-3 py-1.5 text-sm text-danger backdrop-blur">
            {error}
          </p>
        )}
        {(typing || showSetupInput) && (
          <form
            onSubmit={(e) => {
              e.preventDefault();
              if (attached) void sendFile(attached, text);
              else void send(text);
              if (setupDone) setTyping(false);
            }}
            className={`persuna-in pointer-events-auto flex w-80 items-center gap-1.5 rounded-full p-1.5 pl-4 ${glass}`}
          >
            <label className="sr-only" htmlFor="persuna-input">
              Message {name}
            </label>
            <input
              id="persuna-input"
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
              placeholder={
                attached
                  ? `${attached.name}: what should I do with it?`
                  : setupDone
                    ? `Type to ${name}…`
                    : "Type, or tap me and just talk"
              }
              className="min-w-0 flex-1 bg-transparent text-sm outline-none placeholder:text-faint"
            />
            <button
              type="submit"
              disabled={!text.trim() && !attached}
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
          className={`persuna-in pointer-events-auto absolute bottom-[calc(100%+6px)] flex w-56 flex-col rounded-2xl p-1.5 text-sm ${glass} ${
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
          <span className={orbState === "sleeping" ? "" : "persuna-float"}>
            <PersunaOrb look={look} state={orbState} level={level} size={ORB} gaze={gaze} />
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

type ToolIcon = "type" | "circle" | "file" | "work" | "wrap" | "show";
const TOOL_PATHS: Record<ToolIcon, string> = {
  show: "M4 20c3-1 3.5-3.5 6-6l7.2-7.2a2.06 2.06 0 0 1 2.9 2.9L13 16.8c-2.5 2.5-5 2.2-9 3.2Z",
  type: "M4 7h16v10H4zM7 10h1m3 0h1m3 0h1m2 0h0M8 14h8",
  circle:
    "M12 5c4.4 0 8 2.4 8 5.6 0 3.3-3.6 5.9-8 5.9-1.1 0-2.2-.1-3.1-.4M5.2 13.4C4.4 12.6 4 11.6 4 10.6 4 7.4 7.6 5 12 5M7 16.5 5 20",
  file: "M8.5 12.5 14 7a2.5 2.5 0 0 1 3.5 3.5l-7 7a4 4 0 0 1-5.7-5.7l6.6-6.6",
  work: "M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12Zm9.5 3a3 3 0 1 0 0-6 3 3 0 0 0 0 6Z",
  wrap: "M20 14.5A8 8 0 0 1 9.5 4a8 8 0 1 0 10.5 10.5Z",
};

/** The island's tool icons, drawn to match the companion's other icons. */
function ToolGlyph({ icon }: { icon: ToolIcon }) {
  return (
    <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden>
      <path
        d={TOOL_PATHS[icon]}
        fill="none"
        stroke="currentColor"
        strokeWidth="1.7"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

/**
 * A new Persuna Desktop downloading: a ring that fills as it comes in. It's
 * drawn for the eye; screen readers hear the progress from the island itself.
 */
function UpdateRing({ version, progress }: { version?: string; progress: number }) {
  const pct = Math.round(Math.min(1, Math.max(0, progress)) * 100);
  const r = 6.5;
  const around = 2 * Math.PI * r;
  return (
    <svg viewBox="0 0 18 18" width={18} height={18} data-update-ring={pct} className="-rotate-90">
      <title>{`Downloading Persuna ${version ?? ""}: ${pct}%`}</title>
      <circle cx={9} cy={9} r={r} fill="none" stroke="rgba(255,255,255,0.18)" strokeWidth={2.2} />
      <circle
        cx={9}
        cy={9}
        r={r}
        fill="none"
        stroke="#b794ff"
        strokeWidth={2.2}
        strokeLinecap="round"
        strokeDasharray={around}
        strokeDashoffset={around * (1 - Math.max(0.04, pct / 100))}
        className="transition-[stroke-dashoffset] duration-500"
      />
    </svg>
  );
}
