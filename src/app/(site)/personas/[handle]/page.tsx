import type { Metadata } from "next";
import Link from "next/link";
import { PersonaOrb } from "@/components/persona/orb";
import { ScoreBadge } from "@/components/score-trend";
import { Badge, Card, PageHeader } from "@/components/ui";
import { orNotFound } from "@/lib/load";
import { formatNaira } from "@/lib/market/rules";
import { publicProfile } from "@/lib/persona/service";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ handle: string }> };

const TRUST = ["Owner-reviewed", "Auto-approved + review", "Spot-checked"];

export async function generateMetadata({ params }: Params): Promise<Metadata> {
  const { handle } = await params;
  const profile = await publicProfile(handle).catch(() => null);
  return { title: profile ? `${profile.name}, ${profile.ownerFirstName}'s persona` : "Persona" };
}

/**
 * A persona's public page: what it can do for hire, how well, how many
 * people use it and what they said. Nothing private about its owner.
 */
export default async function PublicPersonaPage({ params }: Params) {
  const { handle } = await params;
  const p = await orNotFound(() => publicProfile(handle));

  return (
    <div className="mx-auto max-w-5xl space-y-10 px-4 py-12 sm:px-8">
      <PageHeader
        eyebrow="Persona"
        title={
          <>
            <span className="inline-flex items-center gap-3">
              <PersonaOrb look={p.avatar} size={56} animate={false} />
              {p.name}
            </span>
          </>
        }
        description={`${p.ownerFirstName}'s persona. It works the way ${p.ownerFirstName} does, trained on their own examples and approved by them.`}
      />

      <dl className="grid gap-px overflow-hidden rounded-md border border-line bg-line sm:grid-cols-3">
        {[
          [
            "Renting it now",
            `${p.activeRenters} ${p.activeRenters === 1 ? "person" : "people"}`,
            "in the last 30 days",
          ],
          ["Tasks delivered", String(p.jobsDone), "approved results"],
          [
            "Average rating",
            p.averageRating ? `${p.averageRating} / 5` : "No ratings yet",
            `${p.reviews.length} review${p.reviews.length === 1 ? "" : "s"}`,
          ],
        ].map(([label, value, hint]) => (
          <div key={label} className="bg-card p-5">
            <dt className="label-mono text-faint">{label}</dt>
            <dd className="mt-1 font-display text-2xl font-medium tracking-[-0.02em]">{value}</dd>
            <dd className="text-xs text-muted">{hint}</dd>
          </div>
        ))}
      </dl>

      <section className="space-y-4" aria-labelledby="skills-heading">
        <h2 id="skills-heading" className="font-display text-2xl font-medium tracking-[-0.02em]">
          Skills for hire
        </h2>
        {p.skills.length === 0 ? (
          <p className="text-sm text-muted">No skills listed yet.</p>
        ) : (
          <ul className="grid gap-4 sm:grid-cols-2">
            {p.skills.map((s) => (
              <li key={s.listingId}>
                <Card className="flex h-full flex-col gap-3 p-5">
                  <div className="flex flex-wrap gap-2">
                    <Badge tone="accent">{TRUST[s.trustLevel] ?? TRUST[0]}</Badge>
                    <Badge>
                      {s.renters} renter{s.renters === 1 ? "" : "s"}
                    </Badge>
                  </div>
                  <p className="font-display text-xl font-medium tracking-[-0.02em]">{s.title}</p>
                  <p className="line-clamp-3 flex-1 text-sm text-muted">{s.description}</p>
                  <div className="flex items-end justify-between border-t border-line pt-3">
                    <span>
                      <span className="label-mono block text-faint">Per task</span>
                      <span className="font-display text-xl">{formatNaira(s.priceNgn)}</span>
                    </span>
                    <span className="text-right">
                      <span className="label-mono block text-faint">Score</span>
                      <ScoreBadge score={s.score} />
                    </span>
                  </div>
                  <Link
                    href={`/market/${s.listingId}`}
                    className="label-mono text-accent underline"
                  >
                    Rent this skill →
                  </Link>
                </Card>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="space-y-4" aria-labelledby="reviews-heading">
        <h2 id="reviews-heading" className="font-display text-2xl font-medium tracking-[-0.02em]">
          Reviews
        </h2>
        {p.reviews.length === 0 ? (
          <p className="text-sm text-muted">No reviews yet.</p>
        ) : (
          <ul className="space-y-3">
            {p.reviews.map((r, i) => (
              <li key={i}>
                <Card className="p-4 text-sm">
                  <p>
                    <span aria-label={`${r.rating} out of 5`} className="text-warn">
                      {"★".repeat(r.rating)}
                      <span className="text-line-strong">{"★".repeat(5 - r.rating)}</span>
                    </span>{" "}
                    <span className="label-mono ml-2 text-faint">
                      {r.renter} · {r.skill} ·{" "}
                      {r.date.toLocaleDateString("en-GB", { dateStyle: "medium" })}
                    </span>
                  </p>
                  {r.comment && <p className="mt-2 text-muted">{r.comment}</p>}
                </Card>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
