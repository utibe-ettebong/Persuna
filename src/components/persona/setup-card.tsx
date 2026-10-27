"use client";

import { useState } from "react";
import { personaSetupAction } from "@/app/actions/persona";
import type { CompanionMessage } from "./companion";

const AVATARS = ["🦉", "🤖", "🦊", "🐙", "🌱", "✨", "🐝", "🪴"] as const;
type Avatar = (typeof AVATARS)[number];
type Task = Parameters<typeof personaSetupAction>[0]["task"];

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
  const [avatar, setAvatar] = useState<Avatar>("🦉");
  const [choice, setChoice] = useState<string>(skills[0]?.slug ?? "sample");
  const [taskName, setTaskName] = useState("");
  const [description, setDescription] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function finish(task: Task) {
    setPending(true);
    setError(null);
    const finalName = name.trim() || "Persona";
    const res = await personaSetupAction({ name: finalName, avatar, task });
    setPending(false);
    if (!res.ok) return setError(res.error);
    onDone({
      name: finalName,
      avatar,
      message: {
        ...res.value.message,
        role: "assistant",
        link: res.value.href ? { href: res.value.href, label: "Open the skill" } : null,
      },
    });
  }

  const field =
    "mt-1 w-full rounded-md border border-line bg-background px-3 py-2 text-sm outline-none focus:border-accent";

  return (
    <div className="space-y-4 px-4 py-4 text-sm" aria-label="Set up your Persona">
      {step === 1 ? (
        <>
          <p className="rounded-lg bg-subtle px-3 py-2">
            Hi! I&apos;m your new assistant. I&apos;ll keep notes, remind you of things, learn how
            you work and, once you&apos;ve trained me, do some of it for you. What would you like to
            call me?
          </p>
          <label className="block">
            <span className="font-medium">My name</span>
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              maxLength={40}
              placeholder="Persona"
              className={field}
              autoFocus
            />
          </label>
          <fieldset>
            <legend className="font-medium">How should I look?</legend>
            <div className="mt-2 flex flex-wrap gap-2">
              {AVATARS.map((a) => (
                <button
                  key={a}
                  type="button"
                  onClick={() => setAvatar(a)}
                  aria-pressed={a === avatar}
                  aria-label={`Look like ${a}`}
                  className={`grid h-10 w-10 place-items-center rounded-full border-2 text-xl ${
                    a === avatar ? "border-accent bg-accent-soft" : "border-line"
                  }`}
                >
                  {a}
                </button>
              ))}
            </div>
          </fieldset>
          <button
            type="button"
            onClick={() => setStep(2)}
            className="label-mono rounded-md bg-accent px-3 py-2 text-accent-ink"
          >
            Next
          </button>
        </>
      ) : (
        <>
          <p className="rounded-lg bg-subtle px-3 py-2">
            <span aria-hidden>{avatar}</span> Great, I&apos;m {name.trim() || "Persona"}. What
            should I learn first?
          </p>
          <div className="space-y-2">
            {skills.map((s) => (
              <label key={s.slug} className="flex items-center gap-2">
                <input
                  type="radio"
                  name="first-task"
                  checked={choice === s.slug}
                  onChange={() => setChoice(s.slug)}
                />
                {s.name}
              </label>
            ))}
            <label className="flex items-center gap-2">
              <input
                type="radio"
                name="first-task"
                checked={choice === "new"}
                onChange={() => setChoice("new")}
              />
              Something new
            </label>
            {choice === "new" && (
              <div className="space-y-2 pl-6">
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
            <label className="flex items-center gap-2">
              <input
                type="radio"
                name="first-task"
                checked={choice === "sample"}
                onChange={() => setChoice("sample")}
              />
              Try the sample: meeting notes into minutes
            </label>
          </div>
          <div className="flex flex-wrap items-center gap-3">
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
              className="label-mono rounded-md bg-accent px-3 py-2 text-accent-ink disabled:opacity-60"
            >
              {pending ? "Setting up…" : "Let's start"}
            </button>
            <button type="button" onClick={() => setStep(1)} className="label-mono text-muted">
              Back
            </button>
            <button
              type="button"
              disabled={pending}
              onClick={() => void finish({ kind: "skip" })}
              className="label-mono ml-auto text-muted"
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
