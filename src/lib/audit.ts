import { and, desc, eq, type SQL } from "drizzle-orm";
import { db, schema } from "@/db/client";

const { auditEvents } = schema;

/** Who acted. Single-owner build: "owner", a renter by name, the employer, or the system. */
export type Actor = "owner" | "system" | "employer" | `renter:${string}`;

export interface AuditInput {
  actor: Actor;
  action: string;
  entityType: "skill" | "pair" | "version" | "correction" | "job" | "listing" | "transaction";
  entityId?: string | null;
  skillId?: string | null;
  /** Small facts only (ids, scores, statuses). Never job text or pair content. */
  details?: Record<string, unknown>;
}

type Executor = Pick<ReturnType<typeof db>, "insert">;

/** Records one event. Pass a transaction as `tx` to commit it with the change it describes. */
export async function audit(event: AuditInput, tx: Executor = db()) {
  await tx.insert(auditEvents).values({
    actor: event.actor,
    action: event.action,
    entityType: event.entityType,
    entityId: event.entityId ?? null,
    skillId: event.skillId ?? null,
    details: event.details ?? {},
  });
}

export async function listAuditEvents(filter: { skillId?: string; limit?: number } = {}) {
  const where: SQL[] = [];
  if (filter.skillId) where.push(eq(auditEvents.skillId, filter.skillId));
  return db()
    .select()
    .from(auditEvents)
    .where(where.length ? and(...where) : undefined)
    .orderBy(desc(auditEvents.at))
    .limit(filter.limit ?? 200);
}
