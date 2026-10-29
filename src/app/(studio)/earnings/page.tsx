import type { Metadata } from "next";
import Link from "next/link";
import { Badge, Card, PageHeader } from "@/components/ui";
import { formatMoney, formatUsd } from "@/lib/money";
import { visibleSkillIds } from "@/lib/auth/access";
import { requireUser } from "@/lib/auth/session";
import { earnings } from "@/lib/market/service";
import { MILESTONE_STATUS } from "@/components/projects";
import { projectEarnings } from "@/lib/projects/service";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Earnings" };

const STATUS = {
  pending: { tone: "neutral", label: "awaiting payment" },
  held: { tone: "warn", label: "held in escrow" },
  released: { tone: "good", label: "paid out" },
  refunded: { tone: "neutral", label: "refunded" },
} as const;

export default async function EarningsPage() {
  const user = await requireUser();
  const { rows, totals, legacyNgn } = await earnings(await visibleSkillIds(user));
  const milestones = await projectEarnings(user.id);

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Studio · Earnings"
        title="Earnings"
        description="Earnings from rented jobs and project milestones. With Paystack switched on, payments are real; payouts to you are settled from the Paystack dashboard."
      />

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Stat label="Earned by you" value={formatUsd(totals.released)} />
        <Stat label="Held until renters accept" value={formatUsd(totals.held)} />
        <Stat label="Employer share" value={formatUsd(totals.employer)} />
        <Stat label="Platform fees" value={formatUsd(totals.platformFees)} />
      </div>
      {legacyNgn && (
        <p className="text-sm text-muted">
          Before the marketplace moved to US dollars you earned{" "}
          {formatMoney(legacyNgn.released, "NGN")} in naira
          {legacyNgn.held ? `, with ${formatMoney(legacyNgn.held, "NGN")} still held` : ""}. Those
          payments are shown in naira below.
        </p>
      )}

      {rows.length === 0 ? (
        <p className="text-sm text-muted">No rented jobs yet.</p>
      ) : (
        <Card className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead className="border-b border-line label-mono text-muted">
              <tr>
                <th className="p-3 font-semibold">Listing</th>
                <th className="p-3 font-semibold">Renter</th>
                <th className="p-3 text-right font-semibold">Paid</th>
                <th className="p-3 text-right font-semibold">Fee</th>
                <th className="p-3 text-right font-semibold">You get</th>
                <th className="p-3 font-semibold">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {rows.map(({ transaction: t, listing }) => (
                <tr key={t.id}>
                  <td className="p-3">
                    {t.jobId ? (
                      <Link href={`/jobs/${t.jobId}`} className="hover:underline">
                        {listing.title}
                      </Link>
                    ) : (
                      <span title="Job deleted after the retention period">{listing.title}</span>
                    )}
                  </td>
                  <td className="p-3">{t.renterName}</td>
                  <td className="p-3 text-right tabular-nums">
                    {formatMoney(t.amountCents, t.currency)}
                  </td>
                  <td className="p-3 text-right tabular-nums text-muted">
                    {formatMoney(t.platformFeeCents, t.currency)}
                  </td>
                  <td className="p-3 text-right font-medium tabular-nums">
                    {formatMoney(t.ownerShareCents, t.currency)}
                  </td>
                  <td className="p-3">
                    <Badge tone={STATUS[t.status].tone}>{STATUS[t.status].label}</Badge>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      )}

      {milestones.length > 0 && (
        <section className="space-y-3">
          <h2 className="font-display text-2xl font-medium tracking-[-0.02em]">
            Project milestones
          </h2>
          <Card className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead className="border-b border-line label-mono text-muted">
                <tr>
                  <th className="p-3 font-semibold">Project</th>
                  <th className="p-3 font-semibold">Milestone</th>
                  <th className="p-3 text-right font-semibold">Amount</th>
                  <th className="p-3 text-right font-semibold">You get</th>
                  <th className="p-3 font-semibold">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {milestones.map(({ milestone: m, project }) => (
                  <tr key={m.id}>
                    <td className="p-3">
                      <Link href={`/projects/${project.id}`} className="hover:underline">
                        {project.title}
                      </Link>
                    </td>
                    <td className="p-3">{m.title}</td>
                    <td className="p-3 text-right tabular-nums">{formatUsd(m.amountCents)}</td>
                    <td className="p-3 text-right font-medium tabular-nums">
                      {m.sellerShareCents !== null ? formatUsd(m.sellerShareCents) : "–"}
                    </td>
                    <td className="p-3">
                      <Badge tone={MILESTONE_STATUS[m.status].tone}>
                        {MILESTONE_STATUS[m.status].label}
                      </Badge>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Card>
        </section>
      )}
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <Card className="p-4">
      <p className="label-mono text-muted">{label}</p>
      <p className="mt-2 font-display text-2xl font-medium tabular-nums tracking-[-0.02em]">
        {value}
      </p>
    </Card>
  );
}
