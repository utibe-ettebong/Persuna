"use client";

import { useActionState } from "react";
import { probeModelAction } from "@/app/actions/admin";
import { buttonClass } from "../ui";

/** Tests a model id against live settings and shows the verdict inline. Saves nothing. */
export function ProbeForm({ role, model }: { role: string; model: string }) {
  const [state, formAction, pending] = useActionState(probeModelAction, {
    error: null,
    result: null,
  });
  return (
    <form action={formAction} className="inline" aria-busy={pending}>
      <input type="hidden" name="role" value={role} />
      <input type="hidden" name="model" value={model} />
      <button type="submit" disabled={pending} className={buttonClass("secondary")}>
        {pending ? "Testing…" : "Test"}
      </button>{" "}
      {state.result && (
        <span role="status" className="text-xs text-good">
          {state.result}
        </span>
      )}
      {state.error && (
        <span role="alert" className="text-xs text-danger">
          {state.error}
        </span>
      )}
    </form>
  );
}
