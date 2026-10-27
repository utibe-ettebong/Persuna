"use client";

import { useActionState } from "react";
import type { ActionState } from "@/lib/action-state";
import { buttonClass, type Variant } from "./ui";

export interface FormButton {
  label: string;
  /** Sent as the form's `intent` field when this button submits. */
  intent?: string;
  variant?: Variant;
}

interface ActionFormProps {
  action: (state: ActionState, form: FormData) => Promise<ActionState>;
  label?: string;
  pendingLabel: string;
  variant?: Variant;
  /** Several submit buttons, each sending its own `intent`. Overrides label/variant. */
  buttons?: FormButton[];
  className?: string;
  children?: React.ReactNode;
}

/** A form bound to a server action, with a pending state and inline errors. */
export function ActionForm({
  action,
  label,
  pendingLabel,
  variant = "primary",
  buttons,
  className,
  children,
}: ActionFormProps) {
  const [state, formAction, pending] = useActionState(action, { error: null });
  const list: FormButton[] = buttons ?? [{ label: label ?? "Save", variant }];

  return (
    <form action={formAction} className={className} aria-busy={pending}>
      {children}
      <div className="flex flex-wrap items-center gap-2">
        {list.map((b) => (
          <button
            key={b.intent ?? b.label}
            type="submit"
            name={b.intent ? "intent" : undefined}
            value={b.intent}
            disabled={pending}
            className={buttonClass(b.variant)}
          >
            {pending && list.length === 1 ? pendingLabel : b.label}
          </button>
        ))}
        {pending && list.length > 1 && (
          <span className="text-sm text-muted" role="status">
            {pendingLabel}
          </span>
        )}
      </div>
      {state.error && (
        <p role="alert" className="mt-2 text-sm text-danger">
          {state.error}
        </p>
      )}
    </form>
  );
}
