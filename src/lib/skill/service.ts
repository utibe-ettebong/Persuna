/**
 * Storage-backed wrappers around the engine. The CLI and the web app both
 * call these, so a run from the terminal and a run from the UI are identical.
 */
import path from "node:path";
import { and, asc, count, desc, eq, inArray, max, notInArray, sql } from "drizzle-orm";
import { db, schema } from "@/db/client";
import type { Example, SkillVersion } from "@/db/schema";
import { env } from "@/env";
import { audit, type Actor } from "@/lib/audit";
import { enforceListingScore } from "@/lib/market/verification";
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
import { fitnessOf, stepsFromEvents } from "./episodes";
import {
  confirmEvidence,
  evidenceCounts,
  pruneEvidence,
  recordEvidence,
  touchedRuleIds,
} from "./evidence";
import { INTERVIEW_QUESTIONS, interviewText, type InterviewAnswers } from "./interview";
import { redactTogether, scanText } from "./redact";
import {
  confidenceOf,
  coverageOf,
  freshnessOf,
  groundednessOf,
  reliabilityOf,
  type Composite,
} from "./rating";
import { checkPublish, publishCheckMessage } from "./publish";
import type { SkillMeta } from "./prompts";
import { mean } from "./score";
import { parseSkillMd } from "./skill-import";
import { skillSheet, type Pair, type SkillSheet } from "./types";

const {
  skills,
  skillVersions,
  examples,
  evalRuns,
  testResults,
  corrections,
  episodes,
  episodeEvents,
  skillSteps,
  jobs,
} = schema;

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

export async function splitPairs(skillId: string) {
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

export async function getVersion(versionId: string) {
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

/**
 * Marks a skill visible to the owner's team (or hides it again). Sharing
 * never makes a skill confidential or unlistable; attaching to a role does.
 * The caller must have checked ownership (ownedSkillBySlug).
 */
export async function setTeamVisible(skillId: string, visible: boolean, actor: Actor) {
  const skill = await db().query.skills.findFirst({ where: eq(skills.id, skillId) });
  if (!skill) throw new NotFoundError("No such skill");
  await db().update(skills).set({ teamVisible: visible }).where(eq(skills.id, skillId));
  await audit({
    actor,
    action: visible ? "skill.team_shown" : "skill.team_hidden",
    entityType: "skill",
    entityId: skillId,
    skillId,
  });
}

/**
 * Imports another agent's skill file (SKILL.md and similar markdown) as a new
 * skill: sections become six-layer interview answers, and the skill is marked
 * imported until it is tested.
 */
export async function importSkillMd(
  userId: string,
  actor: Actor,
  input: { slug: string; text: string; inputType: string; outputType: string },
) {
  const parsed = parseSkillMd(input.text);
  if (!parsed.ok) throw new Error(parsed.errors.join("; "));
  const skill = await createSkill(
    {
      slug: input.slug,
      name: parsed.value.name,
      taskDescription: parsed.value.description,
      inputType: input.inputType,
      outputType: input.outputType,
    },
    userId,
    actor,
  );
  const answers: InterviewAnswers = {};
  for (const [layer, text] of Object.entries(parsed.value.layers)) {
    const key = INTERVIEW_QUESTIONS.find((question) => question.layer === Number(layer))?.key;
    if (key && text) answers[key] = text;
  }
  if (Object.keys(answers).length > 0) await saveInterview(skill.id, answers);
  await db().update(skills).set({ importSource: "skill.md" }).where(eq(skills.id, skill.id));
  return skill;
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
    // A re-test of the published version can drop a live listing below the minimum.
    await enforceListingScore(version.skillId);
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
  source: "interview" | "walkthrough" | "screen" | "companion" | "episode",
  notes: string,
) {
  const skill = await db().query.skills.findFirst({ where: eq(skills.id, skillId) });
  if (!skill) throw new NotFoundError("No such skill");
  if (!skill.currentVersionId) {
    throw new Error("Extract rules from your examples first; your answers will be included.");
  }
  const fromVersion = await getVersion(skill.currentVersionId);
  const { proposal, sheet } = await proposeFromNotes(client, fromVersion.sheet, notes);
  const row = await saveProposal({
    skillId,
    source,
    fromVersionId: fromVersion.id,
    reason: {
      interview: "Your interview answers",
      walkthrough: "Your voice walkthrough",
      screen: "Your screen walkthrough",
      companion: "What you taught your Persuna",
      episode: "What Persuna watched you do",
    }[source],
    explanation: proposal.explanation,
    ruleOps: proposal.ops,
    proposedSheet: sheet,
  });
  if (source === "interview") {
    const { added, updated } = touchedRuleIds(proposal.ops, fromVersion.sheet, sheet);
    await recordEvidence(skillId, [...added, ...updated], "interview", "interview");
  }
  return row;
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
  await confirmEvidence(id);
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
  await pruneEvidence(id);
  await audit({
    actor: "owner",
    action: "proposal.rejected",
    entityType: "correction",
    entityId: id,
    skillId: row.skillId,
  });
  return row;
}

export async function latestScore(versionId: string): Promise<number | null> {
  const [run] = await db()
    .select({ meanScore: evalRuns.meanScore })
    .from(evalRuns)
    .where(and(eq(evalRuns.skillVersionId, versionId), eq(evalRuns.status, "complete")))
    .orderBy(desc(evalRuns.createdAt))
    .limit(1);
  return run?.meanScore ?? null;
}

/**
 * The composite rating (plan §4.5): six parts, each 0–100 or null when not
 * yet measurable. Skipped parts stay null — a skill earns its rating only
 * from the learning it actually did.
 */
export async function skillComposite(skillId: string): Promise<Composite> {
  const skill = await db().query.skills.findFirst({ where: eq(skills.id, skillId) });
  if (!skill) throw new NotFoundError("No such skill");
  const [steps, learned, counts] = await Promise.all([
    db()
      .select()
      .from(skillSteps)
      .where(eq(skillSteps.skillId, skillId))
      .orderBy(asc(skillSteps.seq)),
    db()
      .select()
      .from(episodes)
      .where(and(eq(episodes.skillId, skillId), eq(episodes.status, "extracted")))
      .orderBy(desc(episodes.startedAt)),
    evidenceCounts(skillId),
  ]);
  const fitnesses: (number | null)[] = [];
  for (const episode of learned) {
    const events = await db()
      .select()
      .from(episodeEvents)
      .where(eq(episodeEvents.episodeId, episode.id))
      .orderBy(asc(episodeEvents.at));
    fitnesses.push(steps.length === 0 ? null : fitnessOf(steps, stepsFromEvents(events)).fitness);
  }
  const measured = fitnesses.filter((fitness): fitness is number => fitness !== null);
  const fitness = measured.length === 0 ? null : mean(measured);
  const versionId = skill.publishedVersionId ?? skill.currentVersionId;
  const sheet = versionId ? (await getVersion(versionId)).sheet : null;
  const ruleIds = sheet ? sheet.rules.map((entry) => entry.id) : [];
  const approved = await db()
    .select({ id: jobs.id })
    .from(jobs)
    .where(and(eq(jobs.skillId, skillId), eq(jobs.status, "approved")));
  const [{ n: corrected }] =
    approved.length === 0
      ? [{ n: 0 }]
      : await db()
          .select({ n: count() })
          .from(corrections)
          .where(
            and(
              eq(corrections.source, "job"),
              inArray(
                corrections.jobId,
                approved.map((job) => job.id),
              ),
            ),
          );
  return {
    replication: versionId ? await latestScore(versionId) : null,
    coverage: coverageOf(fitness, steps),
    confidence: confidenceOf(ruleIds, counts),
    groundedness: groundednessOf(ruleIds, counts),
    freshness: freshnessOf(fitnesses.slice(0, 3)),
    reliability: reliabilityOf(approved.length, corrected),
  };
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
  // Re-verify the listing against the newly published version; pause it if it no longer qualifies.
  await enforceListingScore(skillId);
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
  const steps = await db()
    .select()
    .from(skillSteps)
    .where(eq(skillSteps.skillId, skill.id))
    .orderBy(asc(skillSteps.seq));
  const episodeRows = await db()
    .select()
    .from(episodes)
    .where(eq(episodes.skillId, skill.id))
    .orderBy(desc(episodes.startedAt))
    .limit(10);
  const evidence = await evidenceCounts(skill.id);
  // Fitness on the latest learned episode: how much of what was seen the
  // procedure explains (plan §4.4).
  let fitness: number | null = null;
  const latest = episodeRows.find((row) => row.status === "extracted" || row.status === "done");
  if (latest && steps.length > 0) {
    const events = await db()
      .select()
      .from(episodeEvents)
      .where(eq(episodeEvents.episodeId, latest.id))
      .orderBy(asc(episodeEvents.at));
    fitness = fitnessOf(steps, stepsFromEvents(events)).fitness;
  }

  return {
    skill,
    versions: versions.map((v) => ({
      ...v,
      latestRun: runs.find((r) => r.skillVersionId === v.id) ?? null,
    })),
    counts: { train: pairCounts.train.length, test: pairCounts.test.length },
    corrections: correctionRows,
    steps,
    episodes: episodeRows,
    evidence,
    fitness,
    composite: await skillComposite(skill.id),
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
