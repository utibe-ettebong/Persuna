"use client";

import { matchWakeWord } from "@/lib/persona/wake";

/**
 * Listens for "Hey <name>" with the browser's speech recognition. Opt-in:
 * in Chrome and Edge the audio goes to the browser maker's speech service, so
 * the companion says so before turning it on. Restarts itself when the
 * browser ends a session, until stopped.
 */
type Recognition = {
  continuous: boolean;
  interimResults: boolean;
  lang: string;
  onresult:
    | ((e: {
        resultIndex: number;
        results: ArrayLike<ArrayLike<{ transcript: string }> & { isFinal: boolean }>;
      }) => void)
    | null;
  onerror: ((e: { error: string }) => void) | null;
  onend: (() => void) | null;
  start(): void;
  stop(): void;
};

function recognitionClass(): (new () => Recognition) | null {
  if (typeof window === "undefined") return null;
  const w = window as unknown as {
    SpeechRecognition?: new () => Recognition;
    webkitSpeechRecognition?: new () => Recognition;
  };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
}

/** Electron has the API but no speech service behind it. */
export function wakeWordSupported(): boolean {
  return Boolean(recognitionClass()) && !/Electron/.test(navigator.userAgent);
}

export interface WakeListener {
  stop(): void;
  /** Stop hearing for a while (Persona is talking or in a conversation). */
  pause(paused: boolean): void;
}

export function startWakeWord(handlers: {
  name: () => string;
  onWake: (rest: string) => void;
  onError: (message: string) => void;
}): WakeListener {
  const Recognition = recognitionClass();
  if (!Recognition) throw new Error("This browser can't listen for a wake word.");
  let stopped = false;
  let paused = false;
  let running = false;
  let lastWake = 0;
  let rec: Recognition | null = null;

  const begin = () => {
    if (stopped || paused || running) return;
    rec = new Recognition();
    rec.continuous = true;
    rec.interimResults = true;
    rec.lang = "en-US";
    rec.onresult = (e) => {
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const result = e.results[i];
        const heard = matchWakeWord(result[0].transcript, handlers.name());
        // Wait for the final result to catch a command said in the same breath.
        if (heard && result.isFinal && Date.now() - lastWake > 2500) {
          lastWake = Date.now();
          handlers.onWake(heard.rest);
        }
      }
    };
    rec.onerror = (e) => {
      if (e.error === "not-allowed" || e.error === "service-not-allowed") {
        stopped = true;
        handlers.onError("Microphone access for the wake word was blocked.");
      } else if (e.error === "network") {
        stopped = true;
        handlers.onError("The browser's speech service isn't reachable, so the wake word is off.");
      }
    };
    rec.onend = () => {
      running = false;
      if (!stopped && !paused) setTimeout(begin, 400);
    };
    try {
      rec.start();
      running = true;
    } catch {
      running = false;
    }
  };
  begin();

  return {
    stop() {
      stopped = true;
      rec?.stop();
    },
    pause(next) {
      if (next === paused) return;
      paused = next;
      if (paused) rec?.stop();
      else begin();
    },
  };
}
