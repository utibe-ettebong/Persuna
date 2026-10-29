/**
 * Which skills are company know-how: attached to a role at an organisation.
 * The marketplace, public profiles and anything else public ask here before
 * showing a skill.
 */
import { eq, inArray } from "drizzle-orm";
import { db, schema } from "@/db/client";

const { orgRoleSkills, organisations } = schema;

/** Skill id → the organisation it's confidential to, for the given skills (all when omitted). */
export async function confidentialSkills(skillIds?: string[]): Promise<Map<string, string>> {
  if (skillIds && !skillIds.length) return new Map();
  const rows = await db()
    .select({ skillId: orgRoleSkills.skillId, org: organisations.name })
    .from(orgRoleSkills)
    .innerJoin(organisations, eq(orgRoleSkills.orgId, organisations.id))
    .where(skillIds ? inArray(orgRoleSkills.skillId, skillIds) : undefined);
  return new Map(rows.map((r) => [r.skillId, r.org]));
}

/** The organisation a skill is confidential to, or null when it's the person's own. */
export async function confidentialTo(skillId: string): Promise<string | null> {
  return (await confidentialSkills([skillId])).get(skillId) ?? null;
}
