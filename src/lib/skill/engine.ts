/**
 * The training loop with no storage attached: extract rules, draft, score,
 * learn from a correction. Everything here takes a {@link ModelClient} so it
 * runs the same against real providers, in tests, and from the CLI.
 */
import type { Completion, ContentPart, ModelClient } from "@/lib/models/gateway";
import { z } from "zod";
import { completeJson } from "@/lib/models/json";
import {
  deterministicFlags,
  mergeFlags,
  selfCheckResult,
  type JobFlag,
} from "@/lib/jobs/self-check";
import {
  correctionMessages,
  draftMessages,
  evaluateMessages,
  extractMessages,
  methodNotesMessages,
  redactMessages,
  screenWalkthroughMessages,
  transcribeMessages,
  groundingMessages,
  redraftMessages,
  reviseMessages,
  selfCheckMessages,
  type SkillMeta,
} from "./prompts";
import {
  assessClaims,
  groundingClaims,
  MAX_REDRAFTS,
  type GroundingReport,
} from "@/lib/jobs/grounding";
import { namedEntities, type NamedEntity } from "./redact";
import { closestPairs } from "./retrieve";
import { replicationScore } from "./score";
import { applyRuleOps } from "./sheet";
import {
  correctionProposal,
  scoreBreakdown,
  skillSheet,
  type CorrectionProposal,
  type Pair,
  type ScoreBreakdown,
  type SkillSheet,
} from "./types";

export async function extractSheet(
  client: ModelClient,
  meta: SkillMeta,
  trainPairs: Pair[],
  ownerNotes = "",
): Promise<{ sheet: SkillSheet; completion: Completion }> {
  if (trainPairs.length === 0) throw new Error("Need at least one training pair to extract rules");
  const { value, completion } = await completeJson(
    client,
    "extract",
    extractMessages(meta, trainPairs, ownerNotes),
    skillSheet,
    { maxTokens: 8192 },
  );
  return { sheet: value, completion };
}

export interface TestCaseResult {
  pair: Pair;
  draft: string;
  shots: Pair[];
  breakdown: ScoreBreakdown;
  score: number;
  draftModel: string;
  evalModel: string;
  promptTokens: number;
  completionTokens: number;
}

export async function runTestCase(
  client: ModelClient,
  sheet: SkillSheet,
  trainPairs: Pair[],
  testPair: Pair,
  shotCount = 3,
): Promise<TestCaseResult> {
  const shots = closestPairs(testPair.input, trainPairs, shotCount);
  const drafted = await client.complete("draft", draftMessages(sheet, shots, testPair.input), {
    temperature: 0.2,
    maxTokens: 4096,
  });
  const draft = drafted.text.trim();
  if (!draft) throw new Error(`Draft model returned nothing for ${testPair.slug}`);

  const judged = await completeJson(
    client,
    "evaluate",
    evaluateMessages(sheet, testPair.input, draft, testPair.output),
    scoreBreakdown,
  );

  return {
    pair: testPair,
    draft,
    shots,
    breakdown: judged.value,
    score: replicationScore(judged.value),
    draftModel: drafted.model,
    evalModel: judged.completion.model,
    promptTokens: drafted.promptTokens + judged.completion.promptTokens,
    completionTokens: drafted.completionTokens + judged.completion.completionTokens,
  };
}

export async function proposeCorrection(
  client: ModelClient,
  sheet: SkillSheet,
  input: string,
  draft: string,
  edited: string,
  reason: string,
): Promise<{ proposal: CorrectionProposal; sheet: SkillSheet; model: string }> {
  if (edited.trim() === draft.trim())
    throw new Error("The edited version is the same as the draft");
  const { value, completion } = await completeJson(
    client,
    "extract",
    correctionMessages(sheet, input, draft, edited, reason),
    correctionProposal,
  );
  const applied = applyRuleOps(sheet, value.ops, value.templateChange);
  if (applied.unknownIds.length > 0) {
    throw new Error(`Correction referenced unknown rules: ${applied.unknownIds.join(", ")}`);
  }
  return { proposal: value, sheet: applied.sheet, model: completion.model };
}

/**
 * The owner's own description of their method (interview answers or a voice
 * walkthrough transcript) becomes proposed rule changes.
 */
export async function proposeFromNotes(
  client: ModelClient,
  sheet: SkillSheet,
  notes: string,
): Promise<{ proposal: CorrectionProposal; sheet: SkillSheet; model: string }> {
  if (!notes.trim()) throw new Error("There is nothing to learn from yet");
  const { value, completion } = await completeJson(
    client,
    "extract",
    methodNotesMessages(sheet, notes),
    correctionProposal,
  );
  const applied = applyRuleOps(sheet, value.ops, value.templateChange);
  if (applied.unknownIds.length > 0) {
    throw new Error(`Proposal referenced unknown rules: ${applied.unknownIds.join(", ")}`);
  }
  return { proposal: value, sheet: applied.sheet, model: completion.model };
}

/** Turns screenshots of a recorded walkthrough (plus narration) into method steps. */
export async function describeScreens(
  client: ModelClient,
  meta: SkillMeta,
  narration: string,
  frames: string[],
): Promise<string> {
  if (frames.length === 0) throw new Error("Capture at least one screen first");
  const reply = await client.complete(
    "extract",
    screenWalkthroughMessages(meta, narration, frames),
    {
      maxTokens: 2048,
    },
  );
  const steps = reply.text.trim();
  if (!steps) throw new Error("The model returned no steps for this walkthrough");
  return steps;
}

/** Names of people, organisations and places in the texts, for anonymising examples. */
export async function findNames(client: ModelClient, texts: string[]): Promise<NamedEntity[]> {
  const { value } = await completeJson(client, "extract", redactMessages(texts), namedEntities);
  return value.entities;
}

/**
 * The drafter's self-check: model-found problems plus deterministic checks for
 * invented numbers and unusual input length. Any flag sends the job to the owner.
 */
export async function selfCheck(
  client: ModelClient,
  sheet: SkillSheet,
  input: string,
  draft: string,
  trainingInputLengths: number[],
): Promise<JobFlag[]> {
  const { value } = await completeJson(
    client,
    "evaluate",
    selfCheckMessages(sheet, input, draft),
    selfCheckResult,
  );
  return mergeFlags(value.flags, deterministicFlags(input, draft, trainingInputLengths));
}

/** Maps over items with at most `limit` in flight, preserving order. */
export async function mapLimit<T, R>(
  items: T[],
  limit: number,
  fn: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(items.length);
  let next = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) {
      const index = next++;
      results[index] = await fn(items[index], index);
    }
  });
  await Promise.all(workers);
  return results;
}

const transcription = z.object({
  pages: z.array(z.object({ page: z.coerce.number().int().min(1), text: z.string() })).min(1),
});

/** One document (an uploaded PDF, or an image) as its pages' text, word for word. */
export async function transcribeDocument(
  client: ModelClient,
  name: string,
  document: ContentPart,
): Promise<{ page: number; text: string }[]> {
  const { value } = await completeJson(
    client,
    "extract",
    transcribeMessages(name, document),
    transcription,
    { maxTokens: 16_384 },
  );
  return value.pages.filter((p) => p.text.trim());
}

/** Checks each factual statement in a draft against the input (quotes verified in code). */
export async function checkGrounding(
  client: ModelClient,
  input: string,
  draft: string,
  redrafts = 0,
): Promise<GroundingReport> {
  const { value } = await completeJson(
    client,
    "evaluate",
    groundingMessages(input, draft),
    groundingClaims,
    { maxTokens: 8192 },
  );
  return assessClaims(value.claims, input, redrafts);
}

/**
 * Drafts, checks every statement against the input, and when some aren't
 * supported, asks for the draft again with exactly those listed, up to
 * {@link MAX_REDRAFTS} times. Whatever is still unsupported comes back in the
 * report, for the owner to see.
 */
export async function draftGrounded(
  client: ModelClient,
  sheet: SkillSheet,
  shots: Pair[],
  job: string,
  /** A renter asked for changes to `previous`: revise it rather than start again. */
  revision?: { previous: string; request: string },
): Promise<{ draft: string; completion: Completion; grounding: GroundingReport }> {
  // In a revision, statements may also come from what the client asked for.
  const input = revision ? `${job}\n\n${revision.request}` : job;
  let completion = await client.complete(
    "draft",
    revision
      ? reviseMessages(sheet, shots, job, revision.previous, revision.request)
      : draftMessages(sheet, shots, job),
    { temperature: 0.2, maxTokens: 4096 },
  );
  let draft = completion.text.trim();
  if (!draft) throw new Error("The model returned an empty draft");
  let tokens = { prompt: completion.promptTokens, completion: completion.completionTokens };
  let report = await checkGrounding(client, input, draft);
  while (report.unsupported.length && report.redrafts < MAX_REDRAFTS) {
    const again = await client.complete(
      "draft",
      redraftMessages(
        sheet,
        shots,
        input,
        draft,
        report.unsupported.map((c) => c.claim),
      ),
      { temperature: 0.2, maxTokens: 4096 },
    );
    if (!again.text.trim()) break;
    completion = again;
    draft = again.text.trim();
    tokens = {
      prompt: tokens.prompt + again.promptTokens,
      completion: tokens.completion + again.completionTokens,
    };
    report = await checkGrounding(client, input, draft, report.redrafts + 1);
  }
  return {
    draft,
    completion: { ...completion, promptTokens: tokens.prompt, completionTokens: tokens.completion },
    grounding: report,
  };
}
