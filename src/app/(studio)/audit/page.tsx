import type { Metadata } from "next";
import { AuditTable } from "@/components/audit-table";
import { PageHeader } from "@/components/ui";
import { listAuditEvents } from "@/lib/audit";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Audit log" };

export default async function AuditPage() {
  const events = await listAuditEvents({ limit: 500 });
  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Studio · Audit log"
        title="Audit log"
        description="Skill changes, approvals, listings and payments: who did what, and when. Never includes job text."
      />
      <AuditTable events={events} />
    </div>
  );
}
