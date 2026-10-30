import type { Metadata } from "next";
import Link from "next/link";
import { refundJobAction } from "@/app/actions/admin";
import { ActionForm } from "@/components/action-form";
import { Badge, Card, PageHeader, type Tone } from "@/components/ui";
import { earnings } from "@/lib/market/service";
import { formatMoney, formatUsd } from "@/lib/money";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Admin · Transactions" };

type Search = { searchParams: Promise<{ status?: string }> };

const STATUSES = ["pending", "held", "released", "refunded"] as const;
type Status = (typeof STATUSES)[number];

const STATUS_TONE: Record<Status, Tone> = {
  pending: "neutral",
  held: "warn",
  released: "good",
  refunded: "accent",
};

const when = new Intl.DateTimeFormat("en-GB", { dateStyle: "medium" });

/** Every rented-job payment with refunds. Admins only. Money moves here. */
export default async function AdminTransactionsPage({ searchParams }: Search) {
  const params = await searchParams;
  const status = (STATUSES as readonly string[]).includes(params.status ?? "")
    ? (params.status as Status)
    : undefined;
  const { rows, totals, legacyNgn } = await earnings(null);
  const shown = status ? rows.filter((r) => r.transaction.status === status) : rows;
  const statusHref = (s: Status | undefined) =>
    s ? `/admin/transactions?status=${s}` : "/admin/transactions";
  return (
    <div className="space-y-6">
      <PageHeader
        back={{ href: "/admin", label: "Admin" }}
        title="Transactions"
        description={`${rows.length.toLocaleString()} payments. Refunds move real money on Paystack and always need a note plus the confirmation box.`}
      />
      <div className="grid gap-px overflow-hidden rounded-md border border-line bg-line sm:grid-cols-2 lg:grid-cols-4">
        {(
          [
            ["Held in escrow", totals.held],
            ["Released to owners", totals.released],
            ["Released to employers", totals.employer],
            ["Platform fees", totals.platformFees],
          ] as const
        ).map(([label, cents]) => (
          <div key={label} className="bg-card p-6">
            <p className="font-display text-3xl font-medium tracking-[-0.02em] tabular-nums">
              {formatUsd(cents)}
            </p>
            <p className="label-mono mt-2 text-muted">{label}</p>
          </div>
        ))}
      </div>
      {legacyNgn && (
        <p className="text-sm text-muted">
          Pre-switch naira payments (kobo): held {legacyNgn.held.toLocaleString()}, released{" "}
          {legacyNgn.released.toLocaleString()}.
        </p>
      )}
      <p className="flex flex-wrap gap-x-4 gap-y-1 text-sm">
        <FilterLink href={statusHref(undefined)} current={!status} label="All" />
        {STATUSES.map((s) => (
          <FilterLink key={s} href={statusHref(s)} current={status === s} label={s} />
        ))}
      </p>
      {shown.length === 0 ? (
        <p className="text-sm text-muted">No payments match.</p>
      ) : (
        <Card className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead className="label-mono border-b border-line text-muted">
              <tr>
                <th className="p-3 font-semibold">Date</th>
                <th className="p-3 font-semibold">Renter</th>
                <th className="p-3 font-semibold">Listing</th>
                <th className="p-3 font-semibold">Amount</th>
                <th className="p-3 font-semibold">Status</th>
                <th className="p-3 font-semibold">Refund</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {shown.map(({ transaction: t, listing }) => {
                const refundable = !!t.jobId && (t.status === "pending" || t.status === "held");
                return (
                  <tr key={t.id} className="align-top">
                    <td className="whitespace-nowrap p-3 tabular-nums text-muted">
                      {when.format(t.createdAt)}
                    </td>
                    <td className="p-3">{t.renterName}</td>
                    <td className="p-3">
                      <p className="font-medium">{listing.title}</p>
                      <p className="font-mono text-xs text-muted">
                        {t.provider} · {t.currency}
                      </p>
                    </td>
                    <td className="whitespace-nowrap p-3 tabular-nums">
                      {formatMoney(t.amountCents, t.currency)}
                    </td>
                    <td className="whitespace-nowrap p-3">
                      <Badge tone={STATUS_TONE[t.status]}>{t.status}</Badge>
                    </td>
                    <td className="min-w-56 p-3">
                      {refundable ? (
                        <ActionForm
                          action={refundJobAction}
                          pendingLabel="Refunding…"
                          buttons={[{ label: "Refund", variant: "danger" }]}
                        >
                          <input type="hidden" name="jobId" value={t.jobId!} />
                          <input
                            name="note"
                            placeholder="Reason (kept in the audit log)"
                            maxLength={120}
                            required
                            minLength={3}
                            className="mb-2 mt-0 w-full rounded-md border border-line-strong bg-card px-3 py-2 text-sm placeholder:text-faint focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/20"
                            aria-label={`Refund reason for ${listing.title}`}
                          />
                          <label className="mb-2 flex items-center gap-2 text-xs text-muted">
                            <input
                              type="checkbox"
                              name="confirm"
                              value="on"
                              required
                              className="accent-[var(--accent)]"
                            />
                            I confirm this refund
                          </label>
                        </ActionForm>
                      ) : (
                        <span className="text-xs text-faint">
                          {t.jobId ? "Settled" : "Job purged"}
                        </span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </Card>
      )}
    </div>
  );
}

function FilterLink({ href, current, label }: { href: string; current: boolean; label: string }) {
  return current ? (
    <span className="font-medium text-foreground">{label}</span>
  ) : (
    <Link href={href} className="text-accent hover:underline">
      {label}
    </Link>
  );
}
