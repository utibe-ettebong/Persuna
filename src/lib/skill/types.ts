import { z } from "zod";

export const RULE_CATEGORIES = [
  "structure",
  "content",
  "cut",
  "tone",
  "naming",
  "formatting",
] as const;

export const ruleCategory = z.enum(RULE_CATEGORIES);

export const rule = z.object({
  id: z.string().regex(/^R\d+$/, "Rule ids look like R1, R2, ..."),
  category: ruleCategory,
  text: z.string().min(1),
});

/** The plain-language skill sheet the owner can read and edit. */
export const skillSheet = z.object({
  summary: z.string().min(1),
  rules: z.array(rule).min(1),
  template: z.string().min(1),
  /**
   * Layer 4: tools the skill may use in the renter's apps, by name. Absent
   * or empty: any linked tool. Never accounts — those link to the job.
   */
  tools: z.array(z.string().trim().min(1).max(120)).max(50).optional(),
});

export const ruleOp = z.discriminatedUnion("op", [
  z.object({ op: z.literal("add"), category: ruleCategory, text: z.string().min(1) }),
  z.object({
    op: z.literal("update"),
    id: z.string(),
    category: ruleCategory.optional(),
    text: z.string().min(1),
  }),
  z.object({ op: z.literal("remove"), id: z.string() }),
]);

/** One turn of a tool-using job: call a tool, or finish with findings. */
export const toolLoopStep = z.discriminatedUnion("action", [
  z.object({
    action: z.literal("call"),
    tool: z.string().trim().min(1).max(120),
    /** MCP server name, for MCP tools; null for connected apps. */
    server: z.string().trim().max(80).nullish(),
    args: z.record(z.string(), z.unknown()).default({}),
  }),
  z.object({
    action: z.literal("done"),
    /** What the tools established, for the draft. Empty when nothing was needed. */
    findings: z.string().max(4000).default(""),
  }),
]);
export type ToolLoopStep = z.infer<typeof toolLoopStep>;

/** A tool a job may call: a connected app's tool, or an MCP server's. */
export interface ToolSpec {
  name: string;
  /** MCP server name, for MCP tools; null for connected apps. */
  server: string | null;
  description: string;
  /** Sends, creates, posts or pays: needs approval under the job's policy. */
  writes: boolean;
}

export const correctionProposal = z.object({
  explanation: z.string().min(1),
  ops: z.array(ruleOp).min(1),
  templateChange: z.string().nullable().optional(),
});

export const CRITERIA = ["structure", "content", "cuts", "tone", "naming"] as const;
export type Criterion = (typeof CRITERIA)[number];

/** Each criterion is scored 0–10 by the evaluator; the overall score is computed in code. */
export const scoreBreakdown = z.object({
  criteria: z.object(
    Object.fromEntries(CRITERIA.map((c) => [c, z.number().min(0).max(10)])) as Record<
      Criterion,
      z.ZodNumber
    >,
  ),
  missing: z.array(z.string()),
  extra: z.array(z.string()),
  ruleViolations: z.array(z.string()),
  rationale: z.string(),
});

export type Rule = z.infer<typeof rule>;
export type RuleCategory = z.infer<typeof ruleCategory>;
export type SkillSheet = z.infer<typeof skillSheet>;
export type RuleOp = z.infer<typeof ruleOp>;
export type CorrectionProposal = z.infer<typeof correctionProposal>;
export type ScoreBreakdown = z.infer<typeof scoreBreakdown>;

/** A before/after pair as the engine sees it, independent of storage. */
export interface Pair {
  id: string;
  slug: string;
  input: string;
  output: string;
}
