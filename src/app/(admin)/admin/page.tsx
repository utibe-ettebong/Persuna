import type { Metadata } from "next";
import Link from "next/link";
import { Badge, Card, PageHeader } from "@/components/ui";
import { platformStats } from "@/lib/admin/stats";
import { formatUsd } from "@/lib/money";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Admin" };

/** Platform-wide counts and entry points. Admins only (see the layout). */
export default async function AdminPage() {
  const stats = await platformStats();
  const figures = [
    { label: "Accounts", value: stats.users.toLocaleString(), href: "/admin/users" },
    { label: "Live listings", value: stats.liveListings.toLocaleString() },
    { label: "Open projects", value: stats.openProjects.toLocaleString() },
    {
      label: "Disputed projects",
      value: stats.disputedProjects.toLocaleString(),
      alert: stats.disputedProjects > 0,
    },
    { label: "Held in escrow", value: formatUsd(stats.escrowHeldCents) },
    { label: "Model calls today", value: stats.modelCallsToday.toLocaleString() },
  ];
  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Admin"
        title="Overview"
        description="The whole platform at a glance. Moderation, disputes, money and models each get their own section next."
      />
      <div className="grid gap-px overflow-hidden rounded-md border border-line bg-line sm:grid-cols-2 lg:grid-cols-3">
        {figures.map((f) => {
          const body = (
            <>
              <p className="flex items-center gap-2">
                <span className="font-display text-3xl font-medium tracking-[-0.02em] tabular-nums">
                  {f.value}
                </span>
                {"alert" in f && f.alert && <Badge tone="warn">Needs review</Badge>}
              </p>
              <p className="label-mono mt-2 text-muted">{f.label}</p>
            </>
          );
          // Only Accounts has its section so far; the rest link up in later slices.
          return "href" in f && f.href ? (
            <Link
              key={f.label}
              href={f.href}
              className="bg-card p-6 transition-colors hover:bg-subtle"
            >
              {body}
            </Link>
          ) : (
            <div key={f.label} className="bg-card p-6">
              {body}
            </div>
          );
        })}
      </div>
      <Card className="space-y-2 p-5 text-sm">
        <p className="label-mono text-muted">Sections</p>
        <p>
          <Link href="/admin/users" className="text-accent hover:underline">
            Users
          </Link>{" "}
          <span className="text-muted">— every account, searchable, with suspension.</span>
        </p>
        <p>
          <Link href="/admin/audit" className="text-accent hover:underline">
            Audit log
          </Link>{" "}
          <span className="text-muted">— everything anyone did, filterable.</span>
        </p>
      </Card>
    </div>
  );
}
