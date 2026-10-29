"use client";

import { useActionState, useState } from "react";
import { askAction, inviteAction, type AskState, type InviteFormState } from "@/app/actions/teams";
import { buttonClass, Field, inputClass } from "./ui";

/** Invites someone by email to a role, and shows the link once for the admin to send. */
export function InviteForm({
  orgId,
  roles,
}: {
  orgId: string;
  roles: { id: string; title: string }[];
}) {
  const [state, action, pending] = useActionState<InviteFormState, FormData>(inviteAction, {
    error: null,
    path: null,
    email: null,
  });
  const [copied, setCopied] = useState(false);
  // The link only appears after the form runs in the browser, so window is there.
  const link = state.path ? `${window.location.origin}${state.path}` : null;

  return (
    <div className="space-y-3">
      <form action={action} className="space-y-3" aria-busy={pending}>
        <input type="hidden" name="orgId" value={orgId} />
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Email">
            <input name="email" type="email" required className={inputClass} />
          </Field>
          <Field label="Role">
            <select name="roleId" className={inputClass} defaultValue={roles[0]?.id ?? ""}>
              <option value="">No role yet</option>
              {roles.map((r) => (
                <option key={r.id} value={r.id}>
                  {r.title}
                </option>
              ))}
            </select>
          </Field>
        </div>
        <label className="flex items-start gap-2 text-sm">
          <input type="checkbox" name="onboard" defaultChecked className="mt-1" />
          <span>
            New hire: start their onboarding for this role when they join
            <span className="block text-xs text-muted">
              Needs the role&apos;s playbook to be published.
            </span>
          </span>
        </label>
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" name="admin" />
          <span>Make them an admin</span>
        </label>
        <button type="submit" disabled={pending} className={buttonClass("primary")}>
          {pending ? "Creating…" : "Create invitation"}
        </button>
      </form>
      {state.error && (
        <p role="alert" className="text-sm text-danger">
          {state.error}
        </p>
      )}
      {link && (
        <div className="rounded-md border border-good/40 bg-good/8 p-3 text-sm" role="status">
          <p className="font-medium">
            Send this link to {state.email}. It works for 14 days, only when they sign in with that
            email, and it won&apos;t be shown again.
          </p>
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <code className="min-w-0 flex-1 break-all rounded bg-card p-2 text-xs">{link}</code>
            <button
              type="button"
              className={buttonClass("secondary")}
              onClick={async () => {
                await navigator.clipboard.writeText(link).catch(() => {});
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

/** The recruit's questions, answered by Persuna from the playbook and handbook only. */
export function AskBox({ onboardingId }: { onboardingId: string }) {
  const [state, action, pending] = useActionState<AskState, FormData>(askAction, {
    error: null,
    question: null,
    answer: null,
    known: false,
    from: [],
  });
  return (
    <div className="space-y-3">
      <form action={action} className="flex flex-wrap items-end gap-2" aria-busy={pending}>
        <input type="hidden" name="onboardingId" value={onboardingId} />
        <div className="min-w-48 flex-1">
          <Field label="Ask Persuna" hint="answers come from the playbook and handbook">
            <input
              name="question"
              required
              minLength={3}
              maxLength={1000}
              placeholder="How do we hand designs over to engineering?"
              className={inputClass}
            />
          </Field>
        </div>
        <button type="submit" disabled={pending} className={buttonClass("primary")}>
          {pending ? "Looking…" : "Ask"}
        </button>
      </form>
      {state.error && (
        <p role="alert" className="text-sm text-danger">
          {state.error}
        </p>
      )}
      {state.answer && (
        <div
          className={`rounded-md border p-3 text-sm ${state.known ? "border-line bg-card" : "border-warn/40 bg-warn/8"}`}
          role="status"
        >
          <p className="text-xs text-muted">You asked: {state.question}</p>
          <p className="mt-1 whitespace-pre-wrap leading-relaxed">{state.answer}</p>
          {state.from.length > 0 && (
            <p className="mt-2 text-xs text-muted">From: {state.from.join(", ")}</p>
          )}
        </div>
      )}
    </div>
  );
}
