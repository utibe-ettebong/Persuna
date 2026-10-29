/**
 * The dashboard's small decisions, kept pure so they're tested: money per
 * week, and the next thing each project is waiting on, and from whom.
 */

const DAY = 86_400_000;

/** Monday 00:00 UTC of the week holding `date`. */
export function weekStart(date: Date): Date {
  const d = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
  const back = (d.getUTCDay() + 6) % 7; // Monday = 0
  return new Date(d.getTime() - back * DAY);
}

/** Cents per week for the last `weeks` weeks, oldest first, this week last (zeros included). */
export function weeklyTotals(
  payments: { at: Date; cents: number }[],
  now: Date,
  weeks = 8,
): { week: Date; cents: number }[] {
  const last = weekStart(now).getTime();
  const out = Array.from({ length: weeks }, (_, i) => ({
    week: new Date(last - (weeks - 1 - i) * 7 * DAY),
    cents: 0,
  }));
  for (const p of payments) {
    const i = (weekStart(p.at).getTime() - out[0].week.getTime()) / (7 * DAY);
    if (i >= 0 && i < weeks) out[i].cents += p.cents;
  }
  return out;
}

export type ProjectRole = "poster" | "seller" | "proposer";

export interface NextStep {
  label: string;
  /** True when it's this person's move. */
  yours: boolean;
}

/**
 * What a project is waiting on, from this person's side: proposals to
 * review, a milestone to fund, deliver, check or fix, ratings to give.
 */
export function projectNextStep(
  project: { status: string; proposals: number; rated: boolean },
  milestones: { status: string }[],
  role: ProjectRole,
): NextStep {
  const poster = role === "poster";
  const has = (s: string) => milestones.some((m) => m.status === s);
  switch (project.status) {
    case "draft":
      return { label: "Confirm Persuna's plan to open it", yours: poster };
    case "open":
      if (role === "proposer") return { label: "Waiting for the client to choose", yours: false };
      return project.proposals
        ? {
            label: `Review ${project.proposals} proposal${project.proposals === 1 ? "" : "s"}`,
            yours: true,
          }
        : { label: "Waiting for proposals", yours: false };
    case "in_progress":
      if (role === "proposer") return { label: "Another seller was chosen", yours: false };
      if (has("submitted"))
        return poster
          ? { label: "Check the delivery and approve", yours: true }
          : { label: "Waiting for the client's review", yours: false };
      if (has("changes_requested"))
        return poster
          ? { label: "Waiting for the changes", yours: false }
          : { label: "Make the requested changes", yours: true };
      if (has("funded"))
        return poster
          ? { label: "The seller is working", yours: false }
          : { label: "Deliver the funded milestone", yours: true };
      if (has("pending"))
        return poster
          ? { label: "Fund the next milestone", yours: true }
          : { label: "Waiting for the client to fund", yours: false };
      return { label: "Wrapping up", yours: false };
    case "completed":
      return project.rated
        ? { label: "Completed", yours: false }
        : { label: `Rate the ${poster ? "seller" : "client"}`, yours: true };
    case "disputed":
      return { label: "With a Persuna reviewer", yours: false };
    default:
      return { label: "Closed", yours: false };
  }
}

/** "Good morning" / "Good afternoon" / "Good evening" for an hour 0–23. */
export function greetingFor(hour: number): string {
  return hour < 12 ? "Good morning" : hour < 18 ? "Good afternoon" : "Good evening";
}
