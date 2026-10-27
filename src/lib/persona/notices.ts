/**
 * What Persona speaks up about without being asked: work waiting for review,
 * a skill's score moving, a new order, and the job on screen. Pure: the
 * service gathers the facts, this decides what's worth saying. Each notice
 * has a stable key so it is said once.
 */
export interface NoticeFacts {
  now: Date;
  /** The user's local day (YYYY-MM-DD), so "waiting" notices repeat at most daily. */
  day: string;
  waiting: {
    id: string;
    skill: string;
    createdAt: Date;
    flags: number;
    origin: "owner" | "renter";
  }[];
  scores: { slug: string; skill: string; runId: string; latest: number; previous: number }[];
  orders: { id: string; skill: string; renter: string; createdAt: Date }[];
  /** The job open on screen, if the user is looking at one. */
  viewingJobId: string | null;
}

export interface Notice {
  key: string;
  text: string;
  href: string;
  /** Lower is more important. */
  rank: number;
}

const DAY = 86_400_000;
export const WAIT_AFTER_MS = DAY;
export const SCORE_DROP = 3;
export const SCORE_RISE = 5;
/** At most this many at once, so Persona never rattles off a list. */
export const MAX_NOTICES = 3;

export function ageText(ms: number): string {
  const days = Math.floor(ms / DAY);
  if (days >= 2) return `${days} days`;
  if (days === 1) return "a day";
  const hours = Math.max(1, Math.floor(ms / 3_600_000));
  return hours === 1 ? "an hour" : `${hours} hours`;
}

export function notices(f: NoticeFacts): Notice[] {
  const out: Notice[] = [];
  const now = f.now.getTime();

  const here = f.waiting.find((j) => j.id === f.viewingJobId);
  if (here) {
    out.push({
      key: `here:${here.id}:${f.day}`,
      text:
        `This ${here.skill} job has been waiting ${ageText(now - here.createdAt.getTime())}.` +
        (here.flags
          ? ` I flagged ${here.flags === 1 ? "one thing" : `${here.flags} things`} on it.`
          : ""),
      href: `/jobs/${here.id}`,
      rank: 0,
    });
  }

  for (const o of f.orders) {
    out.push({
      key: `order:${o.id}`,
      text: `New order from ${o.renter.split(/\s+/)[0]} for ${o.skill}.`,
      href: `/jobs/${o.id}`,
      rank: 1,
    });
  }

  const stale = f.waiting
    .filter((j) => j.id !== f.viewingJobId && now - j.createdAt.getTime() >= WAIT_AFTER_MS)
    .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());
  if (stale.length === 1) {
    const j = stale[0];
    out.push({
      key: `wait:${j.id}:${f.day}`,
      text: `Your ${j.skill} job${j.origin === "renter" ? " for a renter" : ""} has been waiting ${ageText(now - j.createdAt.getTime())}.`,
      href: `/jobs/${j.id}`,
      rank: j.origin === "renter" ? 1 : 2,
    });
  } else if (stale.length > 1) {
    out.push({
      key: `wait-many:${f.day}:${stale.length}`,
      text: `${stale.length} jobs are waiting for your review. The oldest has waited ${ageText(now - stale[0].createdAt.getTime())}.`,
      href: "/jobs",
      rank: stale.some((j) => j.origin === "renter") ? 1 : 2,
    });
  }

  for (const s of f.scores) {
    const latest = Math.round(s.latest);
    const previous = Math.round(s.previous);
    if (previous - latest >= SCORE_DROP) {
      out.push({
        key: `drop:${s.runId}`,
        text: `Your ${s.skill} skill dropped to ${latest} (from ${previous}). The last change may have hurt it.`,
        href: `/skills/${s.slug}`,
        rank: 2,
      });
    } else if (latest - previous >= SCORE_RISE) {
      out.push({
        key: `rise:${s.runId}`,
        text: `Nice: ${s.skill} is up to ${latest} (from ${previous}).`,
        href: `/skills/${s.slug}`,
        rank: 3,
      });
    }
  }

  return out.sort((a, b) => a.rank - b.rank);
}

/** Notices not said before, at most {@link MAX_NOTICES}. */
export function unseen(all: Notice[], seen: string[]): Notice[] {
  const said = new Set(seen);
  return all.filter((n) => !said.has(n.key)).slice(0, MAX_NOTICES);
}
