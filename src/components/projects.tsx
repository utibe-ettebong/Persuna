import type { ProjectUpdate } from "@/db/schema";
import type { FitReport, MilestoneCheck } from "@/lib/projects/types";
import { PersonaOrb } from "./persona/orb";
import { Badge, type Tone } from "./ui";

export const PROJECT_STATUS: Record<string, { tone: Tone; label: string }> = {
  draft: { tone: "neutral", label: "draft" },
  open: { tone: "accent", label: "open for proposals" },
  in_progress: { tone: "warn", label: "in progress" },
  completed: { tone: "good", label: "completed" },
  cancelled: { tone: "neutral", label: "cancelled" },
  disputed: { tone: "danger", label: "disputed" },
};

export const MILESTONE_STATUS: Record<string, { tone: Tone; label: string }> = {
  pending: { tone: "neutral", label: "not funded" },
  funded: { tone: "warn", label: "funded · in escrow" },
  submitted: { tone: "accent", label: "delivered · awaiting approval" },
  changes_requested: { tone: "warn", label: "changes requested" },
  approved: { tone: "good", label: "approved" },
  released: { tone: "good", label: "paid out" },
  refunded: { tone: "neutral", label: "refunded" },
};

const VERDICT = {
  met: { tone: "good", label: "met" },
  not_met: { tone: "danger", label: "not met" },
  unclear: { tone: "warn", label: "can't tell" },
} as const;

/** Persuna's check of a delivery: each criterion, then a fairness note for both sides. */
export function CheckReport({ check }: { check: MilestoneCheck }) {
  return (
    <div className="space-y-3 rounded-md border border-line bg-subtle/60 p-4 text-sm">
      <p className="flex items-center gap-2 font-medium">
        <PersonaOrb look="plum" size={20} animate={false} /> Persuna&apos;s check · round{" "}
        {check.round}
      </p>
      <ul className="space-y-2">
        {check.results.map((r, i) => (
          <li key={i} className="flex flex-wrap items-start gap-2">
            <Badge tone={VERDICT[r.verdict].tone}>{VERDICT[r.verdict].label}</Badge>
            <span className="min-w-0 flex-1">
              <span className="font-medium">{r.criterion}</span>
              <span className="block text-muted">{r.reason}</span>
            </span>
          </li>
        ))}
      </ul>
      <p>{check.summary}</p>
      <dl className="grid gap-2 sm:grid-cols-2">
        <div>
          <dt className="label-mono text-faint">Fair to the poster</dt>
          <dd className="text-muted">{check.fairness.poster}</dd>
        </div>
        <div>
          <dt className="label-mono text-faint">Fair to the seller</dt>
          <dd className="text-muted">{check.fairness.seller}</dd>
        </div>
      </dl>
    </div>
  );
}

const RECOMMENDATION = {
  strong: { tone: "good", label: "strong fit" },
  possible: { tone: "warn", label: "possible fit" },
  weak: { tone: "danger", label: "weak fit" },
} as const;

export function FitReportView({ fit }: { fit: FitReport }) {
  const rec = RECOMMENDATION[fit.recommendation];
  return (
    <div className="space-y-2 rounded-md border border-line bg-subtle/60 p-3 text-sm">
      <p className="flex flex-wrap items-center gap-2">
        <span className="label-mono text-faint">Persuna&apos;s fit report</span>
        <Badge tone={rec.tone}>{rec.label}</Badge>
        <Badge>{fit.priceNote}</Badge>
      </p>
      <p>{fit.summary}</p>
      {fit.verifiedSkills.length > 0 && (
        <p className="text-muted">
          Verified skills:{" "}
          {fit.verifiedSkills.map((s) => `${s.title} (${s.score.toFixed(0)})`).join(", ")}
        </p>
      )}
      {fit.strengths.length > 0 && (
        <ul className="list-disc pl-5 text-good">
          {fit.strengths.map((s) => (
            <li key={s}>{s}</li>
          ))}
        </ul>
      )}
      {fit.risks.length > 0 && (
        <ul className="list-disc pl-5 text-warn">
          {fit.risks.map((s) => (
            <li key={s}>{s}</li>
          ))}
        </ul>
      )}
    </div>
  );
}

const AUTHOR = { persona: "Persuna", poster: "Poster", seller: "Seller" } as const;

/** Every step of the project, with Persuna's checks marked. */
export function Timeline({ updates }: { updates: ProjectUpdate[] }) {
  if (!updates.length) return <p className="text-sm text-muted">Nothing yet.</p>;
  return (
    <ol className="space-y-3">
      {updates.map((u) => (
        <li
          key={u.id}
          className={`rounded-md border p-3 text-sm ${
            u.author === "persona" ? "border-accent/40 bg-accent-soft/40" : "border-line bg-card"
          }`}
        >
          <p className="label-mono flex flex-wrap items-center gap-2 text-faint">
            {u.author === "persona" && <PersonaOrb look="plum" size={16} animate={false} />}
            {AUTHOR[u.author]} · {u.kind} ·{" "}
            {u.createdAt.toLocaleString("en-GB", { dateStyle: "medium", timeStyle: "short" })}
          </p>
          <p className="mt-1 whitespace-pre-wrap">{u.body}</p>
        </li>
      ))}
    </ol>
  );
}
