/**
 * "Bring your agent's skills": an outside AI agent (Grokbot, Musebot, Dot…)
 * sends what it has learned about how its person works, and Persuna turns it
 * into one of that person's skills the same way it would teach one: names
 * and identifiers redacted (method only), examples split into training and
 * held-back tests, rules extracted, tested, and a verdict against the listing
 * minimum. The person then publishes and lists it in one click.
 *
 * The slow part (model calls) runs after the API has answered. Each stage
 * records where it got to, so a crashed or interrupted import can be picked
 * up again, and any failure lands as status "failed" with a reason.
 */
import { and, count, desc, eq, gte, inArray, isNotNull, isNull, lt, or } from "drizzle-orm";
import { db, schema } from "@/db/client";
import type { AgentImport, AgentKey, ImportReport } from "@/db/schema";
import { env } from "@/env";
import { audit, type Actor } from "@/lib/audit";
import { slugify } from "@/lib/action-state";
import type { SessionUser } from "@/lib/auth/session";
import { userById } from "@/lib/auth/users";
import { readiness, saveListing, setListingActive } from "@/lib/market/service";
import { createModelClient } from "@/lib/models";
import type { ModelClient } from "@/lib/models/gateway";
import { sayToUser } from "@/lib/persona/service";
import { findNames, mapLimit } from "@/lib/skill/engine";
import { redactTogether, scanText } from "@/lib/skill/redact";
import {
  addPair,
  createSkill,
  extractVersion,
  latestScore,
  listPairs,
  NotFoundError,
  publishVersion,
  runEval,
  saveInterview,
} from "@/lib/skill/service";
import {
  hashAgentToken,
  importAllowed,
  importOutcome,
  methodAsInterview,
  methodSteps,
  newAgentToken,
  parseSkillImport,
  planSplit,
  reviewExamples,
  STALE_AFTER_MS,
  type SkillImport,
} from "./rules";

const { agentKeys, agentImports, skills } = schema;

const IN_FLIGHT = ["received", "training", "testing"] as const;

/* ---------- Keys ---------- */

/** Creates a key for one agent. The token is returned once and only its hash is kept. */
export async function createAgentKey(user: SessionUser, agentName: string, actor: Actor) {
  const name = agentName.trim().slice(0, 60);
  if (name.length < 2) throw new Error("Name the agent (e.g. Grokbot)");
  const token = newAgentToken();
  const [key] = await db()
    .insert(agentKeys)
    .values({
      userId: user.id,
      agentName: name,
      tokenHash: hashAgentToken(token),
      tokenHint: token.slice(-4),
    })
    .returning();
  await audit({
    actor,
    action: "agent_key.created",
    entityType: "agent_key",
    entityId: key.id,
    details: { agent: name },
  });
  return { key, token };
}

export async function listAgentKeys(userId: string) {
  return db()
    .select()
    .from(agentKeys)
    .where(eq(agentKeys.userId, userId))
    .orderBy(desc(agentKeys.createdAt));
}

export async function revokeAgentKey(userId: string, keyId: string, actor: Actor) {
  const [key] = await db()
    .update(agentKeys)
    .set({ revokedAt: new Date() })
    .where(and(eq(agentKeys.id, keyId), eq(agentKeys.userId, userId), isNull(agentKeys.revokedAt)))
    .returning();
  if (!key) throw new NotFoundError("No such key");
  await audit({
    actor,
    action: "agent_key.revoked",
    entityType: "agent_key",
    entityId: key.id,
    details: { agent: key.agentName },
  });
}

/** The live key behind a bearer token, or null. Marks it used. */
export async function authenticateAgent(token: string | null): Promise<AgentKey | null> {
  if (!token) return null;
  const [key] = await db()
    .update(agentKeys)
    .set({ lastUsedAt: new Date() })
    .where(and(eq(agentKeys.tokenHash, hashAgentToken(token)), isNull(agentKeys.revokedAt)))
    .returning();
  return key ?? null;
}

/* ---------- Receiving ---------- */

export type ReceiveResult =
  | { ok: true; import: AgentImport }
  | { ok: false; status: 400 | 429; errors: string[]; retryAfterSeconds?: number };

/**
 * Validates a submission and records it as received. With a key, the key's
 * rate limit applies. Nothing slow happens here: call processImport after.
 */
export async function receiveImport(input: {
  userId: string;
  key: AgentKey | null;
  body: unknown;
}): Promise<ReceiveResult> {
  const parsed = parseSkillImport(input.body);
  if (!parsed.ok) return { ok: false, status: 400, errors: parsed.errors };

  const hourAgo = new Date(Date.now() - 3_600_000);
  const [[{ sent }], [{ busy }]] = await Promise.all([
    input.key
      ? db()
          .select({ sent: count() })
          .from(agentImports)
          .where(
            and(eq(agentImports.agentKeyId, input.key.id), gte(agentImports.createdAt, hourAgo)),
          )
      : Promise.resolve([{ sent: 0 }]),
    db()
      .select({ busy: count() })
      .from(agentImports)
      .where(
        and(eq(agentImports.userId, input.userId), inArray(agentImports.status, [...IN_FLIGHT])),
      ),
  ]);
  const allowed = importAllowed({ sentLastHour: sent, inFlight: busy });
  if (!allowed.ok) {
    return {
      ok: false,
      status: 429,
      errors: [allowed.reason],
      retryAfterSeconds: allowed.retryAfterSeconds,
    };
  }

  // The agent named in the key is who sent it; the body's name is used for uploaded files.
  const agentName = input.key?.agentName ?? parsed.value.agent;
  const [row] = await db()
    .insert(agentImports)
    .values({
      userId: input.userId,
      agentKeyId: input.key?.id ?? null,
      agentName,
      payload: parsed.value,
      report: {
        examples: parsed.value.examples.length,
        methodSteps: methodSteps(parsed.value.method).length,
      },
    })
    .returning();
  await audit({
    actor: input.key ? `agent:${agentName}` : "owner",
    action: "agent_import.received",
    entityType: "agent_import",
    entityId: row.id,
    details: { agent: agentName, examples: parsed.value.examples.length, viaKey: !!input.key },
  });
  return { ok: true, import: row };
}

/* ---------- Training and testing ---------- */

/**
 * Takes an import as far as it can go: received → training → testing →
 * verified, or failed with a reason. Safe to call more than once and from
 * several places: only one caller claims the import at a time, and a claim
 * goes stale after STALE_AFTER_MS without progress so a crashed run can resume.
 */
export async function processImport(importId: string, client?: ModelClient) {
  const stale = new Date(Date.now() - STALE_AFTER_MS);
  const [claimed] = await db()
    .update(agentImports)
    .set({ status: "training", updatedAt: new Date() })
    .where(
      and(
        eq(agentImports.id, importId),
        or(
          eq(agentImports.status, "received"),
          and(
            inArray(agentImports.status, ["training", "testing"]),
            lt(agentImports.updatedAt, stale),
          ),
        ),
      ),
    )
    .returning();
  if (!claimed) return null;

  const actor: Actor = `agent:${claimed.agentName}`;
  let row = claimed;
  try {
    const owner = await userById(row.userId);
    if (!owner) throw new Error("The account this skill was sent to no longer exists");
    const models = client ?? createModelClient(owner);
    const minScore = env().LISTING_MIN_SCORE;

    // 1. Redact and save the examples and method to a new skill, then forget the submission.
    if (row.payload) row = await saveSubmission(models, row, actor);
    if (!row.skillId) throw new Error("The submission was lost before it was saved; send it again");
    const skill = await db().query.skills.findFirst({ where: eq(skills.id, row.skillId) });
    if (!skill) throw new Error("The skill made from this import was deleted");

    // 2. Train: extract rules from the training examples (and the method, as interview steps).
    let versionId = skill.currentVersionId;
    if (!versionId) {
      const version = await extractVersion(models, skill.slug);
      versionId = version.id;
      row = await progress(row, "testing", {
        rules: version.sheet.rules.length,
        version: version.version,
      });
      await audit({
        actor,
        action: "agent_import.trained",
        entityType: "agent_import",
        entityId: row.id,
        skillId: skill.id,
        details: { version: version.version, rules: version.sheet.rules.length },
      });
    } else if (row.status !== "testing") {
      row = await progress(row, "testing", {});
    }

    // 3. Test on the held-back examples (once per version).
    const score = (await latestScore(versionId)) ?? (await runEval(models, versionId)).meanScore;
    const outcome = importOutcome(score, minScore);
    const problems = [...(row.report.problems ?? [])];
    if (outcome === "below_minimum") {
      problems.push(
        `Scored ${score?.toFixed(0) ?? "nothing"} on held-back examples; listing needs ${minScore}. Add examples or correct its rules in the skill, then test again.`,
      );
    }
    row = await progress(row, outcome === "verified" ? "verified" : "failed", {
      score,
      minScore,
      outcome,
      problems,
    });
    await audit({
      actor,
      action: outcome === "verified" ? "agent_import.verified" : "agent_import.below_minimum",
      entityType: "agent_import",
      entityId: row.id,
      skillId: skill.id,
      details: { score, minScore, test: row.report.test ?? null },
    });
    await sayToUser(
      row.userId,
      outcome === "verified"
        ? `${row.agentName} sent "${skill.name}". I trained and tested it: ${score!.toFixed(0)}/100 on ${row.report.test ?? 0} held-back example(s). Publish and list it? It's under Skills → Import.`
        : `${row.agentName} sent "${skill.name}". I trained and tested it, but it scored ${score?.toFixed(0) ?? "nothing"}/100, below the ${minScore} a listing needs. Open the skill to add examples or correct its rules.`,
      skill.id,
    );
    return row;
  } catch (error) {
    const reason = (error as Error).message.slice(0, 300) || "Something went wrong";
    const [failed] = await db()
      .update(agentImports)
      .set({
        status: "failed",
        error: reason,
        payload: null,
        report: { ...row.report, outcome: "error" },
        updatedAt: new Date(),
      })
      .where(eq(agentImports.id, importId))
      .returning();
    await audit({
      actor,
      action: "agent_import.failed",
      entityType: "agent_import",
      entityId: importId,
      skillId: row.skillId,
      details: { reason: reason.slice(0, 120) },
    });
    return failed;
  }
}

/** Records progress (which also renews the claim). */
async function progress(row: AgentImport, status: AgentImport["status"], report: ImportReport) {
  const [next] = await db()
    .update(agentImports)
    .set({ status, report: { ...row.report, ...report }, updatedAt: new Date() })
    .where(eq(agentImports.id, row.id))
    .returning();
  return next;
}

/** How many example pairs go to the name finder in one call. */
const REDACT_BATCH = 8;

/**
 * Redacts names and identifiers (patterns plus names the model finds), creates
 * the skill, saves the method as interview steps and each example as a pair,
 * then clears the submission. Resumes cleanly if the skill already exists.
 */
async function saveSubmission(client: ModelClient, row: AgentImport, actor: Actor) {
  const submission = row.payload as SkillImport;
  const split = planSplit(submission.examples);
  if (!split.ok) throw new Error(split.reason);

  // Each batch of pairs (and the method, with the first batch) is checked for names in one call.
  const method = methodAsInterview(submission.method);
  const batches: { texts: string[] }[] = [];
  for (let i = 0; i < submission.examples.length; i += REDACT_BATCH) {
    const pairs = submission.examples.slice(i, i + REDACT_BATCH);
    batches.push({
      texts: [...(i === 0 ? [method] : []), ...pairs.flatMap((p) => [p.input, p.output])],
    });
  }
  const entityLists = await mapLimit(batches, env().MODEL_CONCURRENCY, (b) =>
    findNames(client, b.texts),
  );
  let redactions = 0;
  const redactPair = (texts: string[], batch: number) => {
    const entities = entityLists[batch];
    const findings = texts.map((t) => scanText(t, entities));
    redactions += findings.reduce((n, f) => n + f.length, 0);
    return redactTogether(texts, findings, entities);
  };
  const [cleanMethod] = redactPair([method], 0);
  const pairs = submission.examples.map((e, i) => {
    const [input, output] = redactPair([e.input, e.output], Math.floor(i / REDACT_BATCH));
    return {
      input,
      output,
      split: split.splits[i],
      slug: `agent-${String(i + 1).padStart(2, "0")}`,
    };
  });

  let skillId = row.skillId;
  if (!skillId) {
    const skill = await createSkill(
      {
        slug: slugify(submission.skill.name) || "agent-skill",
        name: submission.skill.name,
        taskDescription: submission.skill.task,
        inputType: submission.skill.input ?? "input",
        outputType: submission.skill.output ?? "output",
      },
      row.userId,
      actor,
    );
    skillId = skill.id;
    // Record the skill at once, so a crash below resumes on it instead of making another.
    await db()
      .update(agentImports)
      .set({ skillId, updatedAt: new Date() })
      .where(eq(agentImports.id, row.id));
  }
  await saveInterview(skillId, { steps: cleanMethod });
  const existing = new Set((await listPairs(skillId)).map((p) => p.slug));
  for (const pair of pairs) {
    if (!existing.has(pair.slug)) await addPair(skillId, { ...pair, redacted: true });
  }

  const report: ImportReport = {
    examples: pairs.length,
    train: split.splits.filter((s) => s === "train").length,
    test: split.splits.filter((s) => s === "test").length,
    methodSteps: methodSteps(submission.method).length,
    redactions,
    problems: reviewExamples(submission.examples),
  };
  const [saved] = await db()
    .update(agentImports)
    .set({ skillId, payload: null, report: { ...row.report, ...report }, updatedAt: new Date() })
    .where(eq(agentImports.id, row.id))
    .returning();
  await audit({
    actor,
    action: "agent_import.saved",
    entityType: "agent_import",
    entityId: row.id,
    skillId,
    details: { examples: report.examples, test: report.test, redactions },
  });
  return saved;
}

/* ---------- Reading and acting on imports ---------- */

export async function listImports(userId: string) {
  return db()
    .select({
      import: agentImports,
      skill: {
        slug: skills.slug,
        name: skills.name,
        publishedVersionId: skills.publishedVersionId,
      },
    })
    .from(agentImports)
    .leftJoin(skills, eq(agentImports.skillId, skills.id))
    .where(eq(agentImports.userId, userId))
    .orderBy(desc(agentImports.createdAt))
    .limit(50);
}

/** Imports that stopped making progress (a restart mid-run), to pick up again. */
export async function staleImportIds(userId: string) {
  const rows = await db()
    .select({ id: agentImports.id })
    .from(agentImports)
    .where(
      and(
        eq(agentImports.userId, userId),
        or(
          eq(agentImports.status, "received"),
          inArray(agentImports.status, ["training", "testing"]),
        ),
        lt(agentImports.updatedAt, new Date(Date.now() - STALE_AFTER_MS)),
      ),
    );
  return rows.map((r) => r.id);
}

/** What an agent may see about its own import: status and report, never the skill's content. */
export async function importStatusForKey(key: AgentKey, importId: string) {
  const [row] = await db()
    .select({ import: agentImports, slug: skills.slug })
    .from(agentImports)
    .leftJoin(skills, eq(agentImports.skillId, skills.id))
    .where(and(eq(agentImports.id, importId), eq(agentImports.agentKeyId, key.id)));
  if (!row) throw new NotFoundError("No such import");
  return {
    id: row.import.id,
    status: row.import.status,
    report: row.import.report,
    error: row.import.error,
    skill: row.slug,
    createdAt: row.import.createdAt,
    updatedAt: row.import.updatedAt,
  };
}

async function ownedImport(userId: string, importId: string) {
  const row = await db().query.agentImports.findFirst({
    where: and(eq(agentImports.id, importId), eq(agentImports.userId, userId)),
  });
  if (!row) throw new NotFoundError("No such import");
  return row;
}

/**
 * Tries a failed import again from where it stopped (the saved skill). One
 * that failed before its examples were saved has to be sent again.
 */
export async function retryImport(userId: string, importId: string, actor: Actor) {
  const row = await ownedImport(userId, importId);
  if (row.status !== "failed") throw new Error("Only failed imports can be retried");
  if (!row.skillId)
    throw new Error("Nothing was saved from this import; ask the agent to send it again");
  await db()
    .update(agentImports)
    .set({ status: "received", error: null, updatedAt: new Date() })
    .where(and(eq(agentImports.id, importId), eq(agentImports.status, "failed")));
  await audit({
    actor,
    action: "agent_import.retried",
    entityType: "agent_import",
    entityId: importId,
    skillId: row.skillId,
  });
}

/**
 * One click from a verified import to a live listing: publish the tested
 * version, save a listing with sensible defaults, and put it live if every
 * requirement (including the owner's ownership declaration) is met.
 */
export async function publishAndList(
  userId: string,
  importId: string,
  input: { priceCents: number; declareOwnership: boolean },
) {
  const row = await ownedImport(userId, importId);
  if (row.status !== "verified" || !row.skillId) {
    throw new Error("Only verified imports can be published from here");
  }
  if (!input.declareOwnership) throw new Error("Confirm the method is yours to list");
  const skill = await db().query.skills.findFirst({ where: eq(skills.id, row.skillId) });
  if (!skill?.currentVersionId) throw new NotFoundError("The skill has no version to publish");
  if (skill.publishedVersionId !== skill.currentVersionId) {
    await publishVersion(skill.id, skill.currentVersionId, false);
  }
  const sample = (await listPairs(skill.id)).find((p) => p.split === "train");
  await saveListing(skill.id, {
    title: skill.name,
    description: skill.taskDescription,
    priceCents: input.priceCents,
    turnaroundHours: 24,
    sampleOutput: sample?.output ?? skill.taskDescription,
    ownerType: "freelancer",
    declareOwnership: true,
  });
  const { ready } = await readiness(skill.id);
  if (ready) await setListingActive(skill.id, true);
  return { slug: skill.slug, live: ready };
}

/** Submissions are cleared once saved; this catches any left by an import abandoned mid-way. */
export async function purgeImportPayloads(now = new Date()) {
  const cleared = await db()
    .update(agentImports)
    .set({ payload: null })
    .where(
      and(
        isNotNull(agentImports.payload),
        lt(agentImports.createdAt, new Date(now.getTime() - 86_400_000)),
      ),
    )
    .returning({ id: agentImports.id });
  return cleared.length;
}
