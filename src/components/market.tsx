import type { Verification } from "@/lib/market/rules";
import { plural } from "@/lib/plural";
import { Card } from "./ui";

const date = (d: Date) => d.toLocaleDateString("en-GB", { dateStyle: "medium" });

/** "Persuna Verified": the published version's score on held-back examples, and when. */
export function VerifiedBadge({
  verification,
  verified,
  compact = false,
}: {
  verification: Verification | null;
  verified: boolean;
  compact?: boolean;
}) {
  if (!verification) {
    return <span className="label-mono text-faint">Not tested yet</span>;
  }
  const facts = `${verification.score.toFixed(0)}/100 on ${plural(verification.examples, "held-back example")}`;
  return (
    <span
      className={`inline-flex flex-wrap items-center gap-x-2 gap-y-1 rounded-sm border px-2 py-1 text-xs ${
        verified ? "border-good/40 bg-good/8 text-good" : "border-warn/40 bg-warn/8 text-warn"
      }`}
      title={`Persuna drafted each held-back example with the published version (v${verification.version}) and scored it against the owner's own finished version. Last verified ${date(verification.verifiedAt)}.`}
    >
      <span className="label-mono">{verified ? "✓ Persuna Verified" : "Below the minimum"}</span>
      <span className="tabular-nums">{facts}</span>
      {!compact && <span className="text-muted">verified {date(verification.verifiedAt)}</span>}
    </span>
  );
}

export function Stars({ rating }: { rating: number }) {
  const full = Math.round(rating);
  return (
    <span aria-label={`${rating} out of 5`} className="text-warn">
      {"★".repeat(full)}
      <span className="text-line-strong">{"★".repeat(5 - full)}</span>
    </span>
  );
}

export function RatingLine({ average, count }: { average: number | null; count: number }) {
  if (average === null) return <span className="text-sm text-muted">No ratings yet</span>;
  return (
    <span className="inline-flex items-center gap-1.5 text-sm">
      <Stars rating={average} />
      <span className="tabular-nums">{average.toFixed(1)}</span>
      <span className="text-muted">({plural(count, "rating")})</span>
    </span>
  );
}

/** How a deal on Persuna protects both sides, in plain words. */
export function FairDealPanel({
  revisions,
  kind,
}: {
  revisions: number;
  kind: "rental" | "project";
}) {
  const points =
    kind === "rental"
      ? [
          [
            "Escrow",
            "You pay up front, but the money is held. The owner is paid only when you accept the result.",
          ],
          [
            "Checked before you see it",
            "Every statement in the result is checked against what you sent, and the owner reviews it unless the skill has earned auto-approval.",
          ],
          [
            "Changes",
            `Ask for changes in plain words, up to ${plural(revisions, "round")}, before you accept. The payment stays held meanwhile.`,
          ],
          [
            "Refunds",
            "If the owner declines your task, or you report a problem with the result, you get your money back.",
          ],
          [
            "Your material stays yours",
            "Your files and the result are deleted after the retention period and never become part of anyone's skill.",
          ],
        ]
      : [
          [
            "Milestone escrow",
            "Each milestone is paid into escrow before work on it starts, and released only when the poster approves it.",
          ],
          [
            "Clear criteria",
            "Persuna turns the brief into acceptance criteria both sides see before anyone commits.",
          ],
          [
            "Neutral checks",
            "Persuna checks every delivery against its criteria (met, not met, can't tell) and notes what's fair for both sides.",
          ],
          [
            "Changes",
            `The poster can ask for changes up to ${plural(revisions, "time")} per milestone, then approves or raises a dispute.`,
          ],
          [
            "Disputes and refunds",
            "A dispute gets Persuna's neutral assessment and a human decision. Funded milestones are refunded if work never starts.",
          ],
        ];
  return (
    <Card className="p-5">
      <h2 className="font-display text-lg font-medium tracking-[-0.02em]">Fair-deal guarantee</h2>
      <dl className="mt-3 space-y-3 text-sm">
        {points.map(([title, body]) => (
          <div key={title}>
            <dt className="font-medium">{title}</dt>
            <dd className="text-muted">{body}</dd>
          </div>
        ))}
      </dl>
    </Card>
  );
}
