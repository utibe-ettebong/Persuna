import type { Metadata } from "next";
import Link from "next/link";
import { saveListingAction, toggleListingAction } from "@/app/actions/market";
import { ActionForm } from "@/components/action-form";
import { Badge, Card, Field, inputClass, PageHeader, SkillTabs } from "@/components/ui";
import { env } from "@/env";
import { orNotFound } from "@/lib/load";
import { formatNaira, splitPayment } from "@/lib/market/rules";
import { readiness } from "@/lib/market/service";
import { getSkillBySlug, listPairs } from "@/lib/skill/service";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ slug: string }> };

export async function generateMetadata({ params }: Params): Promise<Metadata> {
  const skill = await orNotFound(async () => getSkillBySlug((await params).slug));
  return { title: `Listing · ${skill.name}` };
}

export default async function ListingPage({ params }: Params) {
  const skill = await orNotFound(async () => getSkillBySlug((await params).slug));
  const { listing, score, requirements } = await readiness(skill.id);
  const samplePair = (await listPairs(skill.id))[0];
  const feePercent = env().PLATFORM_FEE_PERCENT;
  const example = listing
    ? splitPayment(
        listing.priceNgn,
        feePercent,
        listing.ownerType === "employee" ? (listing.employerSharePercent ?? 0) : 0,
      )
    : null;
  const appUrl = env().APP_URL?.replace(/\/+$/, "") ?? "";
  const livePayments = env().PAYMENTS_PROVIDER === "paystack";

  return (
    <div className="space-y-8">
      <PageHeader
        eyebrow="Skill"
        title={skill.name}
        description="Let others rent this skill per task. They get results, never your rules, examples or identity."
      />
      <SkillTabs slug={skill.slug} active="Listing" />

      <section className="grid gap-6 lg:grid-cols-[1fr_20rem]">
        <Card className="p-5">
          <ActionForm
            action={saveListingAction}
            label={listing ? "Save listing" : "Create listing"}
            pendingLabel="Saving…"
            className="space-y-4"
          >
            <input type="hidden" name="skillSlug" value={skill.slug} />
            <Field label="Title">
              <input
                name="title"
                required
                maxLength={120}
                defaultValue={listing?.title ?? skill.name}
                className={inputClass}
              />
            </Field>
            <Field label="What renters get">
              <textarea
                name="description"
                required
                rows={4}
                maxLength={2000}
                defaultValue={listing?.description ?? skill.taskDescription}
                className={inputClass}
              />
            </Field>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Price per task (₦)">
                <input
                  name="priceNgn"
                  type="number"
                  min={100}
                  step={100}
                  required
                  defaultValue={listing?.priceNgn ?? 5000}
                  className={inputClass}
                />
              </Field>
              <Field label="Turnaround (hours)">
                <input
                  name="turnaroundHours"
                  type="number"
                  min={1}
                  max={720}
                  required
                  defaultValue={listing?.turnaroundHours ?? 24}
                  className={inputClass}
                />
              </Field>
            </div>
            <Field label="Sample output" hint="anonymised; shown on the listing">
              <textarea
                name="sampleOutput"
                required
                rows={8}
                defaultValue={listing?.sampleOutput ?? samplePair?.output ?? ""}
                className={`${inputClass} font-mono text-xs`}
              />
            </Field>
            <Field label="You are listing as">
              <select
                name="ownerType"
                defaultValue={listing?.ownerType ?? "freelancer"}
                className={inputClass}
              >
                <option value="freelancer">A freelancer or independent professional</option>
                <option value="organisation">An organisation (authorised admin)</option>
                <option value="employee">An employee (needs employer approval)</option>
              </select>
            </Field>
            <fieldset className="grid gap-4 rounded-md border border-line p-3 sm:grid-cols-2">
              <legend className="px-1 text-xs text-muted">Employees only: who approves</legend>
              <Field label="Employer name">
                <input
                  name="employerName"
                  maxLength={120}
                  defaultValue={listing?.employerName ?? ""}
                  className={inputClass}
                />
              </Field>
              <Field label="Employer email">
                <input
                  name="employerEmail"
                  type="email"
                  defaultValue={listing?.employerEmail ?? ""}
                  className={inputClass}
                />
              </Field>
            </fieldset>
            <Field
              label="Guaranteed owner review (₦ extra)"
              hint="optional; leave empty to not offer it"
            >
              <input
                name="premiumReviewNgn"
                type="number"
                min={0}
                step={100}
                defaultValue={listing?.premiumReviewNgn ?? ""}
                className={inputClass}
              />
            </Field>
            <label className="flex items-start gap-2 text-sm">
              <input
                type="checkbox"
                name="declareOwnership"
                defaultChecked={Boolean(listing?.ownershipDeclaredAt)}
                className="mt-1"
              />
              <span>
                I confirm this method is mine to list, and the skill contains no client-confidential
                material.
              </span>
            </label>
          </ActionForm>
        </Card>

        <aside className="space-y-4">
          <Card className="p-4 text-sm">
            <h2 className="font-display text-lg font-medium tracking-[-0.02em]">
              Before it can go live
            </h2>
            <ul className="mt-3 space-y-2">
              {requirements.map((r) => (
                <li key={r.key} className="flex items-start gap-2">
                  <span aria-hidden className={r.met ? "text-good" : "text-muted"}>
                    {r.met ? "✓" : "○"}
                  </span>
                  <span className={r.met ? "" : "text-muted"}>
                    {r.label}
                    {r.key === "score" && score !== null && ` (now ${score.toFixed(1)})`}
                  </span>
                </li>
              ))}
            </ul>
            {listing && (
              <div className="mt-4 border-t border-line pt-4">
                <p className="mb-3 flex items-center gap-2">
                  Status:{" "}
                  {listing.active ? <Badge tone="good">live</Badge> : <Badge>not listed</Badge>}
                </p>
                <ActionForm
                  action={toggleListingAction}
                  pendingLabel="…"
                  buttons={[
                    listing.active
                      ? { label: "Take down", intent: "deactivate", variant: "secondary" }
                      : { label: "Go live", intent: "activate" },
                  ]}
                >
                  <input type="hidden" name="skillSlug" value={skill.slug} />
                </ActionForm>
                {listing.active && (
                  <Link
                    href={`/market/${listing.id}`}
                    className="mt-3 block text-accent hover:underline"
                  >
                    View public listing →
                  </Link>
                )}
              </div>
            )}
          </Card>
          {listing?.ownerType === "employee" && listing.employerToken && (
            <Card className="space-y-2 p-4 text-sm">
              <h2 className="font-display text-lg font-medium tracking-[-0.02em]">
                Employer approval
              </h2>
              <p className="flex items-center gap-2">
                {listing.employerName}:{" "}
                {listing.employerDecision === "approved" ? (
                  <Badge tone="good">approved, {listing.employerSharePercent}% share</Badge>
                ) : listing.employerDecision === "declined" ? (
                  <Badge tone="danger">declined</Badge>
                ) : (
                  <Badge tone="warn">waiting</Badge>
                )}
              </p>
              {listing.employerDecision === "pending" && (
                <>
                  <p className="text-muted">Send this link to {listing.employerEmail}:</p>
                  <code className="block break-all rounded bg-subtle p-2 text-xs">
                    {`${appUrl}/approvals/${listing.employerToken}`}
                  </code>
                </>
              )}
            </Card>
          )}
          {example && (
            <Card className="p-4 text-sm">
              <h2 className="font-display text-lg font-medium tracking-[-0.02em]">Per task</h2>
              <dl className="mt-2 space-y-1">
                <Row label="Renter pays" value={formatNaira(example.amountNgn)} />
                <Row
                  label={`Platform fee (${feePercent}%)`}
                  value={`−${formatNaira(example.platformFeeNgn)}`}
                />
                {example.employerShareNgn > 0 && (
                  <Row label="Employer share" value={`−${formatNaira(example.employerShareNgn)}`} />
                )}
                <Row label="You receive" value={formatNaira(example.ownerShareNgn)} strong />
              </dl>
              <p className="mt-2 text-xs text-muted">
                {livePayments
                  ? "Renters pay through Paystack."
                  : "Mock payments: no real money moves."}
              </p>
            </Card>
          )}
        </aside>
      </section>
    </div>
  );
}

function Row({ label, value, strong }: { label: string; value: string; strong?: boolean }) {
  return (
    <div className={`flex justify-between ${strong ? "font-semibold" : ""}`}>
      <dt className={strong ? "" : "text-muted"}>{label}</dt>
      <dd className="tabular-nums">{value}</dd>
    </div>
  );
}
