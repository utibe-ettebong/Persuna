"use client";

import { useRef, useState } from "react";
import { persunaAddExampleAction } from "@/app/actions/persuna";
import type { CompanionMessage } from "./companion";

const FILES = ".md,.markdown,.txt,.docx,.pdf,.png,.jpg,.jpeg,.webp";
const field =
  "w-full rounded-2xl bg-background/70 px-4 py-2.5 text-sm outline-none ring-1 ring-line focus:ring-2 focus:ring-accent";

/**
 * One example of the user's work for a skill: what they started with and
 * their finished version (typed, pasted or as files). Names are replaced
 * with placeholders on the server before it's kept.
 */
export function ExampleCard({
  skill,
  onDone,
  onCancel,
}: {
  skill: { slug: string; name: string };
  onDone: (message: CompanionMessage) => void;
  onCancel: () => void;
}) {
  const [before, setBefore] = useState("");
  const [after, setAfter] = useState("");
  const [use, setUse] = useState<"auto" | "off" | "on">("auto");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const beforeFile = useRef<HTMLInputElement>(null);
  const afterFile = useRef<HTMLInputElement>(null);

  async function save() {
    const form = new FormData();
    form.append("skill", skill.slug);
    form.append("before", before);
    form.append("after", after);
    if (use !== "auto") form.append("test", use);
    const b = beforeFile.current?.files?.[0];
    const a = afterFile.current?.files?.[0];
    if (b) form.append("beforeFile", b);
    if (a) form.append("afterFile", a);
    setPending(true);
    setError(null);
    const res = await persunaAddExampleAction(form);
    setPending(false);
    if (!res.ok) return setError(res.error);
    onDone({ ...res.value.message, role: "assistant", link: res.value.link });
  }

  return (
    <div className="space-y-3 p-4 text-sm" aria-label={`Add an example of ${skill.name}`}>
      <p className="font-medium">An example of {skill.name}</p>
      <label className="block space-y-1">
        <span className="text-muted">What you started with</span>
        <textarea
          value={before}
          onChange={(e) => setBefore(e.target.value)}
          rows={4}
          aria-label="What you started with"
          placeholder="Paste the raw notes, or add a file below"
          className={field}
        />
        <input
          ref={beforeFile}
          type="file"
          accept={FILES}
          aria-label="Starting file"
          className="text-xs"
        />
      </label>
      <label className="block space-y-1">
        <span className="text-muted">Your finished version</span>
        <textarea
          value={after}
          onChange={(e) => setAfter(e.target.value)}
          rows={4}
          aria-label="Your finished version"
          placeholder="Paste what you produced from it"
          className={field}
        />
        <input
          ref={afterFile}
          type="file"
          accept={FILES}
          aria-label="Finished file"
          className="text-xs"
        />
      </label>
      <label className="flex items-center gap-2">
        <span className="text-muted">Use it to</span>
        <select
          value={use}
          onChange={(e) => setUse(e.target.value as typeof use)}
          className="rounded-full bg-background/70 px-3 py-1 ring-1 ring-line"
        >
          <option value="auto">let Persuna decide</option>
          <option value="off">teach me</option>
          <option value="on">test me</option>
        </select>
      </label>
      <p className="text-xs text-muted">
        Names and details like emails and numbers are replaced with placeholders before it&apos;s
        kept.
      </p>
      {error && (
        <p role="alert" className="text-danger">
          {error}
        </p>
      )}
      <div className="flex gap-2">
        <button
          type="button"
          onClick={() => void save()}
          disabled={pending}
          className="rounded-full bg-accent px-5 py-2 text-accent-ink disabled:opacity-60"
        >
          {pending ? "Saving…" : "Save example"}
        </button>
        <button
          type="button"
          onClick={onCancel}
          className="rounded-full px-3 py-2 text-muted hover:text-foreground"
        >
          Cancel
        </button>
      </div>
    </div>
  );
}
