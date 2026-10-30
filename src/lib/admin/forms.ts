import { z } from "zod";

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
