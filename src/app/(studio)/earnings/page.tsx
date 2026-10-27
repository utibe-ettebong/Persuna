import type { Metadata } from "next";
import Link from "next/link";
import { Badge, Card, PageHeader } from "@/components/ui";
import { formatNaira } from "@/lib/market/rules";
import { visibleSkillIds } from "@/lib/auth/access";
import { requireUser } from "@/lib/auth/session";
import { earnings } from "@/lib/market/service";

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
  const { rows, totals } = await earnings(await visibleSkillIds(user));

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Studio · Earnings"
        title="Earnings"
        description="Earnings from rented jobs. With Paystack switched on, payments are real; payouts to you are settled from the Paystack dashboard."
      />

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Stat label="Earned by you" value={formatNaira(totals.released)} />
        <Stat label="Held until renters accept" value={formatNaira(totals.held)} />
        <Stat label="Employer share" value={formatNaira(totals.employer)} />
        <Stat label="Platform fees" value={formatNaira(totals.platformFees)} />
      </div>

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
                  <td className="p-3 text-right tabular-nums">{formatNaira(t.amountNgn)}</td>
                  <td className="p-3 text-right tabular-nums text-muted">
                    {formatNaira(t.platformFeeNgn)}
                  </td>
                  <td className="p-3 text-right font-medium tabular-nums">
                    {formatNaira(t.ownerShareNgn)}
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
