import type { Metadata } from "next";
import Link from "next/link";
import { CompositeLine, RatingLine, Stars, VerifiedBadge } from "@/components/market";
import { PersunaOrb } from "@/components/persuna/orb";
import { Badge, buttonClass, Card, inputClass, PageHeader } from "@/components/ui";
import { isFiltered, parseBrowseQuery, SORTS, TURNAROUNDS } from "@/lib/market/browse";
import { browseListings, marketplaceHighlights } from "@/lib/market/service";
import { dollarsInput, formatUsd } from "@/lib/money";
import { persunasByOwner } from "@/lib/persuna/service";
import { plural } from "@/lib/plural";
import { peopleFor } from "@/lib/profile/service";

export const dynamic = "force-dynamic";
export const metadata: Metadata = {
  title: "Marketplace",
  description:
    "Rent a proven way of working, per task. Every skill is tested by Persuna on held-back examples, and you pay only when you accept the result.",
  robots: { index: true, follow: true },
};

const TRUST_BADGE = ["Owner-reviewed", "Auto-approved + review", "Spot-checked"];

type Params = { searchParams: Promise<Record<string, string | string[] | undefined>> };

export default async function MarketPage({ searchParams }: Params) {
  const query = parseBrowseQuery(await searchParams);
  const filtered = isFiltered(query);
  const [{ results, total, types }, highlights] = await Promise.all([
    browseListings(query),
    filtered ? Promise.resolve(null) : marketplaceHighlights(),
  ]);
  const ownerIds = [
    ...new Set(
      [...results, ...(highlights?.top ?? [])]
        .flatMap((l) => (l.skill.ownerId ? [l.skill.ownerId] : []))
        .concat((highlights?.creators ?? []).map((c) => c.ownerId)),
    ),
  ];
  const [persunas, people] = await Promise.all([persunasByOwner(ownerIds), peopleFor(ownerIds)]);
  /** Every card names its creator; the profile link needs a public handle. */
  const creatorOf = (ownerId: string | null) => {
    if (!ownerId) return null;
    const persuna = persunas.get(ownerId);
    const person = people.get(ownerId);
    const name = person?.name ?? persuna?.name;
    if (!name) return null;
    return { name, handle: person?.handle ?? persuna?.handle ?? null, avatar: persuna?.avatar };
  };

  return (
    <div className="space-y-8">
      <PageHeader
        eyebrow="Marketplace"
        title="Rent a proven method"
        description="Pay per task for someone's way of working. Persuna tests every skill on examples it never trained on before it can be listed. You get the result, never their rules or other clients' work, and you pay only when you accept it."
      >
        <Link href="/projects" className={buttonClass("secondary")}>
          Post a project instead
        </Link>
      </PageHeader>

      {highlights && highlights.top.length > 0 && (
        <section aria-labelledby="top-heading" className="space-y-3">
          <h2 id="top-heading" className="font-display text-2xl font-medium tracking-[-0.02em]">
            Top performing
          </h2>
          <ol className="divide-y divide-line rounded-md border border-line bg-card">
            {highlights.top.map((r, i) => {
              const creator = creatorOf(r.skill.ownerId);
              return (
                <li key={r.listing.id}>
                  <Link
                    href={`/market/${r.listing.id}`}
                    className="flex flex-wrap items-baseline gap-x-3 gap-y-1 px-4 py-3 hover:bg-accent-soft/40"
                  >
                    <span className="font-display text-lg tabular-nums text-faint">{i + 1}</span>
                    <span className="min-w-0 flex-1">
                      <span className="font-medium">{r.listing.title}</span>{" "}
                      {creator && <span className="text-sm text-muted">by {creator.name}</span>}
                    </span>
                    <span className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-muted">
                      {r.ratings.average !== null ? (
                        <span className="inline-flex items-center gap-1">
                          <Stars rating={r.ratings.average} />
                          <span className="tabular-nums">{r.ratings.average.toFixed(1)}</span>
                        </span>
                      ) : (
                        <span>Not rated yet</span>
                      )}
                      <span>{plural(r.rentals, "rental")}</span>
                      <span className="font-display text-base tabular-nums text-foreground">
                        {formatUsd(r.listing.priceCents)}
                      </span>
                    </span>
                  </Link>
                </li>
              );
            })}
          </ol>
        </section>
      )}

      {highlights && highlights.creators.length > 0 && (
        <section aria-labelledby="creators-heading" className="space-y-3">
          <h2
            id="creators-heading"
            className="font-display text-2xl font-medium tracking-[-0.02em]"
          >
            Verified creators
          </h2>
          <ul className="grid gap-px overflow-hidden rounded-md border border-line bg-line sm:grid-cols-2 lg:grid-cols-3">
            {highlights.creators.map((c) => {
              const creator = creatorOf(c.ownerId);
              if (!creator) return null;
              const body = (
                <span className="flex items-center gap-3">
                  {creator.avatar ? (
                    <PersunaOrb look={creator.avatar} size={36} animate={false} />
                  ) : (
                    <span className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-accent font-display text-sm font-semibold text-accent-ink">
                      {creator.name[0]}
                    </span>
                  )}
                  <span className="min-w-0">
                    <span className="block truncate font-medium">{creator.name}</span>
                    <span className="label-mono block text-muted">
                      {plural(c.skills, "skill")} · {plural(c.rentals, "rental")}
                      {c.averageRating !== null && ` · ★ ${c.averageRating.toFixed(1)}`}
                    </span>
                  </span>
                </span>
              );
              return (
                <li key={c.ownerId} className="bg-card">
                  {creator.handle ? (
                    <Link
                      href={`/persunas/${creator.handle}`}
                      className="block p-4 transition-colors hover:bg-accent-soft/40"
                    >
                      {body}
                    </Link>
                  ) : (
                    <span className="block p-4">{body}</span>
                  )}
                </li>
              );
            })}
          </ul>
        </section>
      )}

      <form
        method="get"
        className="grid gap-3 rounded-md border border-line bg-card p-4 sm:grid-cols-2 lg:grid-cols-6"
      >
        <label className="text-sm lg:col-span-2">
          <span className="font-medium">Search</span>
          <input
            name="q"
            type="search"
            defaultValue={query.q}
            placeholder="minutes, proposals, reports…"
            className={inputClass}
          />
        </label>
        <label className="text-sm">
          <span className="font-medium">Type</span>
          <select name="type" defaultValue={query.type ?? ""} className={inputClass}>
            <option value="">Any</option>
            {types.map((t) => (
              <option key={t} value={t}>
                {t}
              </option>
            ))}
          </select>
        </label>
        <div className="grid grid-cols-2 gap-2 text-sm">
          <label>
            <span className="font-medium">Min $</span>
            <input
              name="min"
              inputMode="decimal"
              defaultValue={dollarsInput(query.minPriceCents)}
              className={inputClass}
            />
          </label>
          <label>
            <span className="font-medium">Max $</span>
            <input
              name="max"
              inputMode="decimal"
              defaultValue={dollarsInput(query.maxPriceCents)}
              className={inputClass}
            />
          </label>
        </div>
        <label className="text-sm">
          <span className="font-medium">Min score</span>
          <select name="score" defaultValue={query.minScore ?? ""} className={inputClass}>
            <option value="">Any verified</option>
            {[85, 90, 95].map((s) => (
              <option key={s} value={s}>
                {s}+
              </option>
            ))}
          </select>
        </label>
        <label className="text-sm">
          <span className="font-medium">Turnaround</span>
          <select name="hours" defaultValue={query.maxHours ?? ""} className={inputClass}>
            <option value="">Any</option>
            {TURNAROUNDS.map((t) => (
              <option key={t.hours} value={t.hours}>
                {t.label}
              </option>
            ))}
          </select>
        </label>
        <div className="flex flex-wrap items-end gap-2 sm:col-span-2 lg:col-span-6">
          <label className="text-sm">
            <span className="font-medium">Sort</span>
            <select name="sort" defaultValue={query.sort} className={inputClass}>
              {Object.entries(SORTS).map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </select>
          </label>
          <button type="submit" className={buttonClass("primary")}>
            Show skills
          </button>
          {filtered && (
            <Link href="/market" className="label-mono px-2 py-2 text-muted hover:text-foreground">
              Clear
            </Link>
          )}
          <span className="ml-auto text-sm text-muted" role="status">
            {filtered
              ? `${plural(results.length, "skill")} of ${total}`
              : plural(total, "verified skill")}
          </span>
        </div>
      </form>

      {results.length === 0 ? (
        <Card className="hatch p-10 text-center">
          <p className="mx-auto max-w-md rounded-md border border-line bg-card p-6 text-sm text-muted">
            {filtered
              ? "No skills match. Try fewer filters."
              : "No live listings yet. Owners list a skill from its Listing tab once it is published and Persuna has verified it."}
          </p>
        </Card>
      ) : (
        <ul className="grid gap-px overflow-hidden rounded-md border border-line bg-line sm:grid-cols-2 lg:grid-cols-3">
          {results.map((r) => {
            const creator = creatorOf(r.skill.ownerId);
            const byline = creator && (
              <span className="inline-flex items-center gap-2">
                {creator.avatar && <PersunaOrb look={creator.avatar} size={22} animate={false} />}
                by {creator.name}
                {creator.handle ? " →" : ""}
              </span>
            );
            return (
              <li key={r.listing.id} className="flex flex-col bg-card">
                <Link
                  href={`/market/${r.listing.id}`}
                  className="group flex flex-1 flex-col gap-3 p-6 transition-colors hover:bg-accent-soft/40"
                >
                  <div className="flex flex-wrap gap-2">
                    <Badge tone="accent">{TRUST_BADGE[r.skill.trustLevel] ?? TRUST_BADGE[0]}</Badge>
                    <Badge>{r.skill.outputType}</Badge>
                  </div>
                  <p className="font-display text-xl font-medium tracking-[-0.02em] group-hover:text-accent">
                    {r.listing.title}
                  </p>
                  <p className="line-clamp-3 flex-1 text-sm leading-relaxed text-muted">
                    {r.listing.description}
                  </p>
                  <VerifiedBadge verification={r.verification} verified={r.verified} compact />
                  <CompositeLine composite={r.composite} />
                  <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-muted">
                    <RatingLine average={r.ratings.average} count={r.ratings.count} />
                    <span>
                      {plural(r.rentals, "rental")} · ~{r.listing.turnaroundHours}h
                    </span>
                  </div>
                  <div className="flex items-end justify-between gap-2 border-t border-line pt-4">
                    <span>
                      <span className="label-mono block text-faint">Per task</span>
                      <span className="font-display text-2xl font-medium tabular-nums tracking-[-0.02em]">
                        {formatUsd(r.listing.priceCents)}
                      </span>
                    </span>
                    <span className="label-mono text-accent">View →</span>
                  </div>
                </Link>
                {creator?.handle ? (
                  <Link
                    href={`/persunas/${creator.handle}`}
                    className="label-mono border-t border-line px-6 py-3 text-muted hover:text-accent"
                  >
                    {byline}
                  </Link>
                ) : (
                  creator && (
                    <span className="label-mono border-t border-line px-6 py-3 text-muted">
                      {byline}
                    </span>
                  )
                )}
              </li>
            );
          })}
          {Array.from({ length: (3 - (results.length % 3)) % 3 }).map((_, i) => (
            <li key={`pad-${i}`} aria-hidden className="hatch hidden bg-background lg:block" />
          ))}
        </ul>
      )}
    </div>
  );
}
