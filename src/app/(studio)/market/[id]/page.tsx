import type { Metadata } from "next";
import { rentAction } from "@/app/actions/market";
import { ActionForm } from "@/components/action-form";
import { ScoreBadge } from "@/components/score-trend";
import { Markdown } from "@/components/markdown";
import { Badge, Card, Field, inputClass, PageHeader } from "@/components/ui";
import { orNotFound } from "@/lib/load";
import { formatNaira } from "@/lib/market/rules";
import { getActiveListing } from "@/lib/market/service";
import { env } from "@/env";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Listing" };

type Params = { params: Promise<{ id: string }> };

export default async function ListingDetailPage({ params }: Params) {
  const { id } = await params;
  const { listing, skill, score } = await orNotFound(() => getActiveListing(id), id);

  return (
    <div className="space-y-6">
      <PageHeader
        back={{ href: "/market", label: "Marketplace" }}
        title={listing.title}
        description={listing.description}
      />

      <div className="flex flex-wrap gap-2 text-sm">
        <Badge tone="accent">
          {skill.trustLevel === 0
            ? "owner-reviewed: every result is approved by the owner"
            : skill.trustLevel === 1
              ? "proven results auto-approved, others owner-reviewed"
              : "auto-approved, spot-checked by the owner"}
        </Badge>
        <Badge>
          replication score <ScoreBadge score={score} />
        </Badge>
        <Badge>about {listing.turnaroundHours}h turnaround</Badge>
        <Badge>
          {skill.inputType} → {skill.outputType}
        </Badge>
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <Card className="p-4">
          <h2 className="mb-2 label-mono text-muted">Sample output</h2>
          <Markdown text={listing.sampleOutput} />
        </Card>

        <Card className="p-5">
          <h2 className="font-display text-lg font-medium tracking-[-0.02em]">
            Rent for one task · {formatNaira(listing.priceNgn)}
          </h2>
          <p className="mt-1 text-sm text-muted">
            Payment is held until you accept the result.{" "}
            {env().PAYMENTS_PROVIDER === "paystack"
              ? "You pay securely through Paystack."
              : "Mock payments: no real money moves."}
          </p>
          <ActionForm
            action={rentAction}
            label={`Submit and pay ${formatNaira(listing.priceNgn)}`}
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
                className={inputClass}
              />
            </Field>
            <Field label="Email" hint="for your payment receipt">
              <input name="renterEmail" type="email" required className={inputClass} />
            </Field>
            <Field label={skill.inputType}>
              <textarea name="inputText" rows={8} className={`${inputClass} font-mono text-xs`} />
            </Field>
            <Field label="…or upload" hint=".md, .txt or .docx">
              <input
                type="file"
                name="inputFile"
                accept=".md,.markdown,.txt,.docx"
                className="mt-1 block w-full text-sm text-muted file:mr-3 file:rounded file:border file:border-line file:bg-subtle file:px-2 file:py-1"
              />
            </Field>
            {listing.premiumReviewNgn != null && (
              <label className="flex items-start gap-2 text-sm">
                <input type="checkbox" name="premiumReview" className="mt-1" />
                <span>
                  Guarantee the owner personally reviews my result (+
                  {formatNaira(listing.premiumReviewNgn)})
                </span>
              </label>
            )}
          </ActionForm>
        </Card>
      </div>
    </div>
  );
}
