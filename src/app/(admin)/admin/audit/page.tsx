import type { Metadata } from "next";
import { AuditTable } from "@/components/audit-table";
import { buttonClass, inputClass, PageHeader } from "@/components/ui";
import { listAuditEvents } from "@/lib/audit";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Admin · Audit log" };

type Search = { searchParams: Promise<{ actor?: string; action?: string; entity?: string }> };

const clean = (value: string | undefined) =>
  value && value.trim() ? value.trim().slice(0, 120) : undefined;

/** Everything anyone did, filterable. Admins only (see the layout). */
export default async function AdminAuditPage({ searchParams }: Search) {
  const params = await searchParams;
  const actorLike = clean(params.actor);
  const actionLike = clean(params.action);
  const entityLike = clean(params.entity);
  const events = await listAuditEvents({ actorLike, actionLike, entityLike, limit: 200 });
  return (
    <div className="space-y-6">
      <PageHeader
        back={{ href: "/admin", label: "Admin" }}
        title="Audit log"
        description="Every recorded action across the platform, newest first. Never includes job text."
      />
      <form method="get" action="/admin/audit" className="flex flex-wrap items-end gap-2">
        <div className="min-w-40 flex-1">
          <input
            name="actor"
            defaultValue={actorLike ?? ""}
            placeholder="Who (email fragment)"
            maxLength={120}
            className={inputClass}
            aria-label="Filter by actor"
          />
        </div>
        <div className="min-w-40 flex-1">
          <input
            name="action"
            defaultValue={actionLike ?? ""}
            placeholder="What (action fragment)"
            maxLength={120}
            className={inputClass}
            aria-label="Filter by action"
          />
        </div>
        <div className="min-w-40 flex-1">
          <input
            name="entity"
            defaultValue={entityLike ?? ""}
            placeholder="On what (type fragment)"
            maxLength={120}
            className={inputClass}
            aria-label="Filter by entity type"
          />
        </div>
        <button type="submit" className={`${buttonClass("secondary")} mb-0.5 self-end`}>
          Filter
        </button>
      </form>
      <AuditTable events={events} />
    </div>
  );
}
