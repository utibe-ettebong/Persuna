/**
 * Storage-backed wrappers around the engine. The CLI and the web app both
 * call these, so a run from the terminal and a run from the UI are identical.
 */
import path from "node:path";
import { and, asc, desc, eq, inArray, max, notInArray, sql } from "drizzle-orm";
import { db, schema } from "@/db/client";
import type { Example, SkillVersion } from "@/db/schema";
import { env } from "@/env";
import { audit, type Actor } from "@/lib/audit";
import type { ModelClient } from "@/lib/models/gateway";
import { normalizeText } from "@/lib/text";
import {
  describeScreens,
  extractSheet,
  findNames,
  mapLimit,
  proposeCorrection,
  proposeFromNotes,
  runTestCase,
} from "./engine";
import { interviewText, type InterviewAnswers } from "./interview";
import { redactTogether, scanText } from "./redact";
import { checkPublish, publishCheckMessage } from "./publish";
import type { SkillMeta } from "./prompts";
import { mean } from "./score";
import { skillSheet, type Pair, type SkillSheet } from "./types";

const { skills, skillVersions, examples, evalRuns, testResults, corrections } = schema;

export interface SkillDefinition extends SkillMeta {
  slug: string;
}

export interface PairWithSplit {
  slug: string;
  split: "train" | "test";
  input: string;
  output: string;
}

const toPair = (e: Example): Pair => ({ id: e.id, slug: e.slug, input: e.input, output: e.output });

/** Used by the CLI and demo seed. `ownerId` assigns the skill to an account. */
export async function upsertSkill(definition: SkillDefinition, ownerId?: string) {
  const [row] = await db()
    .insert(skills)
    .values({ ...definition, ownerId: ownerId ?? null })
    .onConflictDoUpdate({
      target: skills.slug,
      set: {
        name: definition.name,
        taskDescription: definition.taskDescription,
        inputType: definition.inputType,
        outputType: definition.outputType,
        ...(ownerId ? { ownerId } : {}),
      },
    })
    .returning();
  return row;
}

/**
 * Makes the stored pairs match `pairs`: inserts or updates by slug and deletes
 * pairs that are no longer present (their past test results go with them).
 */
export async function importPairs(skillId: string, pairs: PairWithSplit[]) {
  return db().transaction(async (tx) => {
    const keep = pairs.map((p) => p.slug);
    const removed = await tx
      .delete(examples)
      .where(
        keep.length
          ? and(eq(examples.skillId, skillId), notInArray(examples.slug, keep))
          : eq(examples.skillId, skillId),
      )
      .returning({ slug: examples.slug });
    if (pairs.length) {
      await tx
        .insert(examples)
        .values(pairs.map((p) => ({ ...p, skillId })))
        .onConflictDoUpdate({
          target: [examples.skillId, examples.slug],
          set: {
            split: sqlExcluded("split"),
            input: sqlExcluded("input"),
            output: sqlExcluded("output"),
          },
        });
    }
    return { upserted: pairs.length, removed: removed.map((r) => r.slug) };
  });
}

export async function getSkillBySlug(slug: string) {
  const skill = await db().query.skills.findFirst({ where: eq(skills.slug, slug) });
  if (!skill) throw new NotFoundError(`No skill "${slug}"`);
  return skill;
}

async function splitPairs(skillId: string) {
  const rows = await db()
    .select()
    .from(examples)
    .where(eq(examples.skillId, skillId))
    .orderBy(asc(examples.slug));
  return {
    train: rows.filter((r) => r.split === "train").map(toPair),
    test: rows.filter((r) => r.split === "test").map(toPair),
  };
}

export async function createVersion(
  skillId: string,
  sheet: SkillSheet,
  source: "extract" | "correction" | "edit",
  model: string,
  parentVersionId: string | null,
  actor: Actor = "owner",
): Promise<SkillVersion> {
  return db().transaction(async (tx) => {
    // Serialise version numbering per skill.
    await tx.select({ id: skills.id }).from(skills).where(eq(skills.id, skillId)).for("update");
    const [{ latest }] = await tx
      .select({ latest: max(skillVersions.version) })
      .from(skillVersions)
      .where(eq(skillVersions.skillId, skillId));
    const [version] = await tx
      .insert(skillVersions)
      .values({ skillId, sheet, source, model, parentVersionId, version: (latest ?? 0) + 1 })
      .returning();
    await tx.update(skills).set({ currentVersionId: version.id }).where(eq(skills.id, skillId));
    await audit(
      {
        actor,
        action: `version.created`,
        entityType: "version",
        entityId: version.id,
        skillId,
        details: { version: version.version, source, rules: sheet.rules.length, model },
      },
      tx,
    );
    return version;
  });
}

async function getVersion(versionId: string) {
  const version = await db().query.skillVersions.findFirst({
    where: eq(skillVersions.id, versionId),
  });
  if (!version) throw new NotFoundError(`No skill version ${versionId}`);
  return version;
}

/** Step 1: name the task. Addresses are global, so a taken one gets a number. */
export async function createSkill(definition: SkillDefinition, ownerId: string, actor: Actor) {
  let row: typeof skills.$inferSelect | undefined;
  for (let n = 1; !row && n <= 50; n++) {
    const slug = n === 1 ? definition.slug : `${definition.slug}-${n}`;
    [row] = await db()
      .insert(skills)
      .values({ ...definition, slug, ownerId })
      .onConflictDoNothing({ target: skills.slug })
      .returning();
  }
  if (!row) throw new Error("Couldn't find a free address for this skill; try another name");
  await audit({
    actor,
    action: "skill.created",
    entityType: "skill",
    entityId: row.id,
    skillId: row.id,
    details: { slug: row.slug },
  });
  return row;
}

/**
 * Gives a new user their own copy of the invented meeting-minutes sample
 * (skill plus example pairs), so they can try the whole loop at once.
 */
export async function createSampleSkill(ownerId: string, actor: Actor) {
  const { loadSkillFolder } = await import("./pairs-fs");
  const { definition, pairs } = await loadSkillFolder(
    path.join(process.cwd(), "data/skills/meeting-minutes"),
  );
  const skill = await createSkill(
    { ...definition, name: `${definition.name} (sample)` },
    ownerId,
    actor,
  );
  await importPairs(skill.id, pairs);
  return skill;
}

/** Step 2: the owner's answers to the guided interview. */
export async function saveInterview(skillId: string, answers: InterviewAnswers) {
  const cleaned = Object.fromEntries(
    Object.entries(answers)
      .map(([k, v]) => [k, normalizeText(v ?? "")])
      .filter(([, v]) => v),
  ) as InterviewAnswers;
  await db().update(skills).set({ interview: cleaned }).where(eq(skills.id, skillId));
  await audit({
    actor: "owner",
    action: "interview.saved",
    entityType: "skill",
    entityId: skillId,
    skillId,
    details: { answered: Object.keys(cleaned).length },
  });
}

/**
 * Scans a new pair for identifiers: patterns plus names found by the model.
 * Returns the findings and the redacted texts with consistent placeholders.
 */
export async function scanPair(client: ModelClient, rawInput: string, rawOutput: string) {
  const input = normalizeText(rawInput);
  const output = normalizeText(rawOutput);
  const entities = await findNames(client, [input, output]);
  const inputFindings = scanText(input, entities);
  const outputFindings = scanText(output, entities);
  const [redactedInput, redactedOutput] = redactTogether(
    [input, output],
    [inputFindings, outputFindings],
    entities,
  );
  return { inputFindings, outputFindings, redactedInput, redactedOutput };
}

export async function listPairs(skillId: string) {
  return db()
    .select()
    .from(examples)
    .where(eq(examples.skillId, skillId))
    .orderBy(asc(examples.split), asc(examples.slug));
}

/** Step 3: add one before/after pair, after the owner has reviewed the redaction scan. */
export async function addPair(skillId: string, pair: PairWithSplit & { redacted?: boolean }) {
  const [row] = await db()
    .insert(examples)
    .values({
      slug: pair.slug,
      split: pair.split,
      input: normalizeText(pair.input),
      output: normalizeText(pair.output),
      skillId,
    })
    .onConflictDoNothing({ target: [examples.skillId, examples.slug] })
    .returning();
  if (!row) throw new Error(`A pair named "${pair.slug}" already exists for this skill`);
  await audit({
    actor: "owner",
    action: "pair.added",
    entityType: "pair",
    entityId: row.id,
    skillId,
    details: { slug: row.slug, split: row.split, redacted: pair.redacted ?? false },
  });
  return row;
}

export async function setPairSplit(skillId: string, exampleId: string, split: "train" | "test") {
  await db()
    .update(examples)
    .set({ split })
    .where(and(eq(examples.id, exampleId), eq(examples.skillId, skillId)));
  await audit({
    actor: "owner",
    action: "pair.split_changed",
    entityType: "pair",
    entityId: exampleId,
    skillId,
    details: { split },
  });
}

export async function deletePair(skillId: string, exampleId: string) {
  await db()
    .delete(examples)
    .where(and(eq(examples.id, exampleId), eq(examples.skillId, skillId)));
  await audit({
    actor: "owner",
    action: "pair.deleted",
    entityType: "pair",
    entityId: exampleId,
    skillId,
  });
}

/** Step 3: read the training pairs and write a fresh skill sheet as a new version. */
export async function extractVersion(client: ModelClient, slug: string) {
  const skill = await getSkillBySlug(slug);
  const { train } = await splitPairs(skill.id);
  const { sheet, completion } = await extractSheet(
    client,
    skill,
    train,
    interviewText(skill.interview),
  );
  return createVersion(skill.id, sheet, "extract", completion.model, skill.currentVersionId);
}

/** Step 4: the owner's own edits to the rules become a new version. */
export async function saveEditedSheet(skillId: string, sheet: SkillSheet) {
  const skill = await db().query.skills.findFirst({ where: eq(skills.id, skillId) });
  if (!skill) throw new NotFoundError("No such skill");
  const parsed = skillSheet.parse(sheet);
  if (skill.currentVersionId) {
    const current = await getVersion(skill.currentVersionId);
    if (JSON.stringify(current.sheet) === JSON.stringify(parsed)) {
      throw new Error("Nothing changed");
    }
  }
  return createVersion(skillId, parsed, "edit", "owner", skill.currentVersionId);
}

/** Steps 4–5: draft every held-back input with this version and score it. */
export async function runEval(client: ModelClient, versionId: string) {
  const version = await getVersion(versionId);
  const { train, test } = await splitPairs(version.skillId);
  if (test.length === 0) throw new Error("No test pairs to run against");
  if (train.length === 0) throw new Error("No training pairs to draw examples from");

  const [run] = await db().insert(evalRuns).values({ skillVersionId: version.id }).returning();
  try {
    const results = await mapLimit(test, env().MODEL_CONCURRENCY, (pair) =>
      runTestCase(client, version.sheet, train, pair),
    );
    await db()
      .insert(testResults)
      .values(
        results.map((r) => ({
          evalRunId: run.id,
          exampleId: r.pair.id,
          draft: r.draft,
          score: r.score,
          breakdown: r.breakdown,
          shotExampleIds: r.shots.map((s) => s.id),
          draftModel: r.draftModel,
          evalModel: r.evalModel,
          promptTokens: r.promptTokens,
          completionTokens: r.completionTokens,
        })),
      );
    const [done] = await db()
      .update(evalRuns)
      .set({
        status: "complete",
        meanScore: mean(results.map((r) => r.score)),
        completedAt: new Date(),
      })
      .where(eq(evalRuns.id, run.id))
      .returning();
    await audit({
      actor: "owner",
      action: "tests.completed",
      entityType: "version",
      entityId: version.id,
      skillId: version.skillId,
      details: { version: version.version, score: done.meanScore, cases: results.length },
    });
    return done;
  } catch (error) {
    await db()
      .update(evalRuns)
      .set({ status: "failed", error: (error as Error).message, completedAt: new Date() })
      .where(eq(evalRuns.id, run.id));
    throw error;
  }
}

interface CorrectionSource {
  skillId: string;
  fromVersion: SkillVersion;
  input: string;
  draft: string;
  edited: string;
  reason: string;
  testResultId?: string;
  /** Set for edits on real jobs: the edited text is client material and is not stored. */
  jobId?: string;
}

async function saveProposal(values: typeof corrections.$inferInsert) {
  const [row] = await db().insert(corrections).values(values).returning();
  await audit({
    actor: "owner",
    action: "proposal.created",
    entityType: "correction",
    entityId: row.id,
    skillId: row.skillId,
    details: { source: row.source, changes: row.ruleOps.length },
  });
  return row;
}

async function recordProposal(client: ModelClient, source: CorrectionSource) {
  const { proposal, sheet } = await proposeCorrection(
    client,
    source.fromVersion.sheet,
    source.input,
    source.draft,
    normalizeText(source.edited),
    source.reason,
  );
  return saveProposal({
    skillId: source.skillId,
    testResultId: source.testResultId ?? null,
    jobId: source.jobId ?? null,
    source: source.jobId ? "job" : "test",
    fromVersionId: source.fromVersion.id,
    reason: source.reason.trim() || proposal.explanation,
    explanation: proposal.explanation,
    editedOutput: source.jobId ? null : normalizeText(source.edited),
    ruleOps: proposal.ops,
    proposedSheet: sheet,
  });
}

/**
 * The owner's own description (interview answers, or a transcribed voice
 * walkthrough) becomes proposed rule changes against the working version.
 */
export async function proposeFromMethodNotes(
  client: ModelClient,
  skillId: string,
  source: "interview" | "walkthrough" | "screen",
  notes: string,
) {
  const skill = await db().query.skills.findFirst({ where: eq(skills.id, skillId) });
  if (!skill) throw new NotFoundError("No such skill");
  if (!skill.currentVersionId) {
    throw new Error("Extract rules from your examples first; your answers will be included.");
  }
  const fromVersion = await getVersion(skill.currentVersionId);
  const { proposal, sheet } = await proposeFromNotes(client, fromVersion.sheet, notes);
  return saveProposal({
    skillId,
    source,
    fromVersionId: fromVersion.id,
    reason: {
      interview: "Your interview answers",
      walkthrough: "Your voice walkthrough",
      screen: "Your screen walkthrough",
    }[source],
    explanation: proposal.explanation,
    ruleOps: proposal.ops,
    proposedSheet: sheet,
  });
}

/** Step 6: an owner's edit of a test draft becomes proposed rule changes for review. */
export async function proposeCorrectionFromTest(
  client: ModelClient,
  testResultId: string,
  edited: string,
  reason: string,
) {
  const [row] = await db()
    .select({ result: testResults, example: examples, version: skillVersions })
    .from(testResults)
    .innerJoin(examples, eq(testResults.exampleId, examples.id))
    .innerJoin(evalRuns, eq(testResults.evalRunId, evalRuns.id))
    .innerJoin(skillVersions, eq(evalRuns.skillVersionId, skillVersions.id))
    .where(eq(testResults.id, testResultId));
  if (!row) throw new NotFoundError(`No test result ${testResultId}`);
  return recordProposal(client, {
    skillId: row.version.skillId,
    fromVersion: row.version,
    input: row.example.input,
    draft: row.result.draft,
    edited,
    reason,
    testResultId,
  });
}

/** Step 6, from real work: the edit the owner made while approving a job. */
export async function proposeCorrectionFromJob(client: ModelClient, jobId: string, reason: string) {
  const job = await db().query.jobs.findFirst({ where: eq(schema.jobs.id, jobId) });
  if (!job) throw new NotFoundError(`No job ${jobId}`);
  if (job.status !== "approved" || !job.finalOutput || job.editSize === "none") {
    throw new Error("Only approved jobs that you edited can teach the skill");
  }
  return recordProposal(client, {
    skillId: job.skillId,
    fromVersion: await getVersion(job.skillVersionId),
    input: job.input,
    draft: job.draft,
    edited: job.finalOutput,
    reason,
    jobId,
  });
}

export async function getCorrection(id: string) {
  const [row] = await db()
    .select({ correction: corrections, skill: skills, from: skillVersions })
    .from(corrections)
    .innerJoin(skills, eq(corrections.skillId, skills.id))
    .innerJoin(skillVersions, eq(corrections.fromVersionId, skillVersions.id))
    .where(eq(corrections.id, id));
  if (!row) throw new NotFoundError(`No correction ${id}`);
  return row;
}

/** The owner accepts proposed rule changes: they become a new working version. */
export async function acceptCorrection(id: string) {
  const { correction } = await getCorrection(id);
  if (correction.status !== "pending") throw new Error("This correction was already decided");
  const version = await createVersion(
    correction.skillId,
    correction.proposedSheet,
    "correction",
    "owner",
    correction.fromVersionId,
  );
  await db()
    .update(corrections)
    .set({ status: "accepted", toVersionId: version.id, decidedAt: new Date() })
    .where(eq(corrections.id, id));
  await audit({
    actor: "owner",
    action: "proposal.accepted",
    entityType: "correction",
    entityId: id,
    skillId: correction.skillId,
    details: { version: version.version },
  });
  return version;
}

export async function rejectCorrection(id: string) {
  const [row] = await db()
    .update(corrections)
    .set({ status: "rejected", decidedAt: new Date() })
    .where(and(eq(corrections.id, id), eq(corrections.status, "pending")))
    .returning();
  if (!row) throw new Error("This correction was already decided");
  await audit({
    actor: "owner",
    action: "proposal.rejected",
    entityType: "correction",
    entityId: id,
    skillId: row.skillId,
  });
  return row;
}

async function latestScore(versionId: string): Promise<number | null> {
  const [run] = await db()
    .select({ meanScore: evalRuns.meanScore })
    .from(evalRuns)
    .where(and(eq(evalRuns.skillVersionId, versionId), eq(evalRuns.status, "complete")))
    .orderBy(desc(evalRuns.createdAt))
    .limit(1);
  return run?.meanScore ?? null;
}

/** Step 7: make a tested version the one real jobs use. */
export async function publishVersion(skillId: string, versionId: string, confirmLower: boolean) {
  const skill = await db().query.skills.findFirst({ where: eq(skills.id, skillId) });
  if (!skill) throw new NotFoundError("No such skill");
  const version = await getVersion(versionId);
  if (version.skillId !== skillId) throw new NotFoundError("That version belongs to another skill");
  if (skill.publishedVersionId === versionId) throw new Error("That version is already published");

  const candidateScore = await latestScore(versionId);
  const publishedScore = skill.publishedVersionId
    ? await latestScore(skill.publishedVersionId)
    : null;
  const check = checkPublish(candidateScore, publishedScore, confirmLower);
  const message = publishCheckMessage(check);
  if (message) throw new Error(message);

  await db().transaction(async (tx) => {
    await tx
      .update(skillVersions)
      .set({ publishedAt: new Date() })
      .where(eq(skillVersions.id, versionId));
    // A new version earns its own record: autonomy resets to "review everything".
    await tx
      .update(skills)
      .set({ publishedVersionId: versionId, trustLevel: 0 })
      .where(eq(skills.id, skillId));
    await audit(
      {
        actor: "owner",
        action: "version.published",
        entityType: "version",
        entityId: versionId,
        skillId,
        details: {
          version: version.version,
          score: candidateScore,
          previousScore: publishedScore,
          lowerConfirmed:
            confirmLower && publishedScore !== null && (candidateScore ?? 0) < publishedScore,
          trustReset: skill.trustLevel > 0,
        },
      },
      tx,
    );
  });
}

/** Points the working version back at an earlier one. Versions themselves never change. */
export async function setCurrentVersion(skillId: string, versionId: string) {
  const version = await db().query.skillVersions.findFirst({
    where: and(eq(skillVersions.id, versionId), eq(skillVersions.skillId, skillId)),
  });
  if (!version) throw new NotFoundError("That version does not belong to this skill");
  await db().update(skills).set({ currentVersionId: versionId }).where(eq(skills.id, skillId));
  await audit({
    actor: "owner",
    action: "version.made_working",
    entityType: "version",
    entityId: versionId,
    skillId,
    details: { version: version.version },
  });
}

/** Skills owned by `ownerId`, or every skill when null (admins). */
export async function listSkills(ownerId: string | null) {
  return db()
    .select()
    .from(skills)
    .where(ownerId ? eq(skills.ownerId, ownerId) : undefined)
    .orderBy(asc(skills.name));
}

export async function publishedScore(skill: { publishedVersionId: string | null }) {
  return skill.publishedVersionId ? latestScore(skill.publishedVersionId) : null;
}

export async function getSkillOverview(slug: string) {
  const skill = await getSkillBySlug(slug);
  const versions = await db()
    .select()
    .from(skillVersions)
    .where(eq(skillVersions.skillId, skill.id))
    .orderBy(desc(skillVersions.version));
  const runs = versions.length
    ? await db()
        .select()
        .from(evalRuns)
        .where(
          inArray(
            evalRuns.skillVersionId,
            versions.map((v) => v.id),
          ),
        )
        .orderBy(desc(evalRuns.createdAt))
    : [];
  const pairCounts = await splitPairs(skill.id);
  const correctionRows = await db()
    .select()
    .from(corrections)
    .where(eq(corrections.skillId, skill.id))
    .orderBy(desc(corrections.createdAt));

  return {
    skill,
    versions: versions.map((v) => ({
      ...v,
      latestRun: runs.find((r) => r.skillVersionId === v.id) ?? null,
    })),
    counts: { train: pairCounts.train.length, test: pairCounts.test.length },
    corrections: correctionRows,
  };
}

export async function getRun(runId: string) {
  const [header] = await db()
    .select({ run: evalRuns, version: skillVersions, skill: skills })
    .from(evalRuns)
    .innerJoin(skillVersions, eq(evalRuns.skillVersionId, skillVersions.id))
    .innerJoin(skills, eq(skillVersions.skillId, skills.id))
    .where(eq(evalRuns.id, runId));
  if (!header) throw new NotFoundError(`No run ${runId}`);
  const results = await db()
    .select({ result: testResults, example: examples })
    .from(testResults)
    .innerJoin(examples, eq(testResults.exampleId, examples.id))
    .where(eq(testResults.evalRunId, runId))
    .orderBy(asc(examples.slug));
  return { ...header, results };
}

/**
 * Screen walkthrough: frames of one window and the narration become method
 * steps, then anything identifying is redacted before it is kept. Frames and
 * audio are never stored. Before rules exist the steps join the interview;
 * afterwards they become proposed rule changes.
 */
export async function learnFromScreenWalkthrough(
  client: ModelClient,
  skillId: string,
  input: { frames: string[]; narration: string; actor: Actor },
) {
  const skill = await db().query.skills.findFirst({ where: eq(skills.id, skillId) });
  if (!skill) throw new NotFoundError("No such skill");
  const steps = await describeScreens(client, skill, input.narration, input.frames);
  const raw = [
    `Steps seen on screen:\n${steps}`,
    input.narration && `What they said:\n${input.narration}`,
  ]
    .filter(Boolean)
    .join("\n\n");
  const entities = await findNames(client, [raw]);
  const [notes] = redactTogether([raw], [scanText(raw, entities)], entities);

  await audit({
    actor: input.actor,
    action: "screen_walkthrough.recorded",
    entityType: "skill",
    entityId: skillId,
    skillId,
    details: { frames: input.frames.length, narrated: Boolean(input.narration) },
  });

  if (!skill.currentVersionId) {
    const answers = { ...(skill.interview ?? {}) };
    answers.steps = [answers.steps, notes].filter(Boolean).join("\n\n");
    await saveInterview(skillId, answers);
    return { proposal: null, notes };
  }
  const proposal = await proposeFromMethodNotes(client, skillId, "screen", notes);
  return { proposal, notes };
}

export async function trainingPairs(skillId: string) {
  return (await splitPairs(skillId)).train;
}

export class NotFoundError extends Error {
  override name = "NotFoundError";
}

function sqlExcluded(column: "split" | "input" | "output") {
  return sql.raw(`excluded."${column}"`);
}
