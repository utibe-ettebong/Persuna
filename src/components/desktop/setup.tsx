"use client";

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";
import {
  personaIntroAction,
  personaSetupAction,
  personaTranscribeAction,
} from "@/app/actions/persona";
import { AuthForm } from "@/components/auth-form";
import { PersonaOrb, type OrbState } from "@/components/persona/orb";
import {
  meterMic,
  preferredMic,
  setPreferredMic,
  speak,
  startHoldRecording,
  stopSpeaking,
  type HoldRecording,
} from "@/components/persona/voice";
import { toTranscribableWav } from "@/lib/audio/convert";
import { LOOKS, LOOK_IDS, lookOf, type LookId } from "@/lib/persona/looks";
import {
  INTRO_ACKS,
  INTRO_QUESTIONS,
  parseName,
  suggestedSkill,
  type IntroAnswers,
} from "@/lib/persona/onboarding";

type Access = "granted" | "denied" | "not-determined" | "restricted" | "unknown";

/** What Persona Desktop's setup window can ask the app (desktop/setup-preload.js). */
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
  dragApp(): void;
  appIcon(): Promise<string | null>;
  restart(): void;
  signInWithBrowser(): void;
  finish(options: { openAtLogin: boolean }): void;
  onHold(handler: (phase: "start" | "end" | "cancel" | "type") => void): void;
}

const bridge = (): SetupBridge | null =>
  typeof window === "undefined"
    ? null
    : ((window as Window & { personaSetup?: SetupBridge }).personaSetup ?? null);

const noSubscribe = () => () => {};
/** The bridge, for rendering: absent on the server, so the first paint matches. */
const useBridge = () => useSyncExternalStore(noSubscribe, bridge, () => null);

type Step = "account" | "access" | "mic" | "talk" | "meet" | "about" | "first" | "ready";

const STEP_TITLES: Record<Step, string> = {
  account: "Your account",
  access: "Permissions",
  mic: "Your microphone",
  talk: "Talking to me",
  meet: "My name",
  about: "About you",
  first: "First skill",
  ready: "Ready",
};

export interface DesktopSetupProps {
  user: { name: string } | null;
  persona: { name: string; avatar: string; setupDone: boolean } | null;
  skills: { slug: string; name: string }[];
  signInExpired: boolean;
}

/**
 * Persona Desktop's setup, in its own window. A returning user who has met
 * Persuna before only checks permissions and the mic.
 */
export function DesktopSetup(props: DesktopSetupProps) {
  const met = props.persona?.setupDone ?? false;
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

  // Shared by the steps: who Persuna is, and its voice.
  const [name, setName] = useState(props.persona?.name ?? "Persuna");
  const [look, setLook] = useState<LookId>(lookOf(props.persona?.avatar ?? "plum"));
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

  return (
    <main className="persona-backdrop flex min-h-screen flex-col px-8 pb-8 pt-9 text-foreground">
      {/* Where you are, in words: no dots to count. */}
      <header className="persona-drag flex items-center gap-3">
        <span className="label-mono text-[10px] text-muted">
          {at + 1} / {steps.length} · {STEP_TITLES[step]}
        </span>
        <span className="h-px flex-1 bg-line">
          <span
            className="block h-px bg-accent transition-[width] duration-500"
            style={{ width: `${((at + 1) / steps.length) * 100}%` }}
          />
        </span>
        {back && (
          <button
            type="button"
            onClick={back}
            className="label-mono text-[10px] text-muted hover:text-foreground"
          >
            Back
          </button>
        )}
      </header>

      <div className="mt-8 flex items-start gap-4">
        <div className="shrink-0">
          <PersonaOrb look={look} state={orb} level={level} size={72} />
        </div>
        <p className="min-h-[3.5rem] pt-3 font-display text-xl font-medium leading-snug tracking-[-0.02em]">
          {line ?? ""}
        </p>
      </div>

      <section className="mt-6 flex flex-1 flex-col">
        {step === "account" && <AccountStep expired={props.signInExpired} say={say} />}
        {step === "access" && <AccessStep say={say} onDone={next} />}
        {step === "mic" && <MicStep say={say} setOrb={setOrb} setLevel={setLevel} onDone={next} />}
        {step === "talk" && (
          <TalkStep
            say={say}
            setOrb={setOrb}
            setLevel={setLevel}
            userName={props.user?.name ?? ""}
            onDone={next}
          />
        )}
        {step === "meet" && (
          <MeetStep
            say={say}
            name={name}
            look={look}
            onName={setName}
            onLook={setLook}
            onDone={next}
          />
        )}
        {step === "about" && (
          <AboutStep
            say={say}
            setOrb={setOrb}
            setLevel={setLevel}
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
            onDone={next}
          />
        )}
        {step === "ready" && <ReadyStep say={say} name={name} />}
      </section>
    </main>
  );
}

type Say = (text: string) => Promise<void>;
const primary = "rounded-full bg-accent px-5 py-2.5 text-sm text-accent-ink disabled:opacity-40";
const quiet = "rounded-full px-4 py-2.5 text-sm text-muted hover:text-foreground";

/** Runs once when a step opens: Persuna says its line. */
function useIntro(say: Say, text: string) {
  useEffect(() => {
    void say(text);
    // Only on entering the step.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
}

/* ---------- 1. Account ---------- */

function AccountStep({ expired, say }: { expired: boolean; say: Say }) {
  const [mode, setMode] = useState<"choose" | "waiting" | "sign-in" | "sign-up">("choose");
  const desktop = useBridge();
  useIntro(
    say,
    expired
      ? "That sign-in link ran out. Let's try once more."
      : "Hi, I'm Persuna. Let's get you signed in first.",
  );
  if (mode === "sign-in" || mode === "sign-up") {
    return (
      <div className="persona-no-drag w-full max-w-sm">
        <AuthForm
          key={mode}
          mode={mode}
          next="/desktop/setup"
          onSwitchMode={() => setMode(mode === "sign-in" ? "sign-up" : "sign-in")}
        />
        <button type="button" onClick={() => setMode("choose")} className={`${quiet} mt-3 px-0`}>
          Back
        </button>
      </div>
    );
  }
  return (
    <div className="flex max-w-sm flex-col gap-2">
      {mode === "waiting" ? (
        <p className="text-sm text-muted">
          Finish signing in in your browser. I&apos;ll carry on here as soon as you do.
        </p>
      ) : (
        <p className="text-sm text-muted">
          Your browser is quickest if you&apos;re already signed in to PERSUNA there.
        </p>
      )}
      {desktop && (
        <button
          type="button"
          onClick={() => {
            desktop.signInWithBrowser();
            setMode("waiting");
          }}
          className={`${primary} mt-2`}
        >
          {mode === "waiting" ? "Open the browser again" : "Continue in your browser"}
        </button>
      )}
      <button type="button" onClick={() => setMode("sign-in")} className={quiet}>
        Sign in here instead
      </button>
      <button type="button" onClick={() => setMode("sign-up")} className={quiet}>
        New to PERSUNA? Create an account
      </button>
    </div>
  );
}

/* ---------- 2. Permissions ---------- */

function AccessStep({ say, onDone }: { say: Say; onDone: () => void }) {
  const desktop = useBridge();
  const [state, setState] = useState<Awaited<ReturnType<SetupBridge["permissions"]>> | null>(null);
  const [icon, setIcon] = useState<string | null>(null);
  const [screenTried, setScreenTried] = useState(false);
  useIntro(say, "I need three things from your Mac. Each one has a reason.");

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
      <p className="max-w-sm text-sm text-muted">
        Open this from Persona Desktop to set permissions. In a browser, Persuna asks for the
        microphone when you first talk.
        <button type="button" onClick={onDone} className={`${primary} mt-4 block`}>
          Continue
        </button>
      </p>
    );
  }
  const ok = (a?: Access) => a === "granted";
  const rows = [
    {
      key: "mic",
      title: "Microphone",
      why: "So I can hear you while you hold the talk key. Never otherwise.",
      status: state?.mic,
      action: () => void desktop.askMic(),
      drag: false,
    },
    {
      key: "keyboard",
      title: "Accessibility",
      why: "So I notice the talk key from any app. I only react to that key.",
      status: state?.keyboard,
      action: () => void desktop.askKeyboard(),
      drag: true,
    },
    {
      key: "screen",
      title: "Screen Recording",
      why: "So I can watch when you ask me to and learn how you work. Optional.",
      status: state?.screen,
      action: () => {
        setScreenTried(true);
        void desktop.askScreen();
      },
      drag: true,
    },
  ] as const;
  const needed = ok(state?.mic) && (ok(state?.keyboard) || !state?.mac);

  return (
    <div className="flex flex-col gap-3">
      <ul className="divide-y divide-line rounded-2xl bg-card/80 ring-1 ring-line">
        {rows.map((row) => (
          <li key={row.key} className="flex items-start gap-3 p-4">
            <span
              aria-hidden
              className={`mt-1 grid h-5 w-5 shrink-0 place-items-center rounded-full text-[11px] ${
                ok(row.status) ? "bg-good text-white" : "ring-1 ring-line-strong"
              }`}
            >
              {ok(row.status) ? "✓" : ""}
            </span>
            <span className="flex-1">
              <span className="block text-sm font-medium">{row.title}</span>
              <span className="block text-sm text-muted">{row.why}</span>
              {row.drag && !ok(row.status) && state?.mac && (
                <span className="mt-2 flex items-center gap-2 text-xs text-muted">
                  Not in the list? Drag me in:
                  <span
                    draggable
                    onDragStart={(e) => {
                      e.preventDefault();
                      desktop.dragApp();
                    }}
                    className="persona-no-drag flex cursor-grab items-center gap-1.5 rounded-lg bg-card px-2 py-1 ring-1 ring-line-strong active:cursor-grabbing"
                  >
                    {icon ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={icon} alt="" width={18} height={18} />
                    ) : (
                      <PersonaOrb look="plum" size={18} animate={false} />
                    )}
                    <span className="text-foreground">Persuna</span>
                  </span>
                </span>
              )}
              {row.key === "screen" && screenTried && !ok(row.status) && state?.mac && (
                <span className="mt-2 block text-xs text-muted">
                  Turned it on? macOS needs Persuna to restart before it can see.{" "}
                  <button
                    type="button"
                    onClick={() => desktop.restart()}
                    className="text-accent underline"
                  >
                    Restart now
                  </button>
                </span>
              )}
            </span>
            {!ok(row.status) && (
              <button
                type="button"
                onClick={row.action}
                className="label-mono shrink-0 rounded-full px-3 py-1.5 text-[10px] text-accent ring-1 ring-accent/40 hover:bg-accent-soft"
              >
                Allow
              </button>
            )}
          </li>
        ))}
      </ul>
      <div className="mt-auto flex items-center gap-2 pt-4">
        <button type="button" disabled={!needed} onClick={onDone} className={primary}>
          Continue
        </button>
        {!needed && (
          <span className="text-xs text-muted">
            Microphone and Accessibility are needed to talk.
          </span>
        )}
      </div>
    </div>
  );
}

/* ---------- 3. Microphone ---------- */

function MicStep({
  say,
  setOrb,
  setLevel,
  onDone,
}: {
  say: Say;
  setOrb: (s: OrbState) => void;
  setLevel: (l: number) => void;
  onDone: () => void;
}) {
  const [devices, setDevices] = useState<MediaDeviceInfo[]>([]);
  const [device, setDevice] = useState<string | null>(preferredMic());
  const [heard, setHeard] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useIntro(say, "Say anything out loud. If I light up, I can hear you.");

  useEffect(() => {
    let stop: (() => void) | null = null;
    let alive = true;
    // Wait for Persuna to finish its line, so it doesn't hear itself.
    const start = window.setTimeout(() => {
      meterMic(device, (l) => {
        if (!alive) return;
        setOrb(l > 0.02 ? "listening" : "idle");
        setLevel(l);
        if (l > 0.12) setHeard(true);
      })
        .then(async (s) => {
          stop = s;
          if (!alive) return s();
          const all = await navigator.mediaDevices.enumerateDevices();
          setDevices(all.filter((d) => d.kind === "audioinput" && d.deviceId !== "default"));
        })
        .catch(() => setError("I can't reach a microphone. Check the Microphone permission."));
    }, 2600);
    return () => {
      alive = false;
      clearTimeout(start);
      stop?.();
      setOrb("idle");
      setLevel(0);
    };
  }, [device, setOrb, setLevel]);

  return (
    <div className="flex flex-1 flex-col gap-4">
      <label className="block max-w-sm text-sm">
        <span className="label-mono text-[10px] text-muted">Microphone</span>
        <select
          value={device ?? ""}
          onChange={(e) => {
            const id = e.target.value || null;
            setPreferredMic(id);
            setDevice(id);
            setHeard(false);
          }}
          className="mt-1.5 w-full rounded-md border border-line-strong bg-card px-3 py-2 text-sm"
        >
          <option value="">System default</option>
          {devices.map((d) => (
            <option key={d.deviceId} value={d.deviceId}>
              {d.label || "Microphone"}
            </option>
          ))}
        </select>
      </label>
      <p className="text-sm text-muted">
        {error ?? (heard ? "Heard you clearly." : "Waiting to hear you…")} Your Mac&apos;s built-in
        mic or a wired one works best.
      </p>
      <div className="mt-auto flex gap-2">
        <button type="button" onClick={onDone} className={primary}>
          {heard ? "Sounds good" : "Continue anyway"}
        </button>
      </div>
    </div>
  );
}

/* ---------- Answering by voice or by typing (used by the next steps) ---------- */

/**
 * Hold the desktop's talk key (or the button here) to answer out loud, or
 * type. Calls `onAnswer` with what was said or typed.
 */
function Answer({
  setOrb,
  setLevel,
  onAnswer,
  placeholder = "Or type here",
  disabled = false,
}: {
  setOrb: (s: OrbState) => void;
  setLevel: (l: number) => void;
  onAnswer: (text: string) => void;
  placeholder?: string;
  disabled?: boolean;
}) {
  const [holding, setHolding] = useState(false);
  const [working, setWorking] = useState(false);
  const [text, setText] = useState("");
  const [note, setNote] = useState<string | null>(null);
  const rec = useRef<Promise<HoldRecording | null> | null>(null);
  const input = useRef<HTMLInputElement>(null);
  const live = useRef({ disabled, onAnswer });
  useEffect(() => {
    live.current = { disabled, onAnswer };
  }, [disabled, onAnswer]);

  const start = useCallback(() => {
    if (rec.current || live.current.disabled) return;
    stopSpeaking();
    setNote(null);
    setHolding(true);
    setOrb("listening");
    rec.current = startHoldRecording(setLevel).catch(() => {
      setNote("I can't reach the microphone.");
      return null;
    });
  }, [setOrb, setLevel]);

  const end = useCallback(async () => {
    const pending = rec.current;
    rec.current = null;
    setHolding(false);
    if (!pending) return;
    const audio = await (await pending)?.stop();
    if (!audio) {
      setOrb("idle");
      setNote("That was quick. Hold a little longer while you talk.");
      return;
    }
    setOrb("thinking");
    setWorking(true);
    try {
      const form = new FormData();
      form.append("audio", await toTranscribableWav(audio, "setup"));
      const res = await personaTranscribeAction(form);
      if (!res.ok || !res.value.trim()) setNote("I didn't catch that. Try again?");
      else live.current.onAnswer(res.value.trim());
    } finally {
      setWorking(false);
      setOrb("idle");
    }
  }, [setOrb]);

  useEffect(() => {
    bridge()?.onHold((phase) => {
      if (phase === "start") start();
      else if (phase === "end") void end();
      else if (phase === "cancel") {
        void rec.current?.then((r) => r?.cancel());
        rec.current = null;
        setHolding(false);
        setOrb("idle");
      } else input.current?.focus();
    });
  }, [start, end, setOrb]);

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
        className="flex max-w-md items-center gap-2 rounded-full bg-card p-1.5 pl-4 ring-1 ring-line-strong focus-within:ring-accent"
      >
        <input
          ref={input}
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder={placeholder}
          aria-label="Your answer"
          disabled={disabled}
          className="min-w-0 flex-1 bg-transparent text-sm outline-none placeholder:text-faint focus-visible:outline-none"
        />
        <button
          type="button"
          disabled={disabled}
          onPointerDown={start}
          onPointerUp={() => void end()}
          onPointerLeave={() => holding && void end()}
          className={`label-mono shrink-0 rounded-full px-3 py-2 text-[10px] ${
            holding ? "bg-accent text-accent-ink" : "text-accent ring-1 ring-accent/40"
          }`}
        >
          {holding ? "Listening" : working ? "Hearing…" : "Hold to talk"}
        </button>
      </form>
      {note && <p className="text-xs text-warn">{note}</p>}
    </div>
  );
}

/* ---------- 4. Talking to Persuna ---------- */

function TalkStep({
  say,
  setOrb,
  setLevel,
  userName,
  onDone,
}: {
  say: Say;
  setOrb: (s: OrbState) => void;
  setLevel: (l: number) => void;
  userName: string;
  onDone: () => void;
}) {
  const [holdKey, setHoldKey] = useState<string | null>(null);
  const [heard, setHeard] = useState<string | null>(null);
  useEffect(() => {
    const plain = "Here's how we talk. Hold the button below, say hello, then let go.";
    const desktop = bridge();
    if (!desktop) return void say(plain);
    void desktop.permissions().then((s) => {
      setHoldKey(s.holdKey);
      void say(
        s.holdKey ? `Here's how we talk. Hold ${s.holdKey}, say hello, then let go.` : plain,
      );
    });
    // Once, on entering the step.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="flex flex-1 flex-col gap-4">
      <p className="max-w-md text-sm text-muted">
        {holdKey ? (
          <>
            Hold{" "}
            <kbd className="label-mono rounded border border-line-strong px-1.5">{holdKey}</kbd>{" "}
            from any app while you talk, and let go when you&apos;re done. Tap it twice quickly to
            type instead.
          </>
        ) : (
          "Hold to talk, and let go when you're done."
        )}
      </p>
      <Answer
        setOrb={setOrb}
        setLevel={setLevel}
        onAnswer={(text) => {
          setHeard(text);
          const first = userName.split(/\s+/)[0];
          // Quote it without its own full stop, so the line doesn't end "..”."
          text = text.replace(/[.!?…\s]+$/, "");
          void say(
            `${first ? `Hi ${first}! ` : "Hi! "}I heard “${text.length > 80 ? `${text.slice(0, 80)}…` : text}”. That's all there is to it.`,
          );
        }}
      />
      <div className="mt-auto flex gap-2">
        <button type="button" disabled={!heard} onClick={onDone} className={primary}>
          Continue
        </button>
        {!heard && (
          <button type="button" onClick={onDone} className={quiet}>
            Skip
          </button>
        )}
      </div>
    </div>
  );
}

/* ---------- 5. Persuna's name and look ---------- */

function MeetStep({
  say,
  name,
  look,
  onName,
  onLook,
  onDone,
}: {
  say: Say;
  name: string;
  look: LookId;
  onName: (n: string) => void;
  onLook: (l: LookId) => void;
  onDone: () => void;
}) {
  const [draft, setDraft] = useState(name);
  useIntro(say, "What should I be called? And pick how I look.");
  return (
    <div className="flex flex-1 flex-col gap-5">
      <label className="block max-w-sm text-sm">
        <span className="label-mono text-[10px] text-muted">Name</span>
        <input
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={() => onName(parseName(draft) ?? (draft.trim() || "Persuna"))}
          maxLength={40}
          className="mt-1.5 w-full rounded-md border border-line-strong bg-card px-3 py-2 text-sm"
        />
      </label>
      <div className="flex flex-wrap gap-2" role="radiogroup" aria-label="Look">
        {LOOK_IDS.map((id) => (
          <button
            key={id}
            type="button"
            role="radio"
            aria-checked={look === id}
            onClick={() => onLook(id)}
            className={`flex flex-col items-center gap-1 rounded-2xl p-2 ${
              look === id ? "bg-accent-soft ring-1 ring-accent/40" : "hover:bg-card"
            }`}
          >
            <PersonaOrb look={id} size={44} animate={false} />
            <span className="label-mono text-[10px] text-muted">{LOOKS[id].label}</span>
          </button>
        ))}
      </div>
      <div className="mt-auto">
        <button
          type="button"
          onClick={() => {
            const picked = parseName(draft) ?? (draft.trim() || "Persuna");
            onName(picked);
            onDone();
          }}
          className={primary}
        >
          Continue
        </button>
      </div>
    </div>
  );
}

/* ---------- 6. Four questions about you ---------- */

function AboutStep({
  say,
  setOrb,
  setLevel,
  onDone,
}: {
  say: Say;
  setOrb: (s: OrbState) => void;
  setLevel: (l: number) => void;
  onDone: (answers: IntroAnswers) => void;
}) {
  const [index, setIndex] = useState(0);
  const [answers, setAnswers] = useState<IntroAnswers>({});
  const [saving, setSaving] = useState(false);
  useIntro(say, `A few questions so I'm useful from day one. ${INTRO_QUESTIONS[0].ask}`);

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
    const res = await personaIntroAction(all);
    setSaving(false);
    if (!res.ok) return void say(`Hmm, I couldn't save that: ${res.error}`);
    onDone(all);
  }

  return (
    <div className="flex flex-1 flex-col gap-4">
      <ol className="space-y-2 text-sm">
        {INTRO_QUESTIONS.map((q, i) => (
          <li key={q.key} className={i === index ? "text-foreground" : "text-muted"}>
            <span className="label-mono mr-2 text-[10px]">{i + 1}</span>
            {answers[q.key] ? (
              <span>
                {q.ask} <span className="text-foreground">— {answers[q.key]}</span>
              </span>
            ) : (
              q.ask
            )}
          </li>
        ))}
      </ol>
      <Answer
        key={index}
        setOrb={setOrb}
        setLevel={setLevel}
        disabled={saving}
        onAnswer={(text) => void answer(text)}
      />
      <div className="mt-auto">
        <button type="button" disabled={saving} onClick={() => void answer("")} className={quiet}>
          Skip this one
        </button>
      </div>
    </div>
  );
}

/* ---------- 7. A first skill ---------- */

function FirstSkillStep({
  say,
  name,
  look,
  skills,
  timeSink,
  onDone,
}: {
  say: Say;
  name: string;
  look: LookId;
  skills: { slug: string; name: string }[];
  timeSink: string | undefined;
  onDone: () => void;
}) {
  const suggestion = suggestedSkill(timeSink);
  const [skillName, setSkillName] = useState(suggestion ?? "");
  const [description, setDescription] = useState(timeSink?.trim() ?? "");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useIntro(
    say,
    suggestion
      ? `You said ${suggestion.toLowerCase()} takes the most time. Want me to learn it?`
      : "What's one task you'd like me to learn to do your way?",
  );

  async function finish(task: Parameters<typeof personaSetupAction>[0]["task"]) {
    setSaving(true);
    setError(null);
    const res = await personaSetupAction({ name, avatar: look, task });
    setSaving(false);
    if (!res.ok) return setError(res.error);
    onDone();
  }

  return (
    <div className="flex flex-1 flex-col gap-4">
      <div className="max-w-md space-y-3 rounded-2xl bg-card/80 p-4 ring-1 ring-line">
        <label className="block text-sm">
          <span className="label-mono text-[10px] text-muted">The task</span>
          <input
            value={skillName}
            onChange={(e) => setSkillName(e.target.value)}
            placeholder="For example: Meeting notes into minutes"
            maxLength={120}
            className="mt-1.5 w-full rounded-md border border-line-strong bg-card px-3 py-2 text-sm"
          />
        </label>
        <label className="block text-sm">
          <span className="label-mono text-[10px] text-muted">
            What goes in, and what comes out
          </span>
          <textarea
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            rows={3}
            maxLength={1000}
            className="mt-1.5 w-full rounded-md border border-line-strong bg-card px-3 py-2 text-sm"
          />
        </label>
        <button
          type="button"
          disabled={saving || skillName.trim().length < 3 || description.trim().length < 10}
          onClick={() =>
            void finish({ kind: "new", name: skillName.trim(), description: description.trim() })
          }
          className={primary}
        >
          {saving ? "Setting it up…" : "Learn this one"}
        </button>
      </div>
      <div className="flex flex-wrap gap-2">
        {skills.map((s) => (
          <button
            key={s.slug}
            type="button"
            disabled={saving}
            onClick={() => void finish({ kind: "existing", slug: s.slug })}
            className="label-mono rounded-full px-3 py-1.5 text-[10px] text-muted ring-1 ring-line-strong hover:text-accent"
          >
            {s.name}
          </button>
        ))}
        <button
          type="button"
          disabled={saving}
          onClick={() => void finish({ kind: "sample" })}
          className="label-mono rounded-full px-3 py-1.5 text-[10px] text-muted ring-1 ring-line-strong hover:text-accent"
        >
          Try the meeting-minutes sample
        </button>
        <button
          type="button"
          disabled={saving}
          onClick={() => void finish({ kind: "skip" })}
          className="label-mono rounded-full px-3 py-1.5 text-[10px] text-muted hover:text-foreground"
        >
          Later
        </button>
      </div>
      {error && <p className="text-sm text-danger">{error}</p>}
    </div>
  );
}

/* ---------- 8. Ready ---------- */

function ReadyStep({ say, name }: { say: Say; name: string }) {
  const [openAtLogin, setOpenAtLogin] = useState(true);
  const [holdKey, setHoldKey] = useState<string | null>(null);
  const router = useRouter();
  const desktop = useBridge();
  useIntro(say, `All set. I'm ${name}, and I'll be at the top of your screen.`);
  useEffect(() => {
    void desktop?.permissions().then((s) => setHoldKey(s.holdKey));
  }, [desktop]);
  return (
    <div className="flex flex-1 flex-col gap-4">
      <ul className="max-w-md space-y-2 text-sm">
        <li>
          <strong>Talk:</strong> hold {holdKey ?? "the talk key"} from any app.
        </li>
        <li>
          <strong>Type:</strong> tap {holdKey ?? "it"} twice, or click me.
        </li>
        <li>
          <strong>Teach me:</strong> say &ldquo;teach me&rdquo;, or &ldquo;watch my screen&rdquo;
          while you work.
        </li>
      </ul>
      {desktop && (
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={openAtLogin}
            onChange={(e) => setOpenAtLogin(e.target.checked)}
          />
          Open Persuna when I log in
        </label>
      )}
      <div className="mt-auto">
        <button
          type="button"
          onClick={() => {
            stopSpeaking();
            if (desktop) desktop.finish({ openAtLogin });
            else router.push("/persona");
          }}
          className={primary}
        >
          Start
        </button>
      </div>
    </div>
  );
}
