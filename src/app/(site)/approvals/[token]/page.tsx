import type { Metadata } from "next";
import { employerDecisionAction } from "@/app/actions/market";
import { ActionForm } from "@/components/action-form";
import { Badge, Card, Field, inputClass, PageHeader } from "@/components/ui";
import { orNotFound } from "@/lib/load";
import { splitPayment } from "@/lib/market/rules";
import { formatUsd } from "@/lib/money";
import { getEmployerRequest } from "@/lib/market/service";
import { env } from "@/env";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Employer approval", robots: { index: false } };

type Params = { params: Promise<{ token: string }> };

/**
 * The employer's page, reached through the secret link the employee shares.
 * Open without the app password: the token is the credential.
 */
export default async function EmployerApprovalPage({ params }: Params) {
  const { token } = await params;
  const { listing, skill } = await orNotFound(() => getEmployerRequest(token));
  const example = splitPayment(listing.priceCents, env().PLATFORM_FEE_PERCENT);

  return (
    <div className="max-w-2xl space-y-6">
      <PageHeader
        title="Approve an employee's skill listing"
        description={`One of your employees wants to rent out “${skill.name}” on PERSUNA, a method they built while working for ${listing.employerName}.`}
      />

      <Card className="space-y-3 p-5 text-sm">
        <p>
          <span className="text-muted">Listing:</span> {listing.title}
        </p>
        <p className="text-muted">{listing.description}</p>
        <p>
          <span className="text-muted">Price per task:</span> {formatUsd(listing.priceCents)}. After
          the platform fee, {formatUsd(example.ownerShareCents)} per task is split between your
          employee and you.
        </p>
        <p className="text-muted">
          Renters get results only. They never see the method, the examples it learned from, or your
          clients&apos; material.
        </p>
      </Card>

      {listing.employerDecision === "pending" ? (
        <Card className="p-5">
          <ActionForm
            action={employerDecisionAction}
            pendingLabel="Saving…"
            className="space-y-4"
            buttons={[
              { label: "Approve listing", intent: "approved" },
              { label: "Decline", intent: "declined", variant: "danger" },
            ]}
          >
            <input type="hidden" name="token" value={token} />
            <Field
              label="Your share of each task's earnings (%)"
              hint="0 means the employee keeps all of it"
            >
              <input
                name="sharePercent"
                type="number"
                min={0}
                max={100}
                defaultValue={30}
                className={inputClass}
              />
            </Field>
          </ActionForm>
        </Card>
      ) : (
        <Card className="p-5 text-sm">
          {listing.employerDecision === "approved" ? (
            <p className="flex items-center gap-2">
              <Badge tone="good">approved</Badge> You approved this listing with a{" "}
              {listing.employerSharePercent}% share.
            </p>
          ) : (
            <p className="flex items-center gap-2">
              <Badge tone="danger">declined</Badge> You declined this listing. It can&apos;t go
              live.
            </p>
          )}
        </Card>
      )}
    </div>
  );
}
