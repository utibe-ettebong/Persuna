import type { Metadata } from "next";
import Link from "next/link";
import { cache } from "react";
import { rentAction } from "@/app/actions/market";
import { ActionForm } from "@/components/action-form";
import { FairDealPanel, RatingLine, Stars, VerifiedBadge } from "@/components/market";
import { Markdown } from "@/components/markdown";
import { PersonaOrb } from "@/components/persona/orb";
import { Badge, buttonClass, Card, Field, inputClass, PageHeader } from "@/components/ui";
import { env } from "@/env";
import { getUser } from "@/lib/auth/session";
import { TASK_FILE_ACCEPT } from "@/lib/docs/read-input";
import { orNotFound } from "@/lib/load";
import { MAX_REVISIONS } from "@/lib/market/rules";
import { getActiveListing } from "@/lib/market/service";
import { formatUsd } from "@/lib/money";
import { personasByOwner } from "@/lib/persona/service";
import { plural } from "@/lib/plural";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ id: string }> };

const load = cache((id: string) => orNotFound(() => getActiveListing(id), id));

export async function generateMetadata({ params }: Params): Promise<Metadata> {
  const { id } = await params;
  const { listing, verification, verified } = await load(id);
  const proof =
    verified && verification
      ? ` Persuna Verified: ${verification.score.toFixed(0)}/100 on held-back examples.`
      : "";
  const description = `${listing.description.slice(0, 200)}${proof} ${formatUsd(listing.priceCents)} per task.`;
  const appUrl = env().APP_URL?.replace(/\/+$/, "");
  return {
    title: listing.title,
    description,
    // Unlisted listings are for people with the link only.
    robots:
      listing.visibility === "public"
        ? { index: true, follow: true }
        : { index: false, follow: false },
    openGraph: {
      type: "website",
      siteName: "Persuna",
      title: `${listing.title} · ${formatUsd(listing.priceCents)} per task`,
      description,
      ...(appUrl ? { url: `${appUrl}/market/${listing.id}` } : {}),
    },
    twitter: { card: "summary", title: listing.title, description },
  };
}

export default async function ListingDetailPage({ params }: Params) {
  const { id } = await params;
  const { listing, skill, verification, verified, ratings, reviews, rentals } = await load(id);
  const user = await getUser();
  const seller = skill.ownerId ? (await personasByOwner([skill.ownerId])).get(skill.ownerId) : null;
  const signIn = `/sign-in?next=${encodeURIComponent(`/market/${listing.id}`)}`;

  return (
    <div className="space-y-6">
      <PageHeader
        back={{ href: "/market", label: "Marketplace" }}
        title={listing.title}
        description={listing.description}
      />

      <div className="flex flex-wrap items-center gap-2 text-sm">
        <VerifiedBadge verification={verification} verified={verified} />
        <Badge tone="accent">
          {skill.trustLevel === 0
            ? "owner-reviewed: every result is approved by the owner"
            : skill.trustLevel === 1
              ? "proven results auto-approved, others owner-reviewed"
              : "auto-approved, spot-checked by the owner"}
        </Badge>
        <Badge>about {listing.turnaroundHours}h turnaround</Badge>
        <Badge>
          {skill.inputType} → {skill.outputType}
        </Badge>
        {listing.visibility === "unlisted" && <Badge tone="warn">unlisted: link only</Badge>}
      </div>

      <div className="flex flex-wrap items-center gap-x-6 gap-y-2 text-sm text-muted">
        <RatingLine average={ratings.average} count={ratings.count} />
        <span>{plural(rentals, "paid rental")}</span>
        {seller?.handle && (
          <Link
            href={`/personas/${seller.handle}`}
            className="inline-flex items-center gap-2 hover:text-accent"
          >
            <PersonaOrb look={seller.avatar} size={22} animate={false} />
            by {seller.name} →
          </Link>
        )}
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <div className="space-y-6">
          <Card className="p-4">
            <h2 className="mb-2 label-mono text-muted">Sample output</h2>
            <Markdown text={listing.sampleOutput} />
          </Card>
          <FairDealPanel kind="rental" revisions={MAX_REVISIONS} />
        </div>

        <div className="space-y-6">
          <Card className="p-5">
            <h2 className="font-display text-lg font-medium tracking-[-0.02em]">
              Rent for one task · {formatUsd(listing.priceCents)}
            </h2>
            <p className="mt-1 text-sm text-muted">
              Payment is held until you accept the result.{" "}
              {env().PAYMENTS_PROVIDER === "paystack"
                ? "You pay securely through Paystack, in US dollars."
                : "Mock payments: no real money moves."}
            </p>
            {user ? (
              <ActionForm
                action={rentAction}
                label={`Submit and pay ${formatUsd(listing.priceCents)}`}
                pendingLabel="Submitting…"
                className="mt-4 space-y-4"
              >
                <input type="hidden" name="listingId" value={listing.id} />
                <Field label="Your name">
                  <input
                    name="renterName"
                    required
                    minLength={2}
                    maxLength={80}
                    defaultValue={user.name}
                    className={inputClass}
                  />
                </Field>
                <Field label="Email" hint="for your payment receipt">
                  <input
                    name="renterEmail"
                    type="email"
                    required
                    defaultValue={user.email}
                    className={inputClass}
                  />
                </Field>
                <Field label={skill.inputType}>
                  <textarea
                    name="inputText"
                    rows={8}
                    className={`${inputClass} font-mono text-xs`}
                  />
                </Field>
                <Field
                  label="…and/or upload"
                  hint="up to 5 files: text, Word, PDF, scans or photos"
                >
                  <input
                    type="file"
                    name="inputFile"
                    multiple
                    accept={TASK_FILE_ACCEPT}
                    className="mt-1 block w-full text-sm text-muted file:mr-3 file:rounded file:border file:border-line file:bg-subtle file:px-2 file:py-1"
                  />
                </Field>
                {listing.premiumReviewCents != null && (
                  <label className="flex items-start gap-2 text-sm">
                    <input type="checkbox" name="premiumReview" className="mt-1" />
                    <span>
                      Guarantee the owner personally reviews my result (+
                      {formatUsd(listing.premiumReviewCents)})
                    </span>
                  </label>
                )}
              </ActionForm>
            ) : (
              <div className="mt-4 flex flex-wrap gap-2">
                <Link href={signIn} className={buttonClass("primary")}>
                  Sign in to rent
                </Link>
                <Link
                  href={`/sign-up?next=${encodeURIComponent(`/market/${listing.id}`)}`}
                  className={buttonClass("secondary")}
                >
                  Create a free account
                </Link>
              </div>
            )}
          </Card>

          <Card className="p-5">
            <h2 className="font-display text-lg font-medium tracking-[-0.02em]">Reviews</h2>
            {reviews.length === 0 ? (
              <p className="mt-2 text-sm text-muted">No reviews yet.</p>
            ) : (
              <>
                <div className="mt-3 space-y-1 text-xs text-muted">
                  {[5, 4, 3, 2, 1].map((n) => {
                    const c = ratings.stars[n - 1];
                    return (
                      <div key={n} className="flex items-center gap-2">
                        <span className="w-6 tabular-nums">{n}★</span>
                        <span className="h-1.5 flex-1 rounded-sm bg-subtle">
                          <span
                            className="block h-1.5 rounded-sm bg-warn"
                            style={{ width: `${ratings.count ? (c / ratings.count) * 100 : 0}%` }}
                          />
                        </span>
                        <span className="w-6 text-right tabular-nums">{c}</span>
                      </div>
                    );
                  })}
                </div>
                <ul className="mt-4 space-y-3">
                  {reviews.map((r, i) => (
                    <li key={i} className="border-t border-line pt-3 text-sm">
                      <p>
                        <Stars rating={r.rating} />{" "}
                        <span className="label-mono ml-2 text-faint">
                          {r.renter}
                          {r.at &&
                            ` · ${r.at.toLocaleDateString("en-GB", { dateStyle: "medium" })}`}
                        </span>
                      </p>
                      {r.comment && <p className="mt-1 text-muted">{r.comment}</p>}
                    </li>
                  ))}
                </ul>
              </>
            )}
          </Card>
        </div>
      </div>
    </div>
  );
}
