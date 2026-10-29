import type { Metadata } from "next";
import Link from "next/link";
import { PersonaOrb } from "@/components/persona/orb";
import { ScoreBadge } from "@/components/score-trend";
import { Badge, Card, PageHeader } from "@/components/ui";
import { formatUsd } from "@/lib/money";
import { listActiveListings } from "@/lib/market/service";
import { personasByOwner } from "@/lib/persona/service";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Marketplace" };

const TRUST_BADGE = ["Owner-reviewed", "Auto-approved + review", "Spot-checked"];

export default async function MarketPage() {
  const listings = await listActiveListings();
  const personas = await personasByOwner([
    ...new Set(listings.flatMap((l) => (l.skill.ownerId ? [l.skill.ownerId] : []))),
  ]);

  return (
    <div className="space-y-10">
      <PageHeader
        eyebrow="Marketplace"
        title="Rent a proven method"
        description="Pay per task for someone's way of working. You get the result, never their rules or other clients' work, and you pay only when you accept it."
      />
      {listings.length === 0 ? (
        <Card className="hatch p-10 text-center">
          <p className="mx-auto max-w-md rounded-md border border-line bg-card p-6 text-sm text-muted">
            No live listings yet. Owners list a skill from its Listing tab once it is published and
            scores well enough.
          </p>
        </Card>
      ) : (
        <ul className="grid gap-px overflow-hidden rounded-md border border-line bg-line sm:grid-cols-2 lg:grid-cols-3">
          {listings.map(({ listing, skill, score }) => {
            const persona = skill.ownerId ? personas.get(skill.ownerId) : undefined;
            return (
              <li key={listing.id} className="flex flex-col bg-card">
                <Link
                  href={`/market/${listing.id}`}
                  className="group flex flex-1 flex-col gap-3 p-6 transition-colors hover:bg-accent-soft/40"
                >
                  <Badge tone="accent">{TRUST_BADGE[skill.trustLevel] ?? TRUST_BADGE[0]}</Badge>
                  <p className="font-display text-xl font-medium tracking-[-0.02em] group-hover:text-accent">
                    {listing.title}
                  </p>
                  <p className="line-clamp-3 flex-1 text-sm leading-relaxed text-muted">
                    {listing.description}
                  </p>
                  <div className="flex items-end justify-between gap-2 border-t border-line pt-4">
                    <span>
                      <span className="label-mono block text-faint">Per task</span>
                      <span className="font-display text-2xl font-medium tabular-nums tracking-[-0.02em]">
                        {formatUsd(listing.priceCents)}
                      </span>
                    </span>
                    <span className="text-right">
                      <span className="label-mono block text-faint">Replication</span>
                      <ScoreBadge score={score} />
                    </span>
                  </div>
                </Link>
                {persona?.handle && (
                  <Link
                    href={`/personas/${persona.handle}`}
                    className="label-mono border-t border-line px-6 py-3 text-muted hover:text-accent"
                  >
                    <span className="inline-flex items-center gap-2">
                      <PersonaOrb look={persona.avatar} size={22} animate={false} />
                      by {persona.name} →
                    </span>
                  </Link>
                )}
              </li>
            );
          })}
          {Array.from({ length: (3 - (listings.length % 3)) % 3 }).map((_, i) => (
            <li key={`pad-${i}`} aria-hidden className="hatch hidden bg-background lg:block" />
          ))}
        </ul>
      )}
    </div>
  );
}
