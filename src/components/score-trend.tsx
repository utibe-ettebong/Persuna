interface Point {
  label: string;
  score: number;
}

/** Replication score per version, as a small bar chart. */
export function ScoreTrend({ points }: { points: Point[] }) {
  if (points.length === 0) {
    return <p className="text-sm text-muted">No test runs yet.</p>;
  }
  return (
    <figure>
      <ol className="flex h-36 items-end gap-2" aria-label="Replication score by version">
        {points.map((p) => (
          <li key={p.label} className="flex w-12 flex-col items-center gap-1">
            <span className="text-xs font-medium tabular-nums">{p.score.toFixed(0)}</span>
            <div
              className="w-full rounded-t bg-accent"
              style={{ height: `${Math.max(2, p.score)}px` }}
              aria-hidden
            />
            <span className="text-xs text-muted">{p.label}</span>
          </li>
        ))}
      </ol>
      <figcaption className="mt-2 text-xs text-muted">
        Replication score (0–100) on held-back examples, latest run per version.
      </figcaption>
    </figure>
  );
}

export function ScoreBadge({ score }: { score: number | null }) {
  if (score === null) return <span className="text-muted">–</span>;
  const tone = score >= 80 ? "text-good" : score >= 60 ? "text-warn" : "text-danger";
  return <span className={`font-semibold tabular-nums ${tone}`}>{score.toFixed(1)}</span>;
}
