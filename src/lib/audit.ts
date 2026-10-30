import { and, desc, eq, ilike, inArray, or, sql, type SQL } from "drizzle-orm";
import { db, schema } from "@/db/client";

const { auditEvents } = schema;

/** Who acted: a signed-in user ("user:email"), a renter by name, the employer, or the system. */
export type Actor =
  "owner" | "system" | "employer" | `renter:${string}` | `user:${string}` | `agent:${string}`;

export interface AuditInput {
  actor: Actor;
  action: string;
  entityType:
    | "skill"
    | "pair"
    | "version"
    | "correction"
    | "job"
    | "listing"
    | "transaction"
    | "connection"
    | "mcp_server"
    | "agent_key"
    | "agent_import"
    | "project"
    | "milestone"
    | "proposal"
    | "profile"
    | "portfolio_item"
    | "organisation"
    | "org_member"
    | "org_invite"
    | "org_role"
    | "org_skill"
    | "handbook_note"
    | "playbook"
    | "onboarding"
    | "user";
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

/**
 * Events for one skill, or for a set of skills plus the actor's own events
 * (what a non-admin may see). No filter returns everything (admins).
 */
export async function listAuditEvents(
  filter: {
    skillId?: string;
    skillIds?: string[];
    actor?: string;
    actorLike?: string;
    actionLike?: string;
    entityLike?: string;
    limit?: number;
  } = {},
) {
  const where: SQL[] = [];
  if (filter.skillId) where.push(eq(auditEvents.skillId, filter.skillId));
  if (filter.skillIds) {
    const mine = [
      ...(filter.skillIds.length ? [inArray(auditEvents.skillId, filter.skillIds)] : []),
      ...(filter.actor ? [eq(auditEvents.actor, filter.actor)] : []),
    ];
    where.push(mine.length ? or(...mine)! : sql`false`);
  }
  // Forgiving contains-filters for the admin console. Non-admin callers keep
  // the exact `actor` match above, so they never see other actors' events.
  if (filter.actorLike) where.push(ilike(auditEvents.actor, `%${filter.actorLike}%`));
  if (filter.actionLike) where.push(ilike(auditEvents.action, `%${filter.actionLike}%`));
  if (filter.entityLike) where.push(ilike(auditEvents.entityType, `%${filter.entityLike}%`));
  return db()
    .select()
    .from(auditEvents)
    .where(where.length ? and(...where) : undefined)
    .orderBy(desc(auditEvents.at))
    .limit(filter.limit ?? 200);
}
