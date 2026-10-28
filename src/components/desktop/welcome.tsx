"use client";

import { useState } from "react";
import { AuthForm } from "@/components/auth-form";
import { PersonaOrb } from "@/components/persona/orb";

const POINTS = [
  ["Talks with you", "Tap me and just talk. I answer out loud."],
  ["Learns your work", "Teach me a task once; I'll draft it your way."],
  ["Only watches when you say", "Nothing is recorded unless you turn watching on."],
];

/**
 * Persuna Desktop's first screen: a hello, then sign in or create an
 * account, in one small window. Getting to know each other (name, look,
 * first task) then happens out loud on the desktop.
 */
export function DesktopWelcome() {
  const [step, setStep] = useState<"hello" | "sign-in" | "sign-up">("hello");
  return (
    <main className="persona-backdrop flex min-h-screen flex-col px-7 pb-7 pt-10 text-foreground">
      <div className="persona-drag flex flex-col items-center text-center">
        <PersonaOrb look="plum" size={step === "hello" ? 132 : 84} />
        <h1 className="mt-4 font-display text-3xl font-medium tracking-[-0.03em]">
          {step === "hello"
            ? "Hi, I'm Persuna"
            : step === "sign-up"
              ? "Let's get you set up"
              : "Welcome back"}
        </h1>
        <p className="mt-2 max-w-xs text-sm text-muted">
          {step === "hello"
            ? "Your assistant, right on your desktop."
            : "Then I'll pop up on your screen and we'll get to know each other."}
        </p>
      </div>

      {step === "hello" ? (
        <>
          <ul className="mx-auto mt-8 w-full max-w-xs space-y-4">
            {POINTS.map(([title, body]) => (
              <li key={title} className="flex gap-3">
                <span aria-hidden className="mt-1.5 h-2 w-2 shrink-0 rounded-full bg-accent" />
                <span>
                  <span className="block text-sm font-medium">{title}</span>
                  <span className="block text-sm text-muted">{body}</span>
                </span>
              </li>
            ))}
          </ul>
          <div className="persona-no-drag mx-auto mt-auto flex w-full max-w-xs flex-col gap-2 pt-8">
            <button
              type="button"
              onClick={() => setStep("sign-up")}
              className="rounded-full bg-accent px-5 py-3 text-sm text-accent-ink"
            >
              Get started
            </button>
            <button
              type="button"
              onClick={() => setStep("sign-in")}
              className="rounded-full px-5 py-3 text-sm text-muted hover:text-foreground"
            >
              I already have an account
            </button>
          </div>
        </>
      ) : (
        <div className="persona-no-drag mx-auto mt-6 w-full max-w-xs">
          <AuthForm
            key={step}
            mode={step}
            next="/companion?overlay=1"
            onSwitchMode={() => setStep(step === "sign-in" ? "sign-up" : "sign-in")}
          />
          <button
            type="button"
            onClick={() => setStep("hello")}
            className="mt-4 w-full text-center text-sm text-muted hover:text-foreground"
          >
            Back
          </button>
        </div>
      )}
    </main>
  );
}
