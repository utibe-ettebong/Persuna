"use client";

import { useState } from "react";
import { personaSetupAction } from "@/app/actions/persona";
import { DEFAULT_LOOK, type LookId } from "@/lib/persona/looks";
import type { CompanionMessage } from "./companion";
import { LookPicker } from "./look-picker";

type Task = Parameters<typeof personaSetupAction>[0]["task"];

const field =
  "mt-1 w-full rounded-2xl bg-background/70 px-4 py-2.5 text-sm outline-none ring-1 ring-line focus:ring-2 focus:ring-accent";
const primary = "rounded-full bg-accent px-5 py-2 text-sm text-accent-ink disabled:opacity-60";

/**
 * The first meeting: Persona introduces itself, asks what to be called and
 * how to look, then which task to learn first.
 */
export function SetupCard({
  skills,
  onDone,
}: {
  skills: { slug: string; name: string }[];
  onDone: (result: { name: string; avatar: string; message: CompanionMessage }) => void;
}) {
  const [step, setStep] = useState<1 | 2>(1);
  const [name, setName] = useState("");
  const [look, setLook] = useState<LookId>(DEFAULT_LOOK);
  const [choice, setChoice] = useState<string>(skills[0]?.slug ?? "sample");
  const [taskName, setTaskName] = useState("");
  const [description, setDescription] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const called = name.trim() || "Persona";

  async function finish(task: Task) {
    setPending(true);
    setError(null);
    const res = await personaSetupAction({ name: called, avatar: look, task });
    setPending(false);
    if (!res.ok) return setError(res.error);
    onDone({
      name: called,
      avatar: look,
      message: {
        ...res.value.message,
        role: "assistant",
        link: res.value.href ? { href: res.value.href, label: "Open the skill" } : null,
      },
    });
  }

  const option = (value: string, label: string) => (
    <label
      key={value}
      className={`flex cursor-pointer items-center gap-3 rounded-2xl px-4 py-2.5 transition-colors ${
        choice === value ? "bg-accent-soft text-foreground" : "hover:bg-subtle"
      }`}
    >
      <input
        type="radio"
        name="first-task"
        checked={choice === value}
        onChange={() => setChoice(value)}
        className="accent-[var(--accent)]"
      />
      {label}
    </label>
  );

  return (
    <div className="space-y-4 p-5 text-sm" aria-label="Set up your Persona">
      {step === 1 ? (
        <>
          <p className="font-display text-lg leading-snug">
            Hi! I&apos;m your new assistant. I&apos;ll keep notes, remind you of things, learn how
            you work and, once you&apos;ve trained me, do some of it for you.
          </p>
          <label className="block">
            <span className="text-muted">What would you like to call me?</span>
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              maxLength={40}
              placeholder="Persona"
              className={field}
              autoFocus
            />
          </label>
          <LookPicker value={look} onChange={setLook} legend="And how should I look?" />
          <button type="button" onClick={() => setStep(2)} className={primary}>
            Next
          </button>
        </>
      ) : (
        <>
          <p className="font-display text-lg leading-snug">
            Lovely, I&apos;m {called}. What should I learn first?
          </p>
          <div className="space-y-1">
            {skills.map((s) => option(s.slug, s.name))}
            {option("new", "Something new")}
            {choice === "new" && (
              <div className="space-y-2 px-2 pb-1">
                <input
                  value={taskName}
                  onChange={(e) => setTaskName(e.target.value)}
                  placeholder="Task name, e.g. Weekly client report"
                  aria-label="Task name"
                  className={field}
                />
                <textarea
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  rows={2}
                  placeholder="What goes in and what comes out?"
                  aria-label="Task description"
                  className={field}
                />
              </div>
            )}
            {option("sample", "Try the sample: meeting notes into minutes")}
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              disabled={pending}
              onClick={() =>
                void finish(
                  choice === "sample"
                    ? { kind: "sample" }
                    : choice === "new"
                      ? { kind: "new", name: taskName, description }
                      : { kind: "existing", slug: choice },
                )
              }
              className={primary}
            >
              {pending ? "Setting up…" : "Let's start"}
            </button>
            <button
              type="button"
              onClick={() => setStep(1)}
              className="rounded-full px-3 py-2 text-muted hover:text-foreground"
            >
              Back
            </button>
            <button
              type="button"
              disabled={pending}
              onClick={() => void finish({ kind: "skip" })}
              className="ml-auto rounded-full px-3 py-2 text-muted hover:text-foreground"
            >
              Later
            </button>
          </div>
        </>
      )}
      {error && (
        <p role="alert" className="text-danger">
          {error}
        </p>
      )}
    </div>
  );
}
