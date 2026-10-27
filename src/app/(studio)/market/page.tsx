import type { Metadata } from "next";
import Link from "next/link";
import { ScoreBadge } from "@/components/score-trend";
import { Badge, Card, PageHeader } from "@/components/ui";
import { formatNaira } from "@/lib/market/rules";
import { listActiveListings } from "@/lib/market/service";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Marketplace" };

const TRUST_BADGE = ["Owner-reviewed", "Auto-approved + review", "Spot-checked"];

export default async function MarketPage() {
  const listings = await listActiveListings();

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
          {listings.map(({ listing, skill, score }) => (
            <li key={listing.id} className="bg-card">
              <Link
                href={`/market/${listing.id}`}
                className="group flex h-full flex-col gap-3 p-6 transition-colors hover:bg-accent-soft/40"
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
                      {formatNaira(listing.priceNgn)}
                    </span>
                  </span>
                  <span className="text-right">
                    <span className="label-mono block text-faint">Replication</span>
                    <ScoreBadge score={score} />
                  </span>
                </div>
              </Link>
            </li>
          ))}
          {Array.from({ length: (3 - (listings.length % 3)) % 3 }).map((_, i) => (
            <li key={`pad-${i}`} aria-hidden className="hatch hidden bg-background lg:block" />
          ))}
        </ul>
      )}
    </div>
  );
}
