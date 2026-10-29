/**
 * Agent imports: the payload an outside agent sends, how its examples are
 * split for training and testing, simple quality checks, rate limits and the
 * verdict. Pure, so it is tested without a database.
 */
import { createHash, randomBytes } from "node:crypto";
import { z } from "zod";

export const SKILL_IMPORT_SCHEMA = "persuna.skill-import/v1";
export const MIN_EXAMPLES = 3;
export const MAX_EXAMPLES = 50;
/** Largest request body the API reads, in bytes. */
export const MAX_BODY_BYTES = 1_000_000;
/** Total characters across method and examples. */
export const MAX_TOTAL_CHARS = 400_000;
/** Imports one key may send per hour. */
export const IMPORTS_PER_HOUR = 10;
/** Imports one person may have in training or testing at once. */
export const MAX_IN_FLIGHT = 2;
/** An import with no progress for this long may be picked up again. */
export const STALE_AFTER_MS = 15 * 60_000;

const text = (max: number) => z.string().trim().min(1).max(max);

export const skillImportV1 = z
  .object({
    schema: z.literal(SKILL_IMPORT_SCHEMA, {
      error: `Set "schema": "${SKILL_IMPORT_SCHEMA}"`,
    }),
    agent: text(60),
    skill: z.object({
      name: z.string().trim().min(3).max(80),
      task: z.string().trim().min(10).max(1000),
      input: z.string().trim().min(2).max(60).optional(),
      output: z.string().trim().min(2).max(60).optional(),
    }),
    method: z.union([text(8000), z.array(text(1000)).min(1).max(40)]),
    examples: z
      .array(z.object({ input: text(20_000), output: text(20_000), test: z.boolean().optional() }))
      .min(MIN_EXAMPLES, `Send at least ${MIN_EXAMPLES} examples`)
      .max(MAX_EXAMPLES, `Send at most ${MAX_EXAMPLES} examples`),
  })
  .superRefine((p, ctx) => {
    const total =
      methodSteps(p.method).join("").length +
      p.examples.reduce((n, e) => n + e.input.length + e.output.length, 0);
    if (total > MAX_TOTAL_CHARS) {
      ctx.addIssue({
        code: "custom",
        message: `Too much text: ${total} characters (at most ${MAX_TOTAL_CHARS})`,
      });
    }
    const split = planSplit(p.examples);
    if (!split.ok) ctx.addIssue({ code: "custom", path: ["examples"], message: split.reason });
  });
export type SkillImport = z.infer<typeof skillImportV1>;

/** Validates a parsed JSON body; errors come back as short readable lines. */
export function parseSkillImport(
  body: unknown,
): { ok: true; value: SkillImport } | { ok: false; errors: string[] } {
  const result = skillImportV1.safeParse(body);
  if (result.success) return { ok: true, value: result.data };
  return {
    ok: false,
    errors: result.error.issues.slice(0, 10).map((i) => {
      const path = i.path.join(".");
      return path ? `${path}: ${i.message}` : i.message;
    }),
  };
}

/** The method as a list of steps, whichever shape it came in. */
export function methodSteps(method: string | string[]): string[] {
  const list = Array.isArray(method)
    ? method
    : method.split(/\r?\n+/).map((l) => l.replace(/^\s*(?:[-*•]|\d+[.)])\s*/, ""));
  return list.map((s) => s.trim()).filter(Boolean);
}

/** The method as the "steps" interview answer: one numbered step per line. */
export function methodAsInterview(method: string | string[]): string {
  return methodSteps(method)
    .map((s, i) => `${i + 1}. ${s}`)
    .join("\n");
}

/**
 * Which examples train the skill and which are held back to test it. The
 * agent's own `test` flags win; otherwise about a quarter (at least one) is
 * held back, spread evenly through the list. At least two always train.
 */
export function planSplit(
  examples: { test?: boolean }[],
): { ok: true; splits: ("train" | "test")[] } | { ok: false; reason: string } {
  const n = examples.length;
  const flagged = examples.filter((e) => e.test).length;
  if (flagged > 0) {
    if (n - flagged < 2) {
      return { ok: false, reason: "Leave at least 2 examples for training (test: false)" };
    }
    return { ok: true, splits: examples.map((e) => (e.test ? "test" : "train")) };
  }
  if (n < MIN_EXAMPLES) return { ok: false, reason: `Send at least ${MIN_EXAMPLES} examples` };
  const held = Math.min(n - 2, Math.max(1, Math.round(n / 4)));
  const picks = new Set(
    Array.from({ length: held }, (_, j) => Math.floor(((j + 1) * n) / (held + 1))),
  );
  return { ok: true, splits: examples.map((_, i) => (picks.has(i) ? "test" : "train")) };
}

/** Things worth telling the person about the examples, before any model looks at them. */
export function reviewExamples(examples: { input: string; output: string }[]): string[] {
  const problems: string[] = [];
  const seen = new Set<string>();
  let duplicates = 0;
  let unchanged = 0;
  let short = 0;
  for (const e of examples) {
    const key = e.input.trim().toLowerCase();
    if (seen.has(key)) duplicates++;
    seen.add(key);
    if (e.input.trim() === e.output.trim()) unchanged++;
    if (e.output.trim().length < 20) short++;
  }
  if (duplicates) problems.push(`${duplicates} example(s) repeat an earlier input`);
  if (unchanged) problems.push(`${unchanged} example(s) have an output identical to the input`);
  if (short) problems.push(`${short} example(s) have a very short output (under 20 characters)`);
  return problems;
}

/** Whether a key may send another import now. */
export function importAllowed(input: {
  sentLastHour: number;
  inFlight: number;
}): { ok: true } | { ok: false; reason: string; retryAfterSeconds: number } {
  if (input.sentLastHour >= IMPORTS_PER_HOUR) {
    return {
      ok: false,
      reason: `At most ${IMPORTS_PER_HOUR} imports an hour per key`,
      retryAfterSeconds: 3600,
    };
  }
  if (input.inFlight >= MAX_IN_FLIGHT) {
    return {
      ok: false,
      reason: `Persuna is still training ${input.inFlight} skills for this account; try again shortly`,
      retryAfterSeconds: 120,
    };
  }
  return { ok: true };
}

/** The verdict once tested: verified when the score reaches the listing minimum. */
export function importOutcome(score: number | null, minScore: number) {
  return score !== null && score >= minScore ? ("verified" as const) : ("below_minimum" as const);
}

/* ---------- Agent keys ---------- */

const TOKEN_PREFIX = "psk_";

export function newAgentToken(): string {
  return `${TOKEN_PREFIX}${randomBytes(32).toString("base64url")}`;
}

export const hashAgentToken = (token: string) => createHash("sha256").update(token).digest("hex");

/** The token from an `Authorization: Bearer psk_…` header, or null. */
export function bearerToken(header: string | null): string | null {
  const match = /^Bearer\s+(psk_[A-Za-z0-9_-]{20,100})\s*$/.exec(header ?? "");
  return match ? match[1] : null;
}
