"use client";

import { useRouter } from "next/navigation";
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
  type ReactNode,
} from "react";
import {
  persunaIntroAction,
  persunaSetupAction,
  persunaTranscribeAction,
} from "@/app/actions/persuna";
import { AuthForm } from "@/components/auth-form";
import { PersunaOrb, type OrbState } from "@/components/persuna/orb";
import {
  meterMic,
  preferredMic,
  setPreferredMic,
  speak,
  startHoldRecording,
  stopSpeaking,
  type HoldRecording,
} from "@/components/persuna/voice";
import { toTranscribableWav } from "@/lib/audio/convert";
import { LOOKS, LOOK_IDS, lookOf, type LookId } from "@/lib/persuna/looks";
import {
  INTRO_ACKS,
  INTRO_QUESTIONS,
  parseName,
  suggestedSkill,
  COMMON_SKILLS,
  MAX_FIRST_SKILLS,
  describeSkill,
  type IntroAnswers,
} from "@/lib/persuna/onboarding";

type Access = "granted" | "denied" | "not-determined" | "restricted" | "unknown";

/** What Persuna Desktop's setup window can ask the app (desktop/setup-preload.js). */
interface SetupBridge {
  permissions(): Promise<{
    mic: Access;
    keyboard: Access;
    screen: Access;
    holdKey: string | null;
    mac: boolean;
  }>;
  askMic(): Promise<boolean>;
  askKeyboard(): Promise<void>;
  askScreen(): Promise<void>;
  /** A grant gone stale: clear it and start over, in one step. */
  resetPermission(kind: "keyboard" | "screen"): Promise<void>;
  /** Try every permission for real, with plain words when one fails. */
  selfTest(): Promise<{
    mic: Access;
    keyboard: { status: Access; detail: string | null };
    screen: { status: Access; detail: string | null };
  } | null>;
  /** Windows: waits for a real press of the talk key. Missing before desktop 0.8.2. */
  testKey?(): Promise<{ status: Access; detail: string | null } | null>;
  dragApp(): void;
  appIcon(): Promise<string | null>;
  restart(): void;
  signInWithBrowser(): void;
  finish(options: { openAtLogin: boolean }): void;
  onHold(handler: (phase: "start" | "end" | "cancel" | "type") => void): void;
}

const bridge = (): SetupBridge | null => {
  if (typeof window === "undefined") return null;
  // The pre-rename name keeps setup working in Persuna Desktop before 0.7.
  const w = window as Window & { persunaSetup?: SetupBridge; personaSetup?: SetupBridge };
  return w.persunaSetup ?? w.personaSetup ?? null;
};

const noSubscribe = () => () => {};
/** The bridge, for rendering: absent on the server, so the first paint matches. */
const useBridge = () => useSyncExternalStore(noSubscribe, bridge, () => null);

type Step = "account" | "access" | "mic" | "talk" | "meet" | "about" | "first" | "ready";

const STEPS: Record<Step, { label: string; title: string; sub: string }> = {
  account: {
    label: "Sign in",
    title: "Let's get you signed in",
    sub: "Your skills, notes and memory stay with your PERSUNA account.",
  },
  access: {
    label: "Permissions",
    title: "Three permissions, each for a reason",
    sub: "macOS asks for each one once. You can change them any time in System Settings.",
  },
  mic: {
    label: "Microphone",
    title: "Can I hear you?",
    sub: "Say anything. The wave moves when your voice comes through.",
  },
  talk: {
    label: "Talking",
    title: "Hold, talk, let go",
    sub: "That's how you talk to me, from any app.",
  },
  meet: {
    label: "My name",
    title: "Name me, and pick my look",
    sub: "This is how I'll appear at the top of your screen.",
  },
  about: {
    label: "About you",
    title: "Four quick questions",
    sub: "So I'm useful from the first day. Talk or type, whichever's easier.",
  },
  first: {
    label: "First skill",
    title: "One thing to learn your way",
    sub: "I'll learn how you do it, from your examples and your answers.",
  },
  ready: {
    label: "Ready",
    title: "You're all set",
    sub: "I'll be at the top of your screen, on the notch.",
  },
};

export interface DesktopSetupProps {
  user: { name: string } | null;
  persuna: { name: string; avatar: string; setupDone: boolean } | null;
  skills: { slug: string; name: string }[];
  signInExpired: boolean;
}

/**
 * Persuna Desktop's setup, in its own window: Persuna on a stage at the left
 * (talking you through it), the step on the right. A returning user who has
 * met Persuna before only checks permissions, the mic and the talk key.
 */
export function DesktopSetup(props: DesktopSetupProps) {
  const met = props.persuna?.setupDone ?? false;
  const steps: Step[] = [
    ...(props.user ? [] : (["account"] as const)),
    "access",
    "mic",
    "talk",
    ...(met ? [] : (["meet", "about", "first"] as const)),
    "ready",
  ];
  const [step, setStep] = useState<Step>(steps[0]);
  const at = steps.indexOf(step);
  const next = () => setStep(steps[Math.min(at + 1, steps.length - 1)]);
  const back = at > 0 && step !== "ready" ? () => setStep(steps[at - 1]) : null;

  const [name, setName] = useState(props.persuna?.name ?? "Persuna");
  const [look, setLook] = useState<LookId>(lookOf(props.persuna?.avatar ?? "plum"));
  const [orb, setOrb] = useState<OrbState>("idle");
  const [level, setLevel] = useState(0);
  const [line, setLine] = useState<string | null>(null);
  const [answers, setAnswers] = useState<IntroAnswers>({});

  const say = useCallback(async (text: string) => {
    setLine(text);
    setOrb("speaking");
    await speak(text, { onLevel: setLevel });
    setOrb("idle");
    setLevel(0);
  }, []);
  useEffect(() => () => stopSpeaking(), []);

  const copy = STEPS[step];
  const voice = { say, setOrb, setLevel };

  return (
    <main className="grid min-h-screen grid-cols-[minmax(280px,34%)_1fr] bg-[#faf8fc] text-foreground">
      {/* The stage: Persuna, what it's saying, and where you are. */}
      <aside className="persuna-drag relative flex flex-col overflow-hidden bg-[linear-gradient(160deg,#1d1131_0%,#2c1650_55%,#43206d_100%)] px-7 pb-7 pt-14 text-white">
        <div
          aria-hidden
          className="pointer-events-none absolute -left-24 top-10 h-72 w-72 rounded-full bg-[#8b5cf6]/25 blur-3xl"
        />
        <div
          aria-hidden
          className="pointer-events-none absolute -right-20 bottom-24 h-64 w-64 rounded-full bg-[#ec8fd8]/15 blur-3xl"
        />
        <div className="relative flex flex-col items-center text-center">
          <div
            className="rounded-full transition-[box-shadow] duration-300"
            style={{
              boxShadow: `0 0 ${30 + level * 70}px ${6 + level * 20}px rgba(167,120,255,${0.18 + level * 0.35})`,
            }}
          >
            <PersunaOrb look={look} state={orb} level={level} size={124} />
          </div>
          <p className="label-mono mt-5 text-[10px] text-white/50">{name}</p>
          <p
            aria-live="polite"
            data-testid="persuna-line"
            className="mt-2 min-h-[5.5rem] font-display text-[19px] font-medium leading-snug tracking-[-0.01em] text-white/95"
          >
            {line ?? ""}
          </p>
        </div>
        <ol className="relative mt-auto space-y-2.5 pt-6">
          {steps.map((s, i) => (
            <li key={s} className="flex items-center gap-3 text-sm">
              <span
                className={`grid h-5 w-5 shrink-0 place-items-center rounded-full text-[10px] ${
                  i < at
                    ? "bg-[#b794ff] text-[#1d1131]"
                    : i === at
                      ? "text-white ring-2 ring-[#b794ff]"
                      : "text-white/40 ring-1 ring-white/25"
                }`}
              >
                {i < at ? "✓" : i + 1}
              </span>
              <span
                aria-current={i === at ? "step" : undefined}
                className={
                  i === at ? "font-medium text-white" : i < at ? "text-white/70" : "text-white/40"
                }
              >
                {STEPS[s].label}
              </span>
            </li>
          ))}
        </ol>
      </aside>

      {/* The step. */}
      <section className="flex min-h-screen flex-col px-10 pb-8 pt-14">
        <header className="persuna-drag">
          <h1 className="font-display text-[28px] font-medium leading-tight tracking-[-0.03em]">
            {copy.title}
          </h1>
          <p className="mt-1.5 max-w-lg text-[15px] text-muted">{copy.sub}</p>
        </header>
        <div className="mt-7 flex flex-1 flex-col">
          {step === "account" && <AccountStep expired={props.signInExpired} say={say} />}
          {step === "access" && <AccessStep say={say} back={back} onDone={next} />}
          {step === "mic" && <MicStep {...voice} back={back} onDone={next} />}
          {step === "talk" && (
            <TalkStep {...voice} userName={props.user?.name ?? ""} back={back} onDone={next} />
          )}
          {step === "meet" && (
            <MeetStep
              say={say}
              name={name}
              look={look}
              onName={setName}
              onLook={setLook}
              back={back}
              onDone={next}
            />
          )}
          {step === "about" && (
            <AboutStep
              {...voice}
              back={back}
              onDone={(all) => {
                setAnswers(all);
                next();
              }}
            />
          )}
          {step === "first" && (
            <FirstSkillStep
              say={say}
              name={name}
              look={look}
              skills={props.skills}
              timeSink={answers.timeSink}
              back={back}
              onDone={next}
            />
          )}
          {step === "ready" && <ReadyStep say={say} name={name} />}
        </div>
      </section>
    </main>
  );
}

type Say = (text: string) => Promise<void>;
interface Voice {
  say: Say;
  setOrb: (s: OrbState) => void;
  setLevel: (l: number) => void;
}
type Nav = { back: (() => void) | null; onDone: () => void };

const primary =
  "rounded-full bg-accent px-6 py-2.5 text-sm font-medium text-accent-ink shadow-[0_8px_20px_-8px_rgba(106,47,141,0.7)] transition hover:brightness-110 disabled:opacity-40 disabled:shadow-none";
const quiet = "rounded-full px-4 py-2.5 text-sm text-muted hover:text-foreground";
const field =
  "w-full rounded-xl border border-line-strong bg-card px-3.5 py-2.5 text-sm outline-none transition focus:border-accent focus:ring-4 focus:ring-accent/10 focus-visible:outline-none";

/** The step's buttons, along the bottom. */
function Footer({ back, children }: { back?: (() => void) | null; children: ReactNode }) {
  return (
    <div className="mt-auto flex items-center gap-3 border-t border-line pt-5">
      {back && (
        <button type="button" onClick={back} className={`${quiet} px-0`}>
          ← Back
        </button>
      )}
      <span className="flex-1" />
      {children}
    </div>
  );
}

/** Runs once when a step opens: Persuna says its line. */
function useIntro(say: Say, text: string) {
  useEffect(() => {
    void say(text);
    // Only on entering the step.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
}

/** Small line icons. */
function Glyph({ name }: { name: "mic" | "key" | "screen" | "browser" | "mail" }) {
  const d = {
    mic: "M12 4a3 3 0 0 1 3 3v5a3 3 0 0 1-6 0V7a3 3 0 0 1 3-3zM6 11a6 6 0 0 0 12 0M12 17v3",
    key: "M4 7h16v10H4zM7 10h1m3 0h1m3 0h1M8 14h8",
    screen: "M3 5h18v11H3zM8 20h8M12 16v4",
    browser: "M3 5h18v14H3zM3 9h18M6 7h.01M9 7h.01",
    mail: "M3 6h18v12H3zM3 7l9 6 9-6",
  }[name];
  return (
    <svg
      viewBox="0 0 24 24"
      width="20"
      height="20"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.7"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <path d={d} />
    </svg>
  );
}

/* ---------- Sign in ---------- */

function AccountStep({ expired, say }: { expired: boolean; say: Say }) {
  const [mode, setMode] = useState<"choose" | "waiting" | "sign-in" | "sign-up">("choose");
  const desktop = useBridge();
  useIntro(
    say,
    expired
      ? "That sign-in link ran out. Let's try once more."
      : "Hi, I'm Persuna. First, let's get you signed in.",
  );
  if (mode === "sign-in" || mode === "sign-up") {
    return (
      <div className="persuna-no-drag flex flex-1 flex-col">
        <div className="max-w-sm">
          <AuthForm
            key={mode}
            mode={mode}
            next="/desktop/setup"
            onSwitchMode={() => setMode(mode === "sign-in" ? "sign-up" : "sign-in")}
          />
        </div>
        <Footer back={() => setMode("choose")}>{null}</Footer>
      </div>
    );
  }
  return (
    <div className="flex max-w-lg flex-col gap-3">
      {desktop && (
        <button
          type="button"
          onClick={() => {
            desktop.signInWithBrowser();
            setMode("waiting");
          }}
          className="flex items-start gap-4 rounded-2xl bg-card p-5 text-left ring-1 ring-accent/30 transition hover:ring-accent"
        >
          <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-accent-soft text-accent">
            <Glyph name="browser" />
          </span>
          <span className="flex-1">
            <span className="flex items-center gap-2 font-medium">
              {mode === "waiting" ? "Waiting for your browser…" : "Continue in your browser"}
              <span className="label-mono rounded-full bg-accent-soft px-2 py-0.5 text-[9px] text-accent">
                Quickest
              </span>
            </span>
            <span className="mt-0.5 block text-sm text-muted">
              {mode === "waiting"
                ? "Finish there and I'll carry on here. Click to open it again."
                : "If you're already signed in to PERSUNA there, it's one click."}
            </span>
          </span>
        </button>
      )}
      <button
        type="button"
        onClick={() => setMode("sign-in")}
        className="flex items-start gap-4 rounded-2xl bg-card p-5 text-left ring-1 ring-line transition hover:ring-line-strong"
      >
        <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-subtle text-muted">
          <Glyph name="mail" />
        </span>
        <span className="flex-1">
          <span className="block font-medium">Sign in with email here</span>
          <span className="mt-0.5 block text-sm text-muted">Your PERSUNA email and password.</span>
        </span>
      </button>
      <button
        type="button"
        onClick={() => setMode("sign-up")}
        className={`${quiet} self-start px-0`}
      >
        New to PERSUNA? <span className="text-accent">Create an account</span>
      </button>
    </div>
  );
}

/* ---------- Permissions ---------- */

function AccessStep({ say, back, onDone }: { say: Say } & Nav) {
  const desktop = useBridge();
  const [state, setState] = useState<Awaited<ReturnType<SetupBridge["permissions"]>> | null>(null);
  const [icon, setIcon] = useState<string | null>(null);
  const [opened, setOpened] = useState<string | null>(null);
  const [testing, setTesting] = useState(false);
  const [tested, setTested] = useState<Awaited<ReturnType<SetupBridge["selfTest"]>> | null>(null);
  const [pressKey, setPressKey] = useState(false);
  useIntro(
    say,
    typeof navigator !== "undefined" && /Windows/.test(navigator.userAgent)
      ? "Windows doesn't ask for these, so I'll test that each one really works."
      : "I need three things from your Mac. I'll say why for each.",
  );

  useEffect(() => {
    if (!desktop) return;
    let alive = true;
    const poll = () => desktop.permissions().then((s) => alive && setState(s));
    void poll();
    void desktop.appIcon().then((i) => alive && setIcon(i));
    const timer = window.setInterval(poll, 1000);
    return () => {
      alive = false;
      clearInterval(timer);
    };
  }, [desktop]);

  if (!desktop) {
    return (
      <div className="flex flex-1 flex-col">
        <p className="max-w-md text-sm text-muted">
          Open this from Persuna Desktop to set permissions. In a browser, Persuna asks for the
          microphone the first time you talk.
        </p>
        <Footer back={back}>
          <button type="button" onClick={onDone} className={primary}>
            Continue
          </button>
        </Footer>
      </div>
    );
  }
  const ok = (a?: Access) => a === "granted";
  const mac = state?.mac !== false;

  /** Tries everything for real. Windows also waits for a real press of the talk key. */
  async function runTest() {
    if (!desktop || testing) return;
    setTesting(true);
    try {
      const result = await desktop.selfTest();
      setTested(result);
      if (!mac && result && state?.holdKey && desktop.testKey) {
        setPressKey(true);
        const key = await desktop.testKey();
        setPressKey(false);
        if (key) setTested({ ...result, keyboard: key });
      }
      setState(await desktop.permissions());
    } finally {
      setPressKey(false);
      setTesting(false);
    }
  }

  const rows = [
    {
      key: "mic",
      glyph: "mic" as const,
      title: "Microphone",
      why: "To hear you while you hold the talk key. Never otherwise.",
      status: state?.mic,
      action: () => void desktop.askMic(),
      drag: false,
    },
    {
      key: "keyboard",
      glyph: "key" as const,
      title: mac ? "Accessibility" : "Talk key",
      why: "To notice the talk key from any app. I react to that one key only.",
      status: state?.keyboard,
      action: () => {
        setOpened("keyboard");
        if (mac) void desktop.askKeyboard();
        else void runTest();
      },
      drag: true,
    },
    {
      key: "screen",
      glyph: "screen" as const,
      title: mac ? "Screen Recording" : "Your screen",
      why: "To see what you mean when you ask about your screen, and to watch when you ask me to.",
      status: state?.screen,
      action: () => {
        setOpened("screen");
        if (mac) void desktop.askScreen();
        else void runTest();
      },
      drag: true,
    },
  ];
  const needed = ok(state?.mic) && (ok(state?.keyboard) || !state?.mac);

  return (
    <div className="flex flex-1 flex-col">
      <ul className="max-w-xl space-y-3">
        {rows.map((row) => (
          <li
            key={row.key}
            className={`rounded-2xl bg-card p-4 ring-1 transition ${
              ok(row.status) ? "ring-good/30" : "ring-line"
            }`}
          >
            <div className="flex items-center gap-4">
              <span
                className={`grid h-10 w-10 shrink-0 place-items-center rounded-xl ${
                  ok(row.status) ? "bg-good/10 text-good" : "bg-accent-soft text-accent"
                }`}
              >
                <Glyph name={row.glyph} />
              </span>
              <span className="flex-1">
                <span className="block font-medium">{row.title}</span>
                <span className="block text-sm text-muted">{row.why}</span>
              </span>
              {ok(row.status) ? (
                <span className="flex items-center gap-2">
                  <span className="label-mono rounded-full bg-good/10 px-3 py-1.5 text-[10px] text-good">
                    {mac ? "Allowed" : "Working"}
                  </span>
                  {(row.key === "keyboard" || row.key === "screen") && (
                    <button
                      type="button"
                      title={
                        mac
                          ? "If it stopped working, clear the grant and start over"
                          : "Test it again, for real"
                      }
                      disabled={testing}
                      onClick={() =>
                        mac
                          ? void desktop.resetPermission(row.key as "keyboard" | "screen")
                          : void runTest()
                      }
                      className="label-mono text-[10px] text-muted hover:text-foreground"
                    >
                      Not working?
                    </button>
                  )}
                </span>
              ) : (
                <button
                  type="button"
                  onClick={row.action}
                  disabled={testing}
                  className="rounded-full bg-accent px-4 py-1.5 text-sm text-accent-ink"
                >
                  {mac || row.key === "mic" ? "Allow" : "Test"}
                </button>
              )}
            </div>
            {row.drag && opened === row.key && !ok(row.status) && state?.mac && (
              <div className="mt-3 flex flex-wrap items-center gap-3 rounded-xl bg-subtle px-4 py-3 text-sm">
                <span className="text-muted">
                  In the list that opened, switch Persuna on. Not there? Drag this in:
                </span>
                <span
                  draggable
                  onDragStart={(e) => {
                    e.preventDefault();
                    desktop.dragApp();
                  }}
                  className="persuna-no-drag flex cursor-grab items-center gap-2 rounded-lg bg-card px-2.5 py-1.5 shadow-sm ring-1 ring-line-strong active:cursor-grabbing"
                >
                  {icon ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={icon} alt="" width={20} height={20} />
                  ) : (
                    <PersunaOrb look="plum" size={20} animate={false} />
                  )}
                  <span className="font-medium">Persuna</span>
                </span>
                {row.key === "screen" && (
                  <span className="w-full text-xs text-muted">
                    Switched it on? macOS needs a restart before I can see.{" "}
                    <button
                      type="button"
                      onClick={() => desktop.restart()}
                      className="text-accent underline"
                    >
                      Restart Persuna
                    </button>
                  </span>
                )}
              </div>
            )}
          </li>
        ))}
      </ul>
      {pressKey && (
        <p className="mt-3 max-w-xl rounded-xl bg-subtle px-4 py-3 text-sm font-medium">
          Now press {state?.holdKey ?? "your talk key"}.
        </p>
      )}
      {!pressKey && (tested?.keyboard.detail || tested?.screen.detail) && (
        <div className="mt-3 max-w-xl space-y-1 rounded-xl bg-subtle px-4 py-3 text-sm text-muted">
          {tested?.keyboard.detail && <p>{tested.keyboard.detail}</p>}
          {tested?.screen.detail && <p>{tested.screen.detail}</p>}
        </div>
      )}
      {!mac && (
        <p className="mt-3 max-w-xl text-xs text-muted">
          Windows keeps apps running as administrator private: I can&apos;t read them or hear the
          talk key while one is in front.
        </p>
      )}
      <Footer back={back}>
        {!needed && (
          <span className="text-xs text-muted">
            {mac ? "Microphone and Accessibility are" : "The microphone is"} needed to talk.
          </span>
        )}
        <button type="button" disabled={testing} onClick={() => void runTest()} className={quiet}>
          {testing ? "Testing…" : "Test everything"}
        </button>
        <button type="button" disabled={!needed} onClick={onDone} className={primary}>
          Continue
        </button>
      </Footer>
    </div>
  );
}

/* ---------- Microphone ---------- */

const WAVE_BARS = 36;

function MicStep({ say, setOrb, setLevel, back, onDone }: Voice & Nav) {
  const [devices, setDevices] = useState<MediaDeviceInfo[]>([]);
  const [device, setDevice] = useState<string | null>(() => preferredMic());
  const [heard, setHeard] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [wave, setWave] = useState<number[]>(() => Array(WAVE_BARS).fill(0));
  useIntro(say, "Say anything out loud, like your name or what you're working on.");

  useEffect(() => {
    let stop: (() => void) | null = null;
    let alive = true;
    // After Persuna's line, so it doesn't hear itself.
    const start = window.setTimeout(() => {
      meterMic(device, (l) => {
        if (!alive) return;
        setOrb(l > 0.02 ? "listening" : "idle");
        setLevel(l);
        setWave((w) => [...w.slice(1), l]);
        if (l > 0.12) setHeard(true);
      })
        .then(async (s) => {
          stop = s;
          if (!alive) return s();
          const all = await navigator.mediaDevices.enumerateDevices();
          setDevices(all.filter((d) => d.kind === "audioinput" && d.deviceId !== "default"));
        })
        .catch(() => setError("I can't reach a microphone. Check the Microphone permission."));
    }, 2400);
    return () => {
      alive = false;
      clearTimeout(start);
      stop?.();
      setOrb("idle");
      setLevel(0);
    };
  }, [device, setOrb, setLevel]);

  return (
    <div className="flex flex-1 flex-col">
      <div className="max-w-xl rounded-2xl bg-card p-6 ring-1 ring-line">
        <div className="flex h-24 items-center justify-center gap-[5px]" aria-hidden>
          {wave.map((l, i) => (
            <span
              key={i}
              className="w-[6px] rounded-full bg-gradient-to-t from-accent to-[#b794ff] transition-[height] duration-75"
              style={{
                height: `${Math.max(6, Math.min(96, l * 140))}px`,
                opacity: 0.35 + (i / WAVE_BARS) * 0.65,
              }}
            />
          ))}
        </div>
        <p className="mt-3 text-center text-sm" role="status">
          {error ? (
            <span className="text-danger">{error}</span>
          ) : heard ? (
            <span className="text-good">I can hear you clearly.</span>
          ) : (
            <span className="text-muted">Listening for your voice…</span>
          )}
        </p>
      </div>
      <label className="mt-5 block max-w-xl text-sm">
        <span className="text-muted">Microphone</span>
        <select
          value={device ?? ""}
          onChange={(e) => {
            const id = e.target.value || null;
            setPreferredMic(id);
            setDevice(id);
            setHeard(false);
          }}
          className={`${field} mt-1.5`}
        >
          <option value="">System default</option>
          {devices.map((d) => (
            <option key={d.deviceId} value={d.deviceId}>
              {d.label || "Microphone"}
            </option>
          ))}
        </select>
        <span className="mt-1.5 block text-xs text-faint">
          Your Mac&apos;s built-in mic or a wired headset works best.
        </span>
      </label>
      <Footer back={back}>
        <button type="button" onClick={onDone} className={primary}>
          {heard ? "Sounds good" : "Continue anyway"}
        </button>
      </Footer>
    </div>
  );
}

/* ---------- Answering by voice or typing (used by the next steps) ---------- */

/**
 * Hold the desktop's talk key (or the button) to answer out loud, or type.
 * Calls `onAnswer` with what was said or typed; `onHolding` while the key is down.
 */
function Answer({
  setOrb,
  setLevel,
  onAnswer,
  onHolding,
  placeholder = "Or type your answer",
  disabled = false,
}: {
  setOrb: (s: OrbState) => void;
  setLevel: (l: number) => void;
  onAnswer: (text: string) => void;
  onHolding?: (holding: boolean) => void;
  placeholder?: string;
  disabled?: boolean;
}) {
  const [holding, setHolding] = useState(false);
  const [working, setWorking] = useState(false);
  const [text, setText] = useState("");
  const [note, setNote] = useState<string | null>(null);
  const rec = useRef<Promise<HoldRecording | null> | null>(null);
  const input = useRef<HTMLInputElement>(null);
  const live = useRef({ disabled, onAnswer, onHolding });
  useEffect(() => {
    live.current = { disabled, onAnswer, onHolding };
  }, [disabled, onAnswer, onHolding]);

  const hold = useCallback((on: boolean) => {
    setHolding(on);
    live.current.onHolding?.(on);
  }, []);

  const start = useCallback(() => {
    if (rec.current || live.current.disabled) return;
    stopSpeaking();
    setNote(null);
    hold(true);
    setOrb("listening");
    rec.current = startHoldRecording(setLevel).catch(() => {
      setNote("I can't reach the microphone.");
      return null;
    });
  }, [setOrb, setLevel, hold]);

  const end = useCallback(async () => {
    const pending = rec.current;
    rec.current = null;
    hold(false);
    if (!pending) return;
    const heard = await (await pending)?.stop();
    if (!heard) {
      setOrb("idle");
      setNote("That was quick. Keep holding while you talk.");
      return;
    }
    setOrb("thinking");
    setWorking(true);
    try {
      const form = new FormData();
      const said = await heard.words;
      if (said) {
        live.current.onAnswer(said);
        return;
      }
      form.append("audio", await toTranscribableWav(heard.audio, "setup"));
      const res = await persunaTranscribeAction(form);
      if (!res.ok || !res.value.trim()) setNote("I didn't catch that. Try again?");
      else live.current.onAnswer(res.value.trim());
    } finally {
      setWorking(false);
      setOrb("idle");
    }
  }, [setOrb, hold]);

  useEffect(() => {
    bridge()?.onHold((phase) => {
      if (phase === "start") start();
      else if (phase === "end") void end();
      else if (phase === "cancel") {
        void rec.current?.then((r) => r?.cancel());
        rec.current = null;
        hold(false);
        setOrb("idle");
      } else input.current?.focus();
    });
  }, [start, end, setOrb, hold]);

  return (
    <div className="space-y-2">
      <form
        onSubmit={(e) => {
          e.preventDefault();
          if (text.trim() && !disabled) {
            onAnswer(text.trim());
            setText("");
          }
        }}
        className="flex max-w-xl items-center gap-2 rounded-2xl bg-card p-2 pl-4 ring-1 ring-line-strong transition focus-within:ring-accent"
      >
        <input
          ref={input}
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder={placeholder}
          aria-label="Your answer"
          disabled={disabled}
          className="min-w-0 flex-1 bg-transparent py-1.5 text-sm outline-none placeholder:text-faint focus-visible:outline-none"
        />
        <button
          type="button"
          disabled={disabled}
          onPointerDown={start}
          onPointerUp={() => void end()}
          onPointerLeave={() => holding && void end()}
          className={`flex shrink-0 items-center gap-1.5 rounded-xl px-3 py-2 text-sm transition ${
            holding ? "bg-accent text-accent-ink" : "bg-accent-soft text-accent hover:bg-accent/15"
          }`}
        >
          <Glyph name="mic" />
          {holding ? "Listening" : working ? "Hearing…" : "Hold to talk"}
        </button>
      </form>
      {note && <p className="text-sm text-warn">{note}</p>}
    </div>
  );
}

/** A big key that sinks while it's held: "right ⌥" shows ⌥, with "right" under it. */
function KeyCap({ label, down }: { label: string; down: boolean }) {
  const side = /^(right|left)\s+/i.exec(label)?.[1];
  const key = side ? label.slice(side.length).trim() : label;
  return (
    <span
      aria-hidden
      className={`inline-flex h-24 w-24 shrink-0 flex-col items-center justify-center rounded-2xl bg-gradient-to-b from-white to-[#f1ecf6] ring-1 transition-all duration-100 ${
        down
          ? "translate-y-[3px] text-accent shadow-[0_1px_0_#d6cce0,0_0_0_6px_rgba(139,92,246,0.15)] ring-accent/50"
          : "shadow-[0_5px_0_#d6cce0,0_12px_24px_-12px_rgba(40,20,60,0.4)] ring-line-strong"
      }`}
    >
      <span className="font-display text-4xl leading-none">{key}</span>
      {side && <span className="label-mono mt-2 text-[9px] text-muted">{side}</span>}
    </span>
  );
}

/* ---------- Talking ---------- */

function TalkStep({
  say,
  setOrb,
  setLevel,
  userName,
  back,
  onDone,
}: Voice & Nav & { userName: string }) {
  const [holdKey, setHoldKey] = useState<string | null>(null);
  const [heard, setHeard] = useState<string | null>(null);
  const [down, setDown] = useState(false);
  useEffect(() => {
    const plain = "Hold the button, say hello, then let go.";
    const desktop = bridge();
    if (!desktop) return void say(plain);
    void desktop.permissions().then((s) => {
      setHoldKey(s.holdKey);
      void say(s.holdKey ? `Hold ${s.holdKey}, say hello, then let go.` : plain);
    });
    // Once, on entering the step.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="flex flex-1 flex-col">
      {holdKey && (
        <div className="flex max-w-xl items-center gap-6 rounded-2xl bg-card p-6 ring-1 ring-line">
          <KeyCap label={holdKey} down={down} />
          <div className="text-sm">
            <p className="font-medium">
              Hold <span className="text-accent">{holdKey}</span>
            </p>
            <p className="mt-1 text-muted">
              Talk while it&apos;s down, let go when you&apos;re done. Works in every app. Tap it
              twice to type instead.
            </p>
          </div>
        </div>
      )}
      <div className="mt-5">
        <Answer
          setOrb={setOrb}
          setLevel={setLevel}
          onHolding={setDown}
          placeholder="Or type hello"
          onAnswer={(text) => {
            setHeard(text.replace(/[.!?…。！？\s]+$/, ""));
            const first = userName.split(/\s+/)[0];
            void say(`${first ? `Hi ${first}! ` : "Hi! "}That's all there is to it.`);
          }}
        />
      </div>
      {heard && (
        <blockquote className="persuna-in mt-4 max-w-xl rounded-2xl bg-accent-soft/60 px-5 py-4 text-[15px]">
          <span className="label-mono block text-[10px] text-accent">I heard</span>“{heard}”
        </blockquote>
      )}
      <Footer back={back}>
        {!heard && (
          <button type="button" onClick={onDone} className={quiet}>
            Skip
          </button>
        )}
        <button type="button" disabled={!heard} onClick={onDone} className={primary}>
          Continue
        </button>
      </Footer>
    </div>
  );
}

/* ---------- Name and look ---------- */

function MeetStep({
  say,
  name,
  look,
  onName,
  onLook,
  back,
  onDone,
}: {
  say: Say;
  name: string;
  look: LookId;
  onName: (n: string) => void;
  onLook: (l: LookId) => void;
} & Nav) {
  const [draft, setDraft] = useState(name);
  useIntro(say, "What should I be called? And how should I look?");
  return (
    <div className="flex flex-1 flex-col">
      <label className="block max-w-xl">
        <span className="text-sm text-muted">My name</span>
        <input
          value={draft}
          onChange={(e) => {
            setDraft(e.target.value);
            onName(e.target.value.trim() || "Persuna");
          }}
          maxLength={40}
          aria-label="My name"
          className="mt-1 w-full border-0 border-b-2 border-line-strong bg-transparent pb-2 font-display text-3xl font-medium tracking-[-0.02em] outline-none transition focus:border-accent focus-visible:outline-none"
        />
      </label>
      <div className="mt-7 grid max-w-xl grid-cols-3 gap-3" role="radiogroup" aria-label="Look">
        {LOOK_IDS.map((id) => (
          <button
            key={id}
            type="button"
            role="radio"
            aria-checked={look === id}
            aria-label={`${LOOKS[id].label} look`}
            onClick={() => onLook(id)}
            className={`flex flex-col items-center gap-2 rounded-2xl bg-card p-4 ring-1 transition ${
              look === id
                ? "shadow-[0_10px_24px_-14px_rgba(106,47,141,0.6)] ring-2 ring-accent"
                : "ring-line hover:ring-line-strong"
            }`}
          >
            <PersunaOrb look={id} size={56} animate={look === id} />
            <span className="text-sm">{LOOKS[id].label}</span>
          </button>
        ))}
      </div>
      <Footer back={back}>
        <button
          type="button"
          onClick={() => {
            onName(parseName(draft) ?? (draft.trim() || "Persuna"));
            onDone();
          }}
          className={primary}
        >
          Continue
        </button>
      </Footer>
    </div>
  );
}

/* ---------- Four questions ---------- */

function AboutStep({
  say,
  setOrb,
  setLevel,
  back,
  onDone,
}: Voice & { back: (() => void) | null; onDone: (answers: IntroAnswers) => void }) {
  const [index, setIndex] = useState(0);
  const [answers, setAnswers] = useState<IntroAnswers>({});
  const [saving, setSaving] = useState(false);
  useIntro(say, INTRO_QUESTIONS[0].ask);

  async function answer(text: string) {
    const q = INTRO_QUESTIONS[index];
    const all = { ...answers, [q.key]: text };
    setAnswers(all);
    if (index + 1 < INTRO_QUESTIONS.length) {
      setIndex(index + 1);
      void say(`${INTRO_ACKS[index % INTRO_ACKS.length]} ${INTRO_QUESTIONS[index + 1].ask}`);
      return;
    }
    setSaving(true);
    const res = await persunaIntroAction(all);
    setSaving(false);
    if (!res.ok) return void say(`Hmm, I couldn't save that: ${res.error}`);
    onDone(all);
  }

  const q = INTRO_QUESTIONS[index];
  return (
    <div className="flex flex-1 flex-col">
      <div className="flex max-w-xl gap-1.5" aria-hidden>
        {INTRO_QUESTIONS.map((x, i) => (
          <span
            key={x.key}
            className={`h-1 flex-1 rounded-full ${i <= index ? "bg-accent" : "bg-line"}`}
          />
        ))}
      </div>
      <p className="label-mono mt-5 text-[10px] text-muted">
        Question {index + 1} of {INTRO_QUESTIONS.length}
      </p>
      <p className="mt-1.5 max-w-xl font-display text-2xl font-medium leading-snug tracking-[-0.02em]">
        {q.ask.replace(/^(First|Last one)(, |: )/, "").replace(/^\w/, (c) => c.toUpperCase())}
      </p>
      <div className="mt-5">
        <Answer
          key={index}
          setOrb={setOrb}
          setLevel={setLevel}
          disabled={saving}
          onAnswer={(text) => void answer(text)}
        />
      </div>
      {INTRO_QUESTIONS.slice(0, index).some((x) => answers[x.key]) && (
        <ul className="mt-6 max-w-xl space-y-2" aria-label="Your answers so far">
          {INTRO_QUESTIONS.slice(0, index).map((x) =>
            answers[x.key] ? (
              <li key={x.key} className="flex gap-3 text-sm">
                <span className="mt-0.5 text-good">✓</span>
                <span className="text-muted">{answers[x.key]}</span>
              </li>
            ) : null,
          )}
        </ul>
      )}
      <Footer back={back}>
        <button type="button" disabled={saving} onClick={() => void answer("")} className={quiet}>
          Skip this one
        </button>
      </Footer>
    </div>
  );
}

/* ---------- First skill ---------- */

function FirstSkillStep({
  say,
  name,
  look,
  skills,
  timeSink,
  back,
  onDone,
}: {
  say: Say;
  name: string;
  look: LookId;
  skills: { slug: string; name: string }[];
  timeSink: string | undefined;
} & Nav) {
  const suggestion = suggestedSkill(timeSink);
  // The list to pick from: their answer first, then the common ones, plus any they add.
  const [options, setOptions] = useState<string[]>(() => [
    ...new Set([...(suggestion ? [suggestion] : []), ...COMMON_SKILLS.map((s) => s.name)]),
  ]);
  const [picked, setPicked] = useState<string[]>(suggestion ? [suggestion] : []);
  const [custom, setCustom] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useIntro(
    say,
    suggestion
      ? `You said ${suggestion.toLowerCase()} takes the most time. Pick everything you'd like me to learn.`
      : "Which tasks would you like me to learn to do your way? Pick as many as you like.",
  );

  async function finish(task: Parameters<typeof persunaSetupAction>[0]["task"]) {
    setSaving(true);
    setError(null);
    const res = await persunaSetupAction({ name, avatar: look, task });
    setSaving(false);
    if (!res.ok) return setError(res.error);
    onDone();
  }
  const toggle = (option: string) =>
    setPicked((now) =>
      now.includes(option)
        ? now.filter((p) => p !== option)
        : now.length >= MAX_FIRST_SKILLS
          ? now
          : [...now, option],
    );
  function addCustom() {
    const value = custom.trim();
    if (value.length < 3) return;
    setOptions((all) => (all.includes(value) ? all : [value, ...all]));
    setPicked((now) =>
      now.includes(value) || now.length >= MAX_FIRST_SKILLS ? now : [...now, value],
    );
    setCustom("");
  }

  return (
    <div className="flex flex-1 flex-col">
      <div className="max-w-2xl space-y-4">
        <div className="flex flex-wrap gap-2" role="group" aria-label="Tasks to learn">
          {options.map((option) => {
            const on = picked.includes(option);
            return (
              <button
                key={option}
                type="button"
                aria-pressed={on}
                onClick={() => toggle(option)}
                className={`rounded-full px-3.5 py-1.5 text-sm ring-1 transition-colors ${
                  on
                    ? "bg-accent text-accent-ink ring-accent"
                    : "bg-card ring-line hover:ring-accent/50"
                }`}
              >
                {on ? "✓ " : ""}
                {option}
              </button>
            );
          })}
        </div>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            addCustom();
          }}
          className="flex max-w-md gap-2"
        >
          <input
            value={custom}
            onChange={(e) => setCustom(e.target.value)}
            placeholder="Add your own, e.g. podcast show notes"
            maxLength={120}
            aria-label="Add your own task"
            className={field}
          />
          <button type="submit" disabled={custom.trim().length < 3} className={quiet}>
            Add
          </button>
        </form>
        <p className="text-xs text-muted">
          {picked.length
            ? `${picked.length} picked. We'll start with ${picked[0]}; the rest wait in your skills.`
            : "Pick one or more."}
        </p>
      </div>
      {skills.length > 0 && (
        <>
          <p className="mt-6 text-sm text-muted">Or carry on with one you have:</p>
          <div className="mt-2 flex max-w-xl flex-wrap gap-2">
            {skills.map((s) => (
              <button
                key={s.slug}
                type="button"
                disabled={saving}
                onClick={() => void finish({ kind: "existing", slug: s.slug })}
                className="rounded-full bg-card px-3.5 py-1.5 text-sm ring-1 ring-line hover:ring-accent/50"
              >
                {s.name}
              </button>
            ))}
          </div>
        </>
      )}
      {error && <p className="mt-3 text-sm text-danger">{error}</p>}
      <Footer back={back}>
        <button
          type="button"
          disabled={saving}
          onClick={() => void finish({ kind: "sample" })}
          className={quiet}
        >
          Try the sample
        </button>
        <button
          type="button"
          disabled={saving}
          onClick={() => void finish({ kind: "skip" })}
          className={quiet}
        >
          Later
        </button>
        <button
          type="button"
          disabled={saving || picked.length === 0}
          onClick={() =>
            void finish({
              kind: "many",
              skills: picked.map((p) => ({ name: p, description: describeSkill(p) })),
            })
          }
          className={primary}
        >
          {saving
            ? "Setting them up…"
            : picked.length > 1
              ? `Learn these ${picked.length}`
              : "Learn this one"}
        </button>
      </Footer>
    </div>
  );
}

/* ---------- Ready ---------- */

function ReadyStep({ say, name }: { say: Say; name: string }) {
  const [openAtLogin, setOpenAtLogin] = useState(true);
  const [holdKey, setHoldKey] = useState<string | null>(null);
  const router = useRouter();
  const desktop = useBridge();
  useIntro(say, `That's everything. I'm ${name}, and I'll be right at the top of your screen.`);
  useEffect(() => {
    void desktop?.permissions().then((s) => setHoldKey(s.holdKey));
  }, [desktop]);
  const tips = [
    ["Talk", `Hold ${holdKey ?? "the talk key"}, from any app.`],
    ["Type", `Tap ${holdKey ?? "it"} twice, or click me.`],
    ["Show me", "Ask about what's on screen: “what's this?”, “reply to this”."],
    ["Teach me", "Say “teach me”, or “watch my screen” while you work."],
  ];
  return (
    <div className="flex flex-1 flex-col">
      <ul className="grid max-w-xl grid-cols-2 gap-3">
        {tips.map(([title, body]) => (
          <li key={title} className="rounded-2xl bg-card p-4 ring-1 ring-line">
            <span className="block font-medium">{title}</span>
            <span className="mt-0.5 block text-sm text-muted">{body}</span>
          </li>
        ))}
      </ul>
      {desktop && (
        <label className="mt-6 flex max-w-xl cursor-pointer items-center justify-between rounded-2xl bg-card p-4 ring-1 ring-line">
          <span>
            <span className="block font-medium">Open when I log in</span>
            <span className="block text-sm text-muted">
              So I&apos;m there whenever you need me.
            </span>
          </span>
          <input
            type="checkbox"
            role="switch"
            checked={openAtLogin}
            onChange={(e) => setOpenAtLogin(e.target.checked)}
            className="sr-only"
          />
          <span
            aria-hidden
            className={`relative h-6 w-11 rounded-full transition ${
              openAtLogin ? "bg-accent" : "bg-line-strong"
            }`}
          >
            <span
              className={`absolute top-0.5 h-5 w-5 rounded-full bg-white shadow transition-all ${
                openAtLogin ? "left-[22px]" : "left-0.5"
              }`}
            />
          </span>
        </label>
      )}
      <Footer>
        <button
          type="button"
          onClick={() => {
            stopSpeaking();
            if (desktop) desktop.finish({ openAtLogin });
            else router.push("/persuna");
          }}
          className={primary}
        >
          Start using {name}
        </button>
      </Footer>
    </div>
  );
}
