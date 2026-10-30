import { z } from "zod";
import { catalogRoles, type CatalogRole } from "@/lib/models/selection";

/**
 * Admin action forms. Money moves only with an explicit confirmation box
 * ticked; every parser throws ZodError, which the action surface as an
 * inline message.
 */
const confirm = z.literal("on", { error: "Tick the confirmation box." });

export function parseTakedownForm(input: unknown): {
  skillId: string;
  active: boolean;
  reason?: string;
} {
  const parsed = z
    .object({
      skillId: z.uuid(),
      intent: z.enum(["takedown", "reinstate"]),
      reason: z.string().trim().max(200).optional(),
    })
    .parse(input);
  return {
    skillId: parsed.skillId,
    active: parsed.intent === "reinstate",
    reason: parsed.reason || undefined,
  };
}

export function parseDisputeForm(input: unknown): {
  milestoneId: string;
  decision: "release" | "refund";
} {
  const parsed = z
    .object({ milestoneId: z.uuid(), intent: z.enum(["release", "refund"]), confirm })
    .parse(input);
  return { milestoneId: parsed.milestoneId, decision: parsed.intent };
}

export function parseResumeForm(input: unknown): { projectId: string } {
  return z.object({ projectId: z.uuid() }).parse(input);
}

export function parseRefundForm(input: unknown): { jobId: string; note: string } {
  const parsed = z
    .object({
      jobId: z.uuid(),
      note: z.string().trim().min(3, "Say why in a few words.").max(120),
      confirm,
    })
    .parse(input);
  return { jobId: parsed.jobId, note: parsed.note };
}

const roleField = z.enum(catalogRoles);

export function parseCatalogEntryForm(input: unknown): {
  role: CatalogRole;
  label: string;
  model: string;
} {
  return z
    .object({
      role: roleField,
      label: z.string().trim().min(2, "Name the entry.").max(60),
      model: z.string().trim().min(1, "Give the provider model id.").max(120),
    })
    .parse(input);
}

export function parseSelectForm(input: unknown): { role: CatalogRole; entryId: string } {
  return z.object({ role: roleField, entryId: z.uuid() }).parse(input);
}

export function parseRevertForm(input: unknown): { role: CatalogRole } {
  return z.object({ role: roleField }).parse(input);
}

export function parseCatalogToggleForm(input: unknown): { entryId: string; enabled: boolean } {
  const parsed = z
    .object({ entryId: z.uuid(), intent: z.enum(["enable", "disable"]) })
    .parse(input);
  return { entryId: parsed.entryId, enabled: parsed.intent === "enable" };
}

export function parseDeleteEntryForm(input: unknown): { entryId: string } {
  return z.object({ entryId: z.uuid() }).parse(input);
}

export function parseProbeForm(input: unknown): { role: CatalogRole; model: string } {
  return z.object({ role: roleField, model: z.string().trim().min(1).max(120) }).parse(input);
}

export function parseRevokeKeyForm(input: unknown): { keyId: string } {
  return z.object({ keyId: z.uuid() }).parse(input);
}

export function parseRetryImportForm(input: unknown): { importId: string } {
  return z.object({ importId: z.uuid() }).parse(input);
}
