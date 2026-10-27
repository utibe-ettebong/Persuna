"use client";

import { useRef, useState } from "react";
import { personaRunTaskAction } from "@/app/actions/persona";
import type { ChatJob } from "@/lib/persona/service";
import type { CompanionMessage } from "./companion";

/**
 * Hands Persona some work: pick a published skill, paste the input or upload
 * a file, and it drafts the result with your method.
 */
export function TaskComposer({
  skills,
  initial,
  onDone,
  onCancel,
}: {
  skills: { slug: string; name: string }[];
  initial: string | null;
  onDone: (messages: CompanionMessage[], job: ChatJob) => void;
  onCancel: () => void;
}) {
  const [skill, setSkill] = useState(initial ?? skills[0]?.slug ?? "");
  const [text, setText] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const file = useRef<HTMLInputElement>(null);

  if (!skills.length) {
    return (
      <div className="border-b border-line bg-subtle px-4 py-3 text-sm">
        <p>You need a published skill before I can do work for you.</p>
        <button type="button" onClick={onCancel} className="label-mono mt-2 text-muted">
          Close
        </button>
      </div>
    );
  }

  async function run() {
    const form = new FormData();
    form.append("skill", skill);
    form.append("text", text);
    const picked = file.current?.files?.[0];
    if (picked) form.append("file", picked);
    setPending(true);
    setError(null);
    const res = await personaRunTaskAction(form);
    setPending(false);
    if (!res.ok) return setError(res.error);
    onDone(
      res.value.messages.map((m) => ({ ...m, role: m.role })),
      res.value.job,
    );
  }

  return (
    <div
      className="space-y-2 border-b border-line bg-subtle px-4 py-3 text-sm"
      aria-label="Give Persona a task"
    >
      <div className="flex items-center gap-2">
        <label className="font-medium" htmlFor="persona-task-skill">
          Do this with
        </label>
        <select
          id="persona-task-skill"
          value={skill}
          onChange={(e) => setSkill(e.target.value)}
          className="flex-1 rounded-md border border-line bg-background px-2 py-1"
        >
          {skills.map((s) => (
            <option key={s.slug} value={s.slug}>
              {s.name}
            </option>
          ))}
        </select>
      </div>
      <textarea
        value={text}
        onChange={(e) => setText(e.target.value)}
        rows={5}
        aria-label="Task input"
        placeholder="Paste the notes here…"
        className="w-full rounded-md border border-line bg-background px-3 py-2 outline-none focus:border-accent"
      />
      <label className="block text-muted">
        …or upload a file (.md, .txt, .docx)
        <input
          ref={file}
          type="file"
          accept=".md,.txt,.docx"
          className="mt-1 block w-full text-xs"
        />
      </label>
      <p className="text-xs text-muted">
        The text is kept with the job only (deleted after the retention period), never in our chat
        or your skill.
      </p>
      {error && (
        <p role="alert" className="text-danger">
          {error}
        </p>
      )}
      <div className="flex gap-3">
        <button
          type="button"
          onClick={() => void run()}
          disabled={pending}
          className="label-mono rounded-md bg-accent px-3 py-1.5 text-accent-ink disabled:opacity-60"
        >
          {pending ? "Drafting…" : "Draft it"}
        </button>
        <button type="button" onClick={onCancel} className="label-mono text-muted">
          Cancel
        </button>
      </div>
    </div>
  );
}
