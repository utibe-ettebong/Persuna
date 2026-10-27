"use client";

import { useActionState } from "react";
import { testModelsAction, type ModelCheckState } from "@/app/actions/skills";
import { Badge, buttonClass } from "./ui";

const NAMES: Record<string, string> = {
  extract: "Learn",
  draft: "Draft",
  evaluate: "Score",
  vision: "Sees images",
  transcribe: "Transcribe",
};

/** Sends each live role a one-line request so you can see the keys work. */
export function ModelCheck() {
  const [state, action, pending] = useActionState<ModelCheckState>(testModelsAction, {
    error: null,
  });
  return (
    <form action={action} className="space-y-4" aria-busy={pending}>
      <button type="submit" disabled={pending} className={buttonClass("primary")}>
        {pending ? "Calling each model…" : "Test models"}
      </button>
      {state.error && (
        <p role="alert" className="text-sm text-danger">
          {state.error}
        </p>
      )}
      {state.results && (
        <ul className="divide-y divide-line rounded-md border border-line bg-card text-sm">
          {state.results.map((r) => (
            <li key={r.role} className="flex flex-wrap items-start gap-3 p-3">
              <span className="w-24 font-medium">{NAMES[r.role] ?? r.role}</span>
              {r.ok ? <Badge tone="good">Working</Badge> : <Badge tone="danger">Problem</Badge>}
              {r.ms > 0 && (
                <span className="label-mono text-faint">{(r.ms / 1000).toFixed(1)}s</span>
              )}
              <span className="min-w-0 flex-1 break-words text-muted">{r.detail}</span>
            </li>
          ))}
        </ul>
      )}
    </form>
  );
}
