import type { Metadata } from "next";
import Link from "next/link";
import { CompositeLine, RatingLine, VerifiedBadge } from "@/components/market";
import { PersunaOrb } from "@/components/persuna/orb";
import { Badge, buttonClass, Card, inputClass, PageHeader } from "@/components/ui";
import { isFiltered, parseBrowseQuery, SORTS, TURNAROUNDS } from "@/lib/market/browse";
import { browseListings } from "@/lib/market/service";
import { dollarsInput, formatUsd } from "@/lib/money";
import { persunasByOwner } from "@/lib/persuna/service";
import { plural } from "@/lib/plural";

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
  const { results, total, types } = await browseListings(query);
  const persunas = await persunasByOwner([
    ...new Set(results.flatMap((l) => (l.skill.ownerId ? [l.skill.ownerId] : []))),
  ]);
  const filtered = isFiltered(query);

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
            const persuna = r.skill.ownerId ? persunas.get(r.skill.ownerId) : undefined;
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
                {persuna?.handle && (
                  <Link
                    href={`/persunas/${persuna.handle}`}
                    className="label-mono border-t border-line px-6 py-3 text-muted hover:text-accent"
                  >
                    <span className="inline-flex items-center gap-2">
                      <PersunaOrb look={persuna.avatar} size={22} animate={false} />
                      by {persuna.name} →
                    </span>
                  </Link>
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
