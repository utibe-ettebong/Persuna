import type { Metadata } from "next";
import { setListingActiveAction } from "@/app/actions/admin";
import { ActionForm } from "@/components/action-form";
import { Badge, Card, inputClass, PageHeader, type Tone } from "@/components/ui";
import { listingStatus, type ListingStatus } from "@/lib/admin/rules";
import { listAllListings } from "@/lib/market/service";
import { formatUsd } from "@/lib/money";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Admin · Moderation" };

const STATUS_TONE: Record<ListingStatus, Tone> = {
  live: "good",
  unlisted: "accent",
  paused: "warn",
  inactive: "neutral",
};

const updated = new Intl.DateTimeFormat("en-GB", { dateStyle: "medium" });

/** Every marketplace listing with takedown and reinstate. Admins only. */
export default async function AdminModerationPage() {
  const rows = await listAllListings();
  return (
    <div className="space-y-6">
      <PageHeader
        back={{ href: "/admin", label: "Admin" }}
        title="Moderation"
        description={`${rows.length.toLocaleString()} listings. Takedowns are audited with the reason; reinstate fails loudly when a listing no longer meets every requirement.`}
      />
      {rows.length === 0 ? (
        <p className="text-sm text-muted">No listings yet.</p>
      ) : (
        <Card className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead className="label-mono border-b border-line text-muted">
              <tr>
                <th className="p-3 font-semibold">Listing</th>
                <th className="p-3 font-semibold">Owner</th>
                <th className="p-3 font-semibold">Price</th>
                <th className="p-3 font-semibold">Status</th>
                <th className="p-3 font-semibold">Updated</th>
                <th className="p-3 font-semibold">Action</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {rows.map((r) => {
                const status = listingStatus(r.listing);
                const live = r.listing.active;
                return (
                  <tr key={r.listing.id} className="align-top">
                    <td className="p-3">
                      <p className="font-medium">{r.listing.title}</p>
                      <p className="font-mono text-xs text-muted">{r.skillSlug}</p>
                    </td>
                    <td className="break-all p-3 font-mono text-xs text-muted">
                      {r.ownerEmail ?? "—"}
                    </td>
                    <td className="whitespace-nowrap p-3 tabular-nums">
                      {formatUsd(r.listing.priceCents)}
                    </td>
                    <td className="whitespace-nowrap p-3">
                      <Badge tone={STATUS_TONE[status]}>{status}</Badge>
                    </td>
                    <td className="whitespace-nowrap p-3 tabular-nums text-muted">
                      {updated.format(r.listing.updatedAt)}
                    </td>
                    <td className="min-w-52 p-3">
                      <ActionForm
                        action={setListingActiveAction}
                        pendingLabel="Saving…"
                        buttons={[
                          {
                            label: live ? "Take down" : "Reinstate",
                            intent: live ? "takedown" : "reinstate",
                            variant: live ? "danger" : "secondary",
                          },
                        ]}
                      >
                        <input type="hidden" name="skillId" value={r.listing.skillId} />
                        {live && (
                          <div className="mb-2">
                            <input
                              name="reason"
                              placeholder="Reason (kept in the audit log)"
                              maxLength={200}
                              className={inputClass}
                              aria-label={`Takedown reason for ${r.listing.title}`}
                            />
                          </div>
                        )}
                      </ActionForm>
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
