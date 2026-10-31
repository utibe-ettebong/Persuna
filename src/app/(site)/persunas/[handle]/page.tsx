import type { Metadata } from "next";
import Link from "next/link";
import { CompositeLine } from "@/components/market";
import { PersunaOrb } from "@/components/persuna/orb";
import { ScoreBadge } from "@/components/score-trend";
import { Badge, Card } from "@/components/ui";
import { orNotFound } from "@/lib/load";
import { formatUsd } from "@/lib/money";
import { initialsOf } from "@/lib/profile/rules";
import { personProfile } from "@/lib/profile/service";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ handle: string }> };

const TRUST = ["Owner-reviewed", "Auto-approved + review", "Spot-checked"];

export async function generateMetadata({ params }: Params): Promise<Metadata> {
  const { handle } = await params;
  const p = await personProfile(handle).catch(() => null);
  if (!p) return { title: "Persuna" };
  return {
    title: `${p.name} on Persuna`,
    description: p.headline ?? `${p.name}'s skills, portfolio and reviews on Persuna.`,
    openGraph: { title: `${p.name} on Persuna`, description: p.headline ?? undefined },
  };
}

function Stars({ rating }: { rating: number }) {
  return (
    <span aria-label={`${rating} out of 5`} className="text-warn">
      {"★".repeat(rating)}
      <span className="text-line-strong">{"★".repeat(5 - rating)}</span>
    </span>
  );
}

function Section({
  id,
  title,
  children,
}: {
  id: string;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section className="space-y-4" aria-labelledby={id}>
      <h2 id={id} className="font-display text-2xl font-medium tracking-[-0.02em]">
        {title}
      </h2>
      {children}
    </section>
  );
}

/**
 * Someone's public profile, for clients deciding who to hire and people
 * renting their skills: who they are, their portfolio, their skills (with
 * Persuna's scores), and how they did on projects as a seller and as a client.
 * Nothing private: no email, no job or project material.
 */
export default async function PublicProfilePage({ params }: Params) {
  const { handle } = await params;
  const p = await orNotFound(() => personProfile(handle));
  const persuna = p.persuna;
  const stats: [string, string, string][] = [
    ["Skills for hire", String(persuna.skills.length), `${persuna.jobsDone} tasks delivered`],
    [
      "Skill rating",
      persuna.averageRating ? `${persuna.averageRating} / 5` : "None yet",
      `${persuna.reviews.length} review${persuna.reviews.length === 1 ? "" : "s"}`,
    ],
    [
      "Projects as seller",
      String(p.asSeller.completed),
      p.asSeller.rating.average ? `${p.asSeller.rating.average} / 5 from clients` : "completed",
    ],
    [
      "Projects as client",
      String(p.asClient.posted),
      p.asClient.rating.average
        ? `${p.asClient.rating.average} / 5 from sellers`
        : `${p.asClient.completed} completed`,
    ],
  ];

  return (
    <div className="mx-auto max-w-5xl space-y-12 px-4 py-12 sm:px-8">
      <header className="flex flex-wrap items-start gap-6">
        <span className="grid h-20 w-20 shrink-0 place-items-center rounded-full bg-accent font-display text-2xl font-semibold text-accent-ink">
          {initialsOf(p.name, "?")}
        </span>
        <div className="min-w-0 flex-1">
          <p className="label-mono text-faint">Persuna profile</p>
          <h1 className="mt-1 font-display text-3xl font-medium tracking-[-0.03em] sm:text-4xl">
            {p.name}
          </h1>
          {p.headline && <p className="mt-1 text-lg text-muted">{p.headline}</p>}
          <p className="label-mono mt-3 flex flex-wrap gap-x-4 gap-y-1 text-faint">
            {p.location && <span>{p.location}</span>}
            <span>
              Member since{" "}
              {p.memberSince.toLocaleDateString("en-GB", { month: "long", year: "numeric" })}
            </span>
            {p.website && (
              <a
                href={p.website}
                rel="nofollow noopener noreferrer"
                target="_blank"
                className="text-accent hover:underline"
              >
                {new URL(p.website).hostname} ↗
              </a>
            )}
          </p>
        </div>
        <Card className="flex items-center gap-3 p-3 pr-5">
          <PersunaOrb look={persuna.avatar} size={44} animate={false} />
          <span className="text-sm">
            <span className="label-mono block text-faint">Their Persuna</span>
            {persuna.name}, trained on their own work
          </span>
        </Card>
      </header>

      {p.bio && (
        <p className="max-w-3xl whitespace-pre-line text-[1.02rem] leading-relaxed">{p.bio}</p>
      )}

      <dl className="grid gap-px overflow-hidden rounded-md border border-line bg-line sm:grid-cols-2 lg:grid-cols-4">
        {stats.map(([label, value, hint]) => (
          <div key={label} className="bg-card p-5">
            <dt className="label-mono text-faint">{label}</dt>
            <dd className="mt-1 font-display text-2xl font-medium tracking-[-0.02em]">{value}</dd>
            <dd className="text-xs text-muted">{hint}</dd>
          </div>
        ))}
      </dl>

      <Section id="portfolio-heading" title="Portfolio">
        {p.portfolio.length === 0 ? (
          <p className="text-sm text-muted">No portfolio pieces yet.</p>
        ) : (
          <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {p.portfolio.map((item) => (
              <li key={item.id}>
                <Card className="flex h-full flex-col overflow-hidden">
                  {item.imageUrl ? (
                    // Pictures live on the person's own site; they're shown as they are.
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={item.imageUrl}
                      alt=""
                      loading="lazy"
                      className="aspect-[16/10] w-full border-b border-line object-cover"
                    />
                  ) : (
                    <div className="hatch grid aspect-[16/10] place-items-center border-b border-line font-display text-4xl text-faint">
                      {item.title[0]}
                    </div>
                  )}
                  <div className="flex flex-1 flex-col gap-2 p-4">
                    <p className="font-display text-lg font-medium tracking-[-0.01em]">
                      {item.title}
                    </p>
                    {item.description && (
                      <p className="flex-1 text-sm text-muted">{item.description}</p>
                    )}
                    <div className="flex flex-wrap items-center gap-2">
                      {item.skill && <Badge tone="accent">{item.skill}</Badge>}
                      {item.link && (
                        <a
                          href={item.link}
                          target="_blank"
                          rel="nofollow noopener noreferrer"
                          className="label-mono ml-auto text-accent hover:underline"
                        >
                          See the work ↗
                        </a>
                      )}
                    </div>
                  </div>
                </Card>
              </li>
            ))}
          </ul>
        )}
      </Section>

      <Section id="skills-heading" title="Skills for hire">
        {persuna.skills.length === 0 ? (
          <p className="text-sm text-muted">No skills listed yet.</p>
        ) : (
          <ul className="grid gap-4 sm:grid-cols-2">
            {persuna.skills.map((s) => (
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
                  <CompositeLine composite={s.composite} />
                  <div className="flex items-end justify-between border-t border-line pt-3">
                    <span>
                      <span className="label-mono block text-faint">Per task</span>
                      <span className="font-display text-xl">{formatUsd(s.priceCents)}</span>
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
      </Section>

      {p.asClient.open.length > 0 && (
        <Section id="open-heading" title="Open projects they've posted">
          <ul className="grid gap-3 sm:grid-cols-2">
            {p.asClient.open.map((o) => (
              <li key={o.id}>
                <Link href={`/projects/${o.id}`}>
                  <Card className="flex items-center justify-between p-4 hover:border-accent/50">
                    <span className="font-medium">{o.title}</span>
                    <span className="label-mono text-muted">{formatUsd(o.budgetCents)}</span>
                  </Card>
                </Link>
              </li>
            ))}
          </ul>
        </Section>
      )}

      <Section id="reviews-heading" title="Reviews">
        {persuna.reviews.length + p.asSeller.reviews.length + p.asClient.reviews.length === 0 ? (
          <p className="text-sm text-muted">No reviews yet.</p>
        ) : (
          <div className="grid gap-6 lg:grid-cols-3">
            {(
              [
                [
                  "Renting their skills",
                  persuna.reviews.map((r) => ({ ...r, about: `${r.renter} · ${r.skill}` })),
                ],
                [
                  "Projects they delivered",
                  p.asSeller.reviews.map((r) => ({ ...r, about: r.project })),
                ],
                ["As a client", p.asClient.reviews.map((r) => ({ ...r, about: r.project }))],
              ] as const
            ).map(([title, list]) => (
              <div key={title} className="space-y-3">
                <p className="label-mono text-faint">{title}</p>
                {list.length === 0 && <p className="text-sm text-muted">None yet.</p>}
                {list.map((r, i) => (
                  <Card key={i} className="p-4 text-sm">
                    <Stars rating={r.rating} />
                    <p className="label-mono mt-1 text-faint">
                      {r.about} · {r.date.toLocaleDateString("en-GB", { dateStyle: "medium" })}
                    </p>
                    {r.comment && <p className="mt-2 text-muted">{r.comment}</p>}
                  </Card>
                ))}
              </div>
            ))}
          </div>
        )}
      </Section>
    </div>
  );
}
