import type { Metadata } from "next";
import { acceptOrderAction, complainAction } from "@/app/actions/market";
import { ActionForm } from "@/components/action-form";
import { Markdown } from "@/components/markdown";
import { Badge, buttonClass, Card, Field, inputClass, PageHeader } from "@/components/ui";
import { assertOrderAccess } from "@/lib/auth/access";
import { requireUser } from "@/lib/auth/session";
import { orNotFound } from "@/lib/load";
import { formatNaira } from "@/lib/market/rules";
import { getOrder } from "@/lib/market/service";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Your order" };

type Params = {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ payment?: string }>;
};

const ESCROW = {
  pending: { tone: "neutral", label: "awaiting payment" },
  held: { tone: "warn", label: "payment held" },
  released: { tone: "good", label: "paid to owner" },
  refunded: { tone: "neutral", label: "refunded" },
} as const;

/** The renter's page. Shows only the delivered result: never rules, examples or drafts. */
export default async function OrderPage({ params, searchParams }: Params) {
  const { id } = await params;
  const { payment } = await searchParams;
  const user = await requireUser();
  const order = await orNotFound(async () => {
    await assertOrderAccess(user, id);
    return getOrder(id);
  }, id);
  const escrow = ESCROW[order.escrow];

  return (
    <div className="max-w-3xl space-y-6">
      <PageHeader
        back={{ href: "/market", label: "Marketplace" }}
        title={order.listingTitle}
        description={`Order for ${order.renterName} · ${formatNaira(order.amountNgn)}`}
      />
      <div className="flex flex-wrap gap-2">
        {order.status === "awaiting_payment" && <Badge>waiting for payment</Badge>}
        {order.status === "review" && <Badge tone="accent">with the owner for review</Badge>}
        {order.premiumReview && <Badge tone="accent">guaranteed owner review</Badge>}
        {order.status === "approved" && <Badge tone="good">delivered</Badge>}
        {order.status === "rejected" && <Badge tone="danger">declined by the owner</Badge>}
        <Badge tone={escrow.tone}>{escrow.label}</Badge>
      </div>

      {payment === "unconfirmed" && (
        <p role="alert" className="rounded-md bg-warn/10 p-3 text-sm text-warn">
          We couldn&apos;t confirm your payment yet. If you were charged, it will be picked up
          automatically within a few minutes; refresh this page to check.
        </p>
      )}

      {order.status === "awaiting_payment" && (
        <Card className="p-5 text-sm text-muted">
          Your order is saved but the payment hasn&apos;t been confirmed. Work starts as soon as it
          is.
        </Card>
      )}

      {order.status === "review" && (
        <Card className="p-5 text-sm text-muted">
          The owner reviews every result before it reaches you. Bookmark this page to check back.
        </Card>
      )}

      {order.output && (
        <>
          <Card className="p-4">
            <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
              <h2 className="label-mono text-muted">Your result</h2>
              <span className="flex items-center gap-3 text-xs text-muted">
                {order.approvedBy === "auto"
                  ? "AI-produced, auto-approved under the owner's trust settings"
                  : "AI-produced, owner-approved"}
                <a
                  href={`/jobs/${order.id}/download?format=docx`}
                  className={buttonClass("secondary")}
                >
                  Download .docx
                </a>
              </span>
            </div>
            <Markdown text={order.output} />
          </Card>

          {order.escrow === "held" ? (
            <Card className="p-5">
              <h2 className="font-display text-lg font-medium tracking-[-0.02em]">
                Accept and rate
              </h2>
              <p className="mt-1 text-sm text-muted">
                Accepting releases the payment to the owner.
              </p>
              <ActionForm
                action={acceptOrderAction}
                label="Accept and release payment"
                pendingLabel="Saving…"
                className="mt-4 space-y-3"
              >
                <input type="hidden" name="jobId" value={order.id} />
                <fieldset>
                  <legend className="text-sm font-medium">Rating</legend>
                  <div className="mt-1 flex gap-3">
                    {[1, 2, 3, 4, 5].map((n) => (
                      <label key={n} className="flex items-center gap-1 text-sm">
                        <input
                          type="radio"
                          name="rating"
                          value={n}
                          required
                          defaultChecked={n === 5}
                        />{" "}
                        {n}
                      </label>
                    ))}
                  </div>
                </fieldset>
                <Field label="Comment" hint="optional">
                  <input name="comment" maxLength={1000} className={inputClass} />
                </Field>
              </ActionForm>
            </Card>
          ) : (
            order.rating && (
              <p className="text-sm text-muted">You rated this {order.rating}/5. Thank you.</p>
            )
          )}

          {order.escrow === "held" && !order.complaint && (
            <Card className="p-5">
              <details>
                <summary className="cursor-pointer text-sm font-medium">Report a problem</summary>
                <p className="mt-2 text-sm text-muted">
                  Something wrong with the result? Reporting it refunds your payment, and the owner
                  will review every future result for this skill again.
                </p>
                <ActionForm
                  action={complainAction}
                  label="Report and get a refund"
                  pendingLabel="Sending…"
                  variant="danger"
                  className="mt-3 space-y-3"
                >
                  <input type="hidden" name="jobId" value={order.id} />
                  <Field label="What went wrong?">
                    <textarea
                      name="complaint"
                      required
                      minLength={5}
                      maxLength={1000}
                      rows={3}
                      className={inputClass}
                    />
                  </Field>
                </ActionForm>
              </details>
            </Card>
          )}
          {order.complaint && (
            <p className="text-sm text-muted">You reported a problem and were refunded.</p>
          )}
        </>
      )}
    </div>
  );
}
