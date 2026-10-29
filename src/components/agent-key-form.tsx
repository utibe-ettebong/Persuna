"use client";

import { useActionState, useState } from "react";
import { createAgentKeyAction, type KeyState } from "@/app/actions/agents";
import { buttonClass, Field, inputClass } from "./ui";

/** Creates an agent key and shows the token once, with a copy button. */
export function AgentKeyForm() {
  const [state, action, pending] = useActionState<KeyState, FormData>(createAgentKeyAction, {
    error: null,
    token: null,
    agentName: null,
  });
  const [copied, setCopied] = useState(false);

  return (
    <div className="space-y-3">
      <form action={action} className="flex flex-wrap items-end gap-2" aria-busy={pending}>
        <div className="min-w-48 flex-1">
          <Field label="Agent name" hint="e.g. Grokbot, Musebot, Dot">
            <input name="agentName" required minLength={2} maxLength={60} className={inputClass} />
          </Field>
        </div>
        <button type="submit" disabled={pending} className={buttonClass("primary")}>
          {pending ? "Creating…" : "Create key"}
        </button>
      </form>
      {state.error && (
        <p role="alert" className="text-sm text-danger">
          {state.error}
        </p>
      )}
      {state.token && (
        <div className="rounded-md border border-good/40 bg-good/8 p-3 text-sm" role="status">
          <p className="font-medium">
            Key for {state.agentName}. Copy it now: it won&apos;t be shown again.
          </p>
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <code className="min-w-0 flex-1 break-all rounded bg-card p-2 text-xs">
              {state.token}
            </code>
            <button
              type="button"
              className={buttonClass("secondary")}
              onClick={async () => {
                await navigator.clipboard.writeText(state.token!).catch(() => {});
                setCopied(true);
              }}
            >
              {copied ? "Copied" : "Copy"}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
