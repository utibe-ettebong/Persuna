"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import {
  personaClearChatAction,
  personaForgetAction,
  personaProfileAction,
  personaTeachNoteAction,
} from "@/app/actions/persona";
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
          {focus ?? "Not set. Tell Persona what you're working on."}
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
          if (!confirm("Clear your whole conversation with Persona? Notes and memory stay."))
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
