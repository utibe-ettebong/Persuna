import { and, eq } from "drizzle-orm";
import { db } from "@/db/client";
import { skillVersions, skills } from "@/db/schema";
import { audit } from "@/lib/audit";
import type { ModelClient } from "@/lib/models/gateway";
import { draftGrounded } from "@/lib/skill/engine";
import { closestPairs } from "@/lib/skill/retrieve";
import { trainingPairs } from "@/lib/skill/service";

/** How the plugin should place the returned text in the open document. */
export type PluginEditOp = "replace_selection" | "insert_after" | "append";

export interface PluginEdit {
  op: PluginEditOp;
  text: string;
}

export type ApplySkillResult =
  { ok: true; edits: PluginEdit[] } | { ok: false; status: 404 | 422; errors: string[] };

/**
 * Runs one of the key owner's published skills over document text and returns
 * the result as a structured edit list. Nothing is persisted: the document
 * content lives only for this request, and the audit row holds ids only.
 */
export async function applySkillForKey(
  client: ModelClient,
  key: { userId: string; agentName: string },
  slug: string,
  text: string,
  opts?: { instruction?: string; mode?: PluginEditOp; source?: string },
): Promise<ApplySkillResult> {
  const skill = await db().query.skills.findFirst({
    where: and(eq(skills.ownerId, key.userId), eq(skills.slug, slug)),
  });
  if (!skill) return { ok: false, status: 404, errors: [`No skill "${slug}" for this key`] };
  if (!skill.publishedVersionId) {
    return { ok: false, status: 422, errors: [`Skill "${slug}" is not published yet`] };
  }
  const version = await db().query.skillVersions.findFirst({
    where: eq(skillVersions.id, skill.publishedVersionId),
  });
  if (!version) return { ok: false, status: 422, errors: [`Skill "${slug}" is not published yet`] };

  const instruction = opts?.instruction?.trim() ? `${opts.instruction.trim()}\n\n` : "";
  const input = `${instruction}${text}`;
  const shots = closestPairs(input, await trainingPairs(skill.id), 3);
  const { draft } = await draftGrounded(client, version.sheet, shots, input);

  await audit({
    actor: `agent:${key.agentName}`,
    action: "plugin.run",
    entityType: "skill",
    entityId: skill.id,
    details: { slug, edits: 1, ...(opts?.source ? { source: opts.source } : {}) },
  });
  return { ok: true, edits: [{ op: opts?.mode ?? "replace_selection", text: draft }] };
}
