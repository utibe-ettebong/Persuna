"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import {
  disconnectAppAction,
  personaClearChatAction,
  personaForgetAction,
  personaProfileAction,
  personaTeachNoteAction,
  personaToneAction,
} from "@/app/actions/persona";
import type { Tone } from "@/lib/persona/tone";
import { buttonClass, inputClass } from "@/components/ui";
import { LookPicker } from "./look-picker";

/** Name, look and today's focus. Saves as you change them. */
export function PersonaProfileForm({
  name,
  avatar,
  focus,
}: {
  name: string;
  avatar: string;
  focus: string | null;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [draftName, setDraftName] = useState(name);

  const save = (input: Parameters<typeof personaProfileAction>[0]) =>
    start(async () => {
      const res = await personaProfileAction(input);
      setError(res.ok ? null : res.error);
      if (res.ok) router.refresh();
    });

  return (
    <div className="space-y-5">
      <form
        className="flex items-end gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          save({ name: draftName });
        }}
      >
        <label className="block flex-1 text-sm">
          <span className="font-medium">Name</span>
          <input
            value={draftName}
            onChange={(e) => setDraftName(e.target.value)}
            maxLength={40}
            className={inputClass}
          />
        </label>
        <button
          type="submit"
          disabled={pending || draftName.trim() === name}
          className={buttonClass("secondary")}
        >
          Save
        </button>
      </form>
      <LookPicker value={avatar} onChange={(look) => save({ avatar: look })} />
      <div className="text-sm">
        <p className="font-medium">Today&apos;s focus</p>
        <p className="mt-1 text-muted">
          {focus ?? "Not set. Tell your Persuna what you're working on."}
          {focus && (
            <button
              type="button"
              onClick={() => save({ focus: null })}
              className="label-mono ml-3 text-danger"
            >
              Clear
            </button>
          )}
        </p>
      </div>
      {error && (
        <p role="alert" className="text-sm text-danger">
          {error}
        </p>
      )}
    </div>
  );
}

export function ForgetButton({ index }: { index: number }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  return (
    <button
      type="button"
      disabled={pending}
      onClick={() =>
        start(async () => {
          await personaForgetAction(index);
          router.refresh();
        })
      }
      className="label-mono shrink-0 text-muted hover:text-danger"
    >
      Forget
    </button>
  );
}

export function ClearChatButton() {
  const [pending, start] = useTransition();
  const [done, setDone] = useState(false);
  return (
    <button
      type="button"
      disabled={pending || done}
      onClick={() =>
        start(async () => {
          if (!confirm("Clear your whole conversation with your Persuna? Notes and memory stay."))
            return;
          const res = await personaClearChatAction();
          if (res.ok) {
            setDone(true);
            window.location.reload();
          }
        })
      }
      className={buttonClass("danger")}
    >
      {done ? "Cleared" : "Clear conversation"}
    </button>
  );
}

/** Sends a note's steps to the focus skill as a proposal (or interview notes). */
export function TeachNoteButton({ noteId, skillName }: { noteId: string; skillName: string }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  return (
    <span className="inline-flex flex-col items-start">
      <button
        type="button"
        disabled={pending}
        onClick={() =>
          start(async () => {
            const res = await personaTeachNoteAction(noteId);
            if (res.ok) router.push(res.value.href);
            else setError(res.error);
          })
        }
        className="label-mono text-accent hover:underline"
      >
        {pending ? "Teaching…" : `Teach to ${skillName}`}
      </button>
      {error && (
        <span role="alert" className="text-xs text-danger">
          {error}
        </span>
      )}
    </span>
  );
}

const pill = (on: boolean) =>
  `rounded-full px-3 py-1.5 text-sm transition-colors ${
    on ? "bg-accent text-accent-ink" : "bg-subtle text-muted hover:text-foreground"
  }`;

/** How Persona talks to you. Unset choices follow what it notices in how you write. */
export function ToneForm({ tone, instruction }: { tone: Tone; instruction: string }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const save = (next: Tone) =>
    start(async () => {
      await personaToneAction({ ...next, notes: next.notes ?? [] });
      router.refresh();
    });
  const choice = <K extends "length" | "formality">(
    key: K,
    options: { value: NonNullable<Tone[K]>; label: string }[],
  ) => (
    <div className="flex flex-wrap gap-1.5">
      <button
        type="button"
        disabled={pending}
        onClick={() => save({ ...tone, [key]: undefined })}
        className={pill(tone[key] === undefined)}
      >
        Notice for me
      </button>
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          disabled={pending}
          onClick={() => save({ ...tone, [key]: o.value })}
          className={pill(tone[key] === o.value)}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
  return (
    <div className="space-y-4 text-sm">
      <div className="space-y-1.5">
        <p className="font-medium">Length</p>
        {choice("length", [
          { value: "short", label: "Short" },
          { value: "normal", label: "Normal" },
          { value: "detailed", label: "Detailed" },
        ])}
      </div>
      <div className="space-y-1.5">
        <p className="font-medium">Manner</p>
        {choice("formality", [
          { value: "casual", label: "Casual" },
          { value: "neutral", label: "Neutral" },
          { value: "formal", label: "Formal" },
        ])}
      </div>
      <div className="space-y-1.5">
        <p className="font-medium">Humour</p>
        <div className="flex flex-wrap gap-1.5">
          {[
            { value: undefined, label: "Notice for me" },
            { value: true, label: "Playful" },
            { value: false, label: "Serious" },
          ].map((o) => (
            <button
              key={String(o.value)}
              type="button"
              disabled={pending}
              onClick={() => save({ ...tone, playful: o.value })}
              className={pill(tone.playful === o.value)}
            >
              {o.label}
            </button>
          ))}
        </div>
      </div>
      {(tone.notes?.length ?? 0) > 0 && (
        <ul className="space-y-1">
          {tone.notes!.map((n) => (
            <li key={n} className="flex items-center gap-3">
              <span className="flex-1">&ldquo;{n}&rdquo;</span>
              <button
                type="button"
                onClick={() => save({ ...tone, notes: tone.notes!.filter((x) => x !== n) })}
                className="label-mono text-muted hover:text-danger"
              >
                Forget
              </button>
            </li>
          ))}
        </ul>
      )}
      <p className="rounded-2xl bg-accent-soft px-4 py-3 text-muted">
        <span className="label-mono block text-accent">Right now</span>
        {instruction}
      </p>
    </div>
  );
}

export function DisconnectAppButton({ provider, name }: { provider: string; name: string }) {
  const [pending, start] = useTransition();
  const router = useRouter();
  return (
    <button
      type="button"
      disabled={pending}
      onClick={() =>
        start(async () => {
          if (
            !confirm(`Disconnect ${name}? Persuna won't be able to use it until you connect again.`)
          )
            return;
          const res = await disconnectAppAction(provider);
          if (res.ok) router.refresh();
        })
      }
      className="label-mono text-muted underline hover:text-danger disabled:opacity-50"
    >
      {pending ? "Disconnecting…" : "Disconnect"}
    </button>
  );
}
