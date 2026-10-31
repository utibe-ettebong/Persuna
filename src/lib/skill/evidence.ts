import { and, eq, inArray } from "drizzle-orm";
import { db, schema } from "@/db/client";
import { audit } from "@/lib/audit";
import type { RuleOp, SkillSheet } from "./types";

const { corrections, ruleEvidence, skillVersions } = schema;

type EvidenceSource = "episode" | "interview" | "correction";

/**
 * Which rules a proposal touches: added ids are the ones the proposed sheet
 * has that the previous one doesn't; updated ids come from the ops. Removed
 * rules take no evidence with them.
 */
export function touchedRuleIds(
  ops: RuleOp[],
  from: SkillSheet,
  proposed: SkillSheet,
): { added: string[]; updated: string[] } {
  const before = new Set(from.rules.map((rule) => rule.id));
  const added = proposed.rules.map((rule) => rule.id).filter((id) => !before.has(id));
  const updated = ops
    .filter((op) => op.op === "update")
    .map((op) => (op.op === "update" ? op.id : ""))
    .filter((id) => id.length > 0);
  return { added, updated };
}

/** Records that these rules are supported by this source (idempotent). */
export async function recordEvidence(
  skillId: string,
  ruleIds: string[],
  source: EvidenceSource,
  sourceId: string,
) {
  if (ruleIds.length === 0) return;
  const rows = await db()
    .select({ ruleId: ruleEvidence.ruleId })
    .from(ruleEvidence)
    .where(
      and(
        eq(ruleEvidence.skillId, skillId),
        eq(ruleEvidence.source, source),
        eq(ruleEvidence.sourceId, sourceId),
      ),
    );
  const seen = new Set(rows.map((row) => row.ruleId));
  const fresh = [...new Set(ruleIds)].filter((id) => !seen.has(id));
  if (fresh.length === 0) return;
  await db()
    .insert(ruleEvidence)
    .values(fresh.map((ruleId) => ({ skillId, ruleId, source, sourceId })));
}

/** How many independent sources support each rule of a skill. */
export async function evidenceCounts(skillId: string): Promise<Record<string, number>> {
  const rows = await db()
    .select({ ruleId: ruleEvidence.ruleId, source: ruleEvidence.source })
    .from(ruleEvidence)
    .where(eq(ruleEvidence.skillId, skillId));
  const byRule = new Map<string, Set<string>>();
  for (const row of rows) {
    const sources = byRule.get(row.ruleId) ?? new Set<string>();
    sources.add(row.source);
    byRule.set(row.ruleId, sources);
  }
  return Object.fromEntries([...byRule].map(([ruleId, sources]) => [ruleId, sources.size]));
}

/**
 * The owner accepted: the correction itself becomes a source for the rules it
 * added or changed (an independent confirmation, on top of what proposed them).
 */
export async function confirmEvidence(correctionId: string) {
  const [correction] = await db()
    .select()
    .from(corrections)
    .where(eq(corrections.id, correctionId))
    .limit(1);
  if (!correction) return;
  const [fromVersion] = await db()
    .select()
    .from(skillVersions)
    .where(eq(skillVersions.id, correction.fromVersionId))
    .limit(1);
  if (!fromVersion) return;
  const { added, updated } = touchedRuleIds(
    correction.ruleOps,
    fromVersion.sheet,
    correction.proposedSheet,
  );
  await recordEvidence(correction.skillId, [...added, ...updated], "correction", correction.id);
  await audit({
    actor: "owner",
    action: "evidence.confirmed",
    entityType: "correction",
    entityId: correction.id,
    skillId: correction.skillId,
    details: { rules: added.length + updated.length },
  });
}

/**
 * The owner rejected: evidence for proposed-only rules (added, never entered)
 * goes away with them. Evidence for existing rules stands — the observation
 * happened even if this proposal didn't land.
 */
export async function pruneEvidence(correctionId: string) {
  const [correction] = await db()
    .select()
    .from(corrections)
    .where(eq(corrections.id, correctionId))
    .limit(1);
  if (!correction) return;
  const [fromVersion] = await db()
    .select()
    .from(skillVersions)
    .where(eq(skillVersions.id, correction.fromVersionId))
    .limit(1);
  if (!fromVersion) return;
  const { added } = touchedRuleIds(correction.ruleOps, fromVersion.sheet, correction.proposedSheet);
  if (added.length === 0) return;
  await db()
    .delete(ruleEvidence)
    .where(and(eq(ruleEvidence.skillId, correction.skillId), inArray(ruleEvidence.ruleId, added)));
}
