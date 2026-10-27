"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { personaJobAction, personaReviewJobAction } from "@/app/actions/persona";
import type { ChatJob } from "@/lib/persona/service";

/** A draft Persona made, shown in the chat with approve, edit and send back. */
export function JobCard({ jobId, initial }: { jobId: string; initial?: ChatJob }) {
  const [job, setJob] = useState<ChatJob | null>(initial ?? null);
  const [gone, setGone] = useState(false);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(initial?.draft ?? "");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (job) return;
    let live = true;
    void personaJobAction(jobId).then((res) => {
      if (!live) return;
      if (res.ok) {
        setJob(res.value);
        setDraft(res.value.draft);
      } else setGone(true);
    });
    return () => {
      live = false;
    };
  }, [job, jobId]);

  if (gone) return <p className="mt-2 text-xs text-muted">This job has been deleted.</p>;
  if (!job) return <p className="mt-2 text-xs text-muted">Loading the draft…</p>;

  async function decide(decision: "approve" | "reject") {
    setPending(true);
    setError(null);
    const res = await personaReviewJobAction(
      jobId,
      decision,
      decision === "approve" && editing ? draft : undefined,
    );
    setPending(false);
    if (!res.ok) return setError(res.error);
    setJob(res.value);
    setEditing(false);
  }

  return (
    <div className="mt-2 space-y-2 rounded-md border border-line bg-card p-2 text-foreground">
      {job.flags.length > 0 && (
        <ul className="space-y-1 text-xs text-warn">
          {job.flags.map((f) => (
            <li key={f}>⚠ {f}</li>
          ))}
        </ul>
      )}
      {editing ? (
        <textarea
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          rows={10}
          aria-label="Edit the draft"
          className="w-full rounded-md border border-line bg-background p-2 font-mono text-xs"
        />
      ) : (
        <pre className="max-h-56 overflow-y-auto whitespace-pre-wrap font-sans text-xs leading-relaxed">
          {job.draft}
        </pre>
      )}
      {error && (
        <p role="alert" className="text-xs text-danger">
          {error}
        </p>
      )}
      <div className="flex flex-wrap items-center gap-3">
        {job.status === "review" ? (
          <>
            <button
              type="button"
              disabled={pending}
              onClick={() => void decide("approve")}
              className="label-mono rounded-md bg-good px-2 py-1 text-white"
            >
              {editing ? "Approve edit" : "Approve"}
            </button>
            <button
              type="button"
              onClick={() => setEditing((e) => !e)}
              className="label-mono text-accent"
            >
              {editing ? "Cancel edit" : "Edit"}
            </button>
            <button
              type="button"
              disabled={pending}
              onClick={() => void decide("reject")}
              className="label-mono text-danger"
            >
              Send back
            </button>
          </>
        ) : (
          <span className={`label-mono ${job.status === "approved" ? "text-good" : "text-muted"}`}>
            {job.status === "approved"
              ? "✓ Approved"
              : job.status === "rejected"
                ? "Sent back"
                : job.status}
          </span>
        )}
        <Link href={`/jobs/${job.id}`} className="label-mono ml-auto text-muted underline">
          Open job
        </Link>
      </div>
    </div>
  );
}
