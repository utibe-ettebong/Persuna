import type { Metadata } from "next";
import { AuditTable } from "@/components/audit-table";
import { PageHeader } from "@/components/ui";
import { listAuditEvents } from "@/lib/audit";
import { visibleSkillIds } from "@/lib/auth/access";
import { actorOf, requireUser } from "@/lib/auth/session";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Audit log" };

export default async function AuditPage() {
  const user = await requireUser();
  const skillIds = await visibleSkillIds(user);
  const events = await listAuditEvents(
    skillIds === null ? { limit: 500 } : { skillIds, actor: actorOf(user), limit: 500 },
  );
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
