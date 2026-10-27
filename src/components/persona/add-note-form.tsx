"use client";

import { useActionState, useEffect, useRef } from "react";
import { buttonClass, inputClass } from "@/components/ui";

type State = { error: string | null };

export function AddNoteForm({
  action,
}: {
  action: (state: State, form: FormData) => Promise<State>;
}) {
  const [state, submit, pending] = useActionState(action, { error: null });
  const form = useRef<HTMLFormElement>(null);
  const submitted = useRef(false);
  useEffect(() => {
    if (submitted.current && !pending && !state.error) form.current?.reset();
  }, [pending, state]);

  return (
    <form
      ref={form}
      action={(data) => {
        submitted.current = true;
        submit(data);
      }}
      className="space-y-3"
    >
      <input name="title" placeholder="Title" maxLength={100} className={inputClass} required />
      <textarea
        name="body"
        rows={3}
        placeholder="Write a note…"
        maxLength={4000}
        className={inputClass}
        required
      />
      <div className="flex items-center gap-3">
        <button type="submit" disabled={pending} className={buttonClass("secondary")}>
          {pending ? "Saving…" : "Add note"}
        </button>
        {state.error && (
          <p role="alert" className="text-sm text-danger">
            {state.error}
          </p>
        )}
      </div>
    </form>
  );
}
