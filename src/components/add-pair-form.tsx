"use client";

import { useActionState } from "react";
import { addPairAction, type PairFormState } from "@/app/actions/skills";
import type { Finding } from "@/lib/skill/redact";
import { buttonClass, Field, inputClass } from "./ui";

const KIND_LABEL = {
  email: "Email",
  phone: "Phone number",
  account: "Account or ID number",
  url: "Link",
  address: "Street address",
  person: "Person",
  organisation: "Organisation",
  place: "Place",
} as const;

export function AddPairForm({
  skillSlug,
  inputType,
  outputType,
}: {
  skillSlug: string;
  inputType: string;
  outputType: string;
}) {
  const [state, formAction, pending] = useActionState<PairFormState, FormData>(addPairAction, {
    error: null,
  });
  const review = state.review;

  if (review) {
    // One row per distinct identifier, however many times it appears.
    const unique = new Map<string, { kind: Finding["kind"]; match: string; count: number }>();
    for (const f of [...review.inputFindings, ...review.outputFindings]) {
      const key = `${f.kind}:${f.match.toLowerCase()}`;
      const seen = unique.get(key);
      if (seen) seen.count++;
      else unique.set(key, { kind: f.kind, match: f.match, count: 1 });
    }
    const findings = [...unique.values()];
    return (
      <form action={formAction} className="space-y-4" aria-busy={pending}>
        <input type="hidden" name="skillSlug" value={skillSlug} />
        <input type="hidden" name="name" value={review.slug} />
        <input type="hidden" name="split" value={review.split} />
        <input type="hidden" name="input" value={review.input} />
        <input type="hidden" name="output" value={review.output} />
        <input type="hidden" name="redactedInput" value={review.redactedInput} />
        <input type="hidden" name="redactedOutput" value={review.redactedOutput} />

        <div className="rounded-md border border-warn/40 bg-warn/10 p-4 text-sm">
          <p className="font-medium text-warn">
            Found {findings.length} possible identifier{findings.length === 1 ? "" : "s"} in “
            {review.slug}”
          </p>
          <ul className="mt-2 space-y-1">
            {findings.map((f, i) => (
              <li key={i}>
                <span className="text-muted">{KIND_LABEL[f.kind]}:</span>{" "}
                <code className="rounded bg-subtle px-1">{f.match}</code>
                {f.count > 1 && <span className="text-muted"> ×{f.count}</span>}
              </li>
            ))}
          </ul>
          <p className="mt-3 text-muted">
            The repository and the skill keep only your method, so replace these unless they are
            invented. Names are found by the model, so check the preview for any it missed before
            saving.
          </p>
        </div>

        <div className="grid gap-4 lg:grid-cols-2">
          <Preview title="Input after redaction" text={review.redactedInput} />
          <Preview title="Output after redaction" text={review.redactedOutput} />
        </div>

        <div className="flex flex-wrap gap-2">
          <button
            type="submit"
            name="choice"
            value="redacted"
            disabled={pending}
            className={buttonClass("primary")}
          >
            Replace with placeholders and save
          </button>
          <button
            type="submit"
            name="choice"
            value="original"
            disabled={pending}
            className={buttonClass("secondary")}
          >
            These are invented, save as written
          </button>
        </div>
        {state.error && <ErrorText message={state.error} />}
      </form>
    );
  }

  return (
    <form action={formAction} className="space-y-4" aria-busy={pending}>
      <input type="hidden" name="skillSlug" value={skillSlug} />
      <div className="grid gap-4 sm:grid-cols-[1fr_12rem]">
        <Field label="Name" hint="optional, e.g. budget-review">
          <input name="name" maxLength={80} className={inputClass} />
        </Field>
        <Field label="Use for">
          <select name="split" defaultValue="train" className={inputClass}>
            <option value="train">Training</option>
            <option value="test">Testing (held back)</option>
          </select>
        </Field>
      </div>
      <div className="grid gap-4 lg:grid-cols-2">
        <TextOrFile name="input" label={`Raw input: ${inputType}`} placeholder="Paste it here…" />
        <TextOrFile
          name="output"
          label={`Your finished output: ${outputType}`}
          placeholder="Paste it here…"
        />
      </div>
      <div className="flex items-center gap-3">
        <button type="submit" disabled={pending} className={buttonClass("primary")}>
          {pending ? "Checking…" : "Check and add pair"}
        </button>
        {state.saved && (
          <span className="text-sm text-good" role="status">
            Added “{state.saved}”.
          </span>
        )}
      </div>
      {state.error && <ErrorText message={state.error} />}
    </form>
  );
}

function TextOrFile({
  name,
  label,
  placeholder,
}: {
  name: "input" | "output";
  label: string;
  placeholder: string;
}) {
  return (
    <div className="space-y-2">
      <Field label={label}>
        <textarea
          name={`${name}Text`}
          rows={10}
          className={`${inputClass} font-mono text-xs`}
          placeholder={placeholder}
        />
      </Field>
      <Field label="…or upload" hint=".md, .txt or .docx">
        <input
          type="file"
          name={`${name}File`}
          accept=".md,.markdown,.txt,.docx"
          className="mt-1 block w-full text-sm text-muted file:mr-3 file:rounded file:border file:border-line file:bg-subtle file:px-2 file:py-1"
        />
      </Field>
    </div>
  );
}

function Preview({ title, text }: { title: string; text: string }) {
  return (
    <div>
      <h3 className="mb-1 label-mono text-muted">{title}</h3>
      <pre className="max-h-64 overflow-auto whitespace-pre-wrap rounded-md border border-line bg-background p-3 font-mono text-xs">
        {text}
      </pre>
    </div>
  );
}

function ErrorText({ message }: { message: string }) {
  return (
    <p role="alert" className="text-sm text-danger">
      {message}
    </p>
  );
}
