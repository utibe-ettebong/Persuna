import type { Metadata } from "next";
import Link from "next/link";
import { resolveDisputeAction, resumeProjectAction } from "@/app/actions/admin";
import { ActionForm } from "@/components/action-form";
import { Badge, Card, PageHeader } from "@/components/ui";
import { disputeTotals } from "@/lib/admin/rules";
import { HELD } from "@/lib/projects/rules";
import { listDisputedProjects } from "@/lib/projects/service";
import { formatUsd } from "@/lib/money";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Admin · Disputes" };

/** Disputed projects with milestone settlement. Admins only. Money moves here. */
export default async function AdminDisputesPage() {
  const disputes = await listDisputedProjects();
  return (
    <div className="space-y-6">
      <PageHeader
        back={{ href: "/admin", label: "Admin" }}
        title="Disputes"
        description={`${disputes.length.toLocaleString()} disputed projects. Each held milestone pays the seller or refunds the poster; settling twice is refused by the milestone state machine.`}
      />
      {disputes.length === 0 ? (
        <p className="text-sm text-muted">No disputed projects. Nothing needs settling.</p>
      ) : (
        disputes.map(({ project, posterEmail, milestones }) => {
          const totals = disputeTotals(milestones);
          return (
            <Card key={project.id} className="space-y-4 p-5">
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <h2 className="font-display text-xl font-medium tracking-[-0.02em]">
                  <Link
                    href={`/projects/${project.id}`}
                    className="hover:text-accent hover:underline"
                  >
                    {project.title}
                  </Link>
                </h2>
                <p className="font-mono text-xs text-muted">{posterEmail ?? "—"}</p>
              </div>
              <p className="text-sm text-muted">
                {totals.held} of {milestones.length} milestones still held (
                {formatUsd(totals.heldCents)}); {totals.settled} settled.
              </p>
              <div className="overflow-x-auto rounded-md border border-line">
                <table className="w-full text-left text-sm">
                  <thead className="label-mono border-b border-line text-muted">
                    <tr>
                      <th className="p-3 font-semibold">#</th>
                      <th className="p-3 font-semibold">Milestone</th>
                      <th className="p-3 font-semibold">Amount</th>
                      <th className="p-3 font-semibold">Status</th>
                      <th className="p-3 font-semibold">Settle</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-line">
                    {milestones.map((m) => {
                      const held = (HELD as string[]).includes(m.status);
                      return (
                        <tr key={m.id} className="align-top">
                          <td className="p-3 tabular-nums text-muted">{m.position}</td>
                          <td className="p-3 font-medium">{m.title}</td>
                          <td className="whitespace-nowrap p-3 tabular-nums">
                            {formatUsd(m.amountCents)}
                          </td>
                          <td className="whitespace-nowrap p-3">
                            <Badge
                              tone={m.status === "released" ? "good" : held ? "warn" : "neutral"}
                            >
                              {m.status.replace("_", " ")}
                            </Badge>
                          </td>
                          <td className="min-w-64 p-3">
                            {held ? (
                              <ActionForm
                                action={resolveDisputeAction}
                                pendingLabel="Settling…"
                                buttons={[
                                  { label: "Release", intent: "release", variant: "primary" },
                                  { label: "Refund", intent: "refund", variant: "danger" },
                                ]}
                              >
                                <input type="hidden" name="milestoneId" value={m.id} />
                                <label className="mb-2 flex items-center gap-2 text-xs text-muted">
                                  <input
                                    type="checkbox"
                                    name="confirm"
                                    value="on"
                                    required
                                    className="accent-[var(--accent)]"
                                  />
                                  I confirm this moves {formatUsd(m.amountCents)}
                                </label>
                              </ActionForm>
                            ) : (
                              <span className="text-xs text-faint">Settled</span>
                            )}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
              <ActionForm
                action={resumeProjectAction}
                pendingLabel="Resuming…"
                buttons={[{ label: "Resume project", variant: "secondary" }]}
              >
                <input type="hidden" name="projectId" value={project.id} />
              </ActionForm>
            </Card>
          );
        })
      )}
    </div>
  );
}
