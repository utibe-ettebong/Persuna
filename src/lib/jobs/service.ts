/**
 * Real work through a published skill: submit, draft, self-check, review (or
 * auto-approve when the skill has earned it), deliver. Job content is
 * material, not method: it stays in the jobs table and is deleted after the
 * retention period.
 */
import { and, desc, eq, gte, inArray, lt } from "drizzle-orm";
import { db, schema } from "@/db/client";
import type { JobToolCall, JobToolPolicy } from "@/db/schema";
import { env, trustThresholds } from "@/env";
import { audit, type Actor } from "@/lib/audit";
import { accessTokenFor, connectionAccountFor } from "@/lib/connections/service";
import { TOOLS, toolNamed } from "@/lib/connections/tools";
import { listMcpServers, mcpServerClient } from "@/lib/mcp/service";
import type { ModelClient } from "@/lib/models/gateway";
import { refundForJob } from "@/lib/payments/service";
import { draftGrounded, runToolLoop, selfCheck } from "@/lib/skill/engine";
import type { ToolCall, ToolOutcome, ToolRunner } from "@/lib/skill/engine";
import type { ToolSpec } from "@/lib/skill/types";
import { closestPairs } from "@/lib/skill/retrieve";
import { NotFoundError, trainingPairs } from "@/lib/skill/service";
import { normalizeText } from "@/lib/text";
import { classifyEdit } from "./edit-size";
import { groundingFlags } from "./grounding";
import { mergeFlags } from "./self-check";
import {
  jobLinks,
  policyAllows,
  setJobToolPolicy,
  targetInText,
  targetOf,
  truncateValue,
} from "./tools";
import {
  canSetLevel,
  eligibility,
  needsOwnerReview,
  type TrustLevel,
  type TrustRecord,
} from "./trust";

const { jobs, jobApprovals, jobRounds, skills, skillVersions } = schema;

export interface NewJob {
  skillId: string;
  origin: "owner" | "renter" | "trial";
  requesterName: string;
  /** The account that asked for the job (the owner, or a renter). */
  requesterUserId?: string;
  input: string;
  /** Renter paid for guaranteed owner review. */
  ownerReviewRequired?: boolean;
  /** Run a chosen version instead of the published one (trials). */
  versionId?: string;
}

async function publishedVersion(skillId: string) {
  const skill = await db().query.skills.findFirst({ where: eq(skills.id, skillId) });
  if (!skill) throw new NotFoundError("No such skill");
  if (!skill.publishedVersionId) throw new Error(`"${skill.name}" has no published version yet`);
  const version = await db().query.skillVersions.findFirst({
    where: eq(skillVersions.id, skill.publishedVersionId),
  });
  if (!version) throw new NotFoundError("Published version is missing");
  return { skill, version };
}

/** A chosen version for a trial run. It must belong to the skill. */
async function namedVersion(skillId: string, versionId: string) {
  const skill = await db().query.skills.findFirst({ where: eq(skills.id, skillId) });
  if (!skill) throw new NotFoundError("No such skill");
  const version = await db().query.skillVersions.findFirst({
    where: and(eq(skillVersions.id, versionId), eq(skillVersions.skillId, skillId)),
  });
  if (!version) throw new NotFoundError("That version isn't part of this skill");
  return { skill, version };
}

/**
 * Records a job before any drafting. Renter jobs paid through Paystack wait
 * here (awaiting_payment) until the payment is confirmed.
 */
export async function openJob(job: NewJob, status: "awaiting_payment" | "review" = "review") {
  const { skill, version } = job.versionId
    ? await namedVersion(job.skillId, job.versionId)
    : await publishedVersion(job.skillId);
  const input = normalizeText(job.input);
  if (!input) throw new Error("The job has no input");
  const [row] = await db()
    .insert(jobs)
    .values({
      skillId: skill.id,
      skillVersionId: version.id,
      origin: job.origin,
      requesterUserId: job.requesterUserId ?? null,
      requesterName: job.requesterName.trim() || "Owner",
      input,
      draft: "",
      model: "",
      status,
      trustLevel: skill.trustLevel,
      ownerReviewRequired: job.ownerReviewRequired ?? false,
      expiresAt: new Date(Date.now() + env().JOB_RETENTION_DAYS * 86_400_000),
    })
    .returning();
  await audit({
    actor: job.origin === "renter" ? `renter:${row.requesterName}` : "owner",
    action: "job.created",
    entityType: "job",
    entityId: row.id,
    skillId: skill.id,
    details: { origin: row.origin, version: version.version, status },
  });
  return row;
}

/**
 * A trial run of a chosen version: the owner tests a draft before publishing
 * it. Trials use the owner's own connections, start dry (every tool call asks
 * first unless told otherwise), never count toward trust or stats, and purge
 * like any other job. Tool skills wait for links; the trial page starts them.
 */
export async function openTrial(
  user: { id: string; name: string },
  input: { skillId: string; versionId: string; input: string; dryRun: boolean },
  actor: Actor,
) {
  const job = await openJob({
    skillId: input.skillId,
    origin: "trial",
    requesterName: user.name,
    requesterUserId: user.id,
    input: input.input,
    versionId: input.versionId,
  });
  await setJobToolPolicy(
    job.id,
    user.id,
    { mode: "approve_each", tools: [], dryRun: input.dryRun },
    actor,
  );
  return getJob(job.id);
}

/**
 * Drafts the job with the published version, runs the self-check, then either
 * sends it to the owner or auto-approves it, depending on the trust level.
 * Jobs with linked connections work in the renter's apps first (pausing for
 * approvals); revisions keep the first run's transcript — writes are never
 * redone.
 */
export async function draftJob(client: ModelClient, jobId: string, random = Math.random) {
  const job = await getJob(jobId);
  if (job.draft) return job;
  if ((await jobLinks(jobId)).length && !job.toolCalls.length) {
    const outcome = await runJobTools(client, jobId);
    if (outcome.paused) return getJob(jobId);
    return draftJobText(client, jobId, outcome.findings, random);
  }
  return draftJobText(client, jobId, job.toolFindings ?? "", random);
}

/** The text phase: draft from the input (plus tool findings), check, review or auto-approve. */
async function draftJobText(
  client: ModelClient,
  jobId: string,
  findings: string,
  random: () => number,
) {
  const job = await getJob(jobId);
  if (job.draft) return job;
  const version = await db().query.skillVersions.findFirst({
    where: eq(skillVersions.id, job.skillVersionId),
  });
  if (!version) throw new NotFoundError("Skill version is missing");
  const skill = await db().query.skills.findFirst({ where: eq(skills.id, job.skillId) });
  if (!skill) throw new NotFoundError("No such skill");

  const input = findings ? `${job.input}\n\nTool findings:\n${findings}` : job.input;
  const train = await trainingPairs(job.skillId);
  const shots = closestPairs(input, train, 3);
  // A renter asked for changes: revise the version they saw, with their request.
  const [round] = await db()
    .select()
    .from(jobRounds)
    .where(eq(jobRounds.jobId, jobId))
    .orderBy(desc(jobRounds.round))
    .limit(1);
  // Draft, check every statement against the input, redraft what isn't supported.
  const { draft, completion, grounding } = await draftGrounded(
    client,
    version.sheet,
    shots,
    input,
    round ? { previous: round.output, request: round.request } : undefined,
  );
  const flags = mergeFlags(
    groundingFlags(grounding),
    await selfCheck(
      client,
      version.sheet,
      input,
      draft,
      train.map((p) => p.input.length),
    ),
  );

  const review = needsOwnerReview({
    level: skill.trustLevel,
    flagged: flags.length > 0,
    ownerReviewRequired: job.ownerReviewRequired,
    spotCheckEvery: trustThresholds().spotCheckEvery,
    random,
  });
  const [row] = await db()
    .update(jobs)
    .set({
      draft,
      flags,
      grounding,
      shotExampleIds: shots.map((s) => s.id),
      model: completion.model,
      promptTokens: completion.promptTokens,
      completionTokens: completion.completionTokens,
      trustLevel: skill.trustLevel,
      ...(review
        ? { status: "review" as const }
        : {
            status: "approved" as const,
            finalOutput: draft,
            editSize: "none" as const,
            approvedBy: "auto" as const,
            reviewedAt: new Date(),
          }),
    })
    .where(eq(jobs.id, jobId))
    .returning();
  await audit({
    actor: "system",
    action: review ? "job.drafted" : "job.auto_approved",
    entityType: "job",
    entityId: jobId,
    skillId: job.skillId,
    details: {
      flags: flags.map((f) => f.kind),
      trustLevel: skill.trustLevel,
      statementsChecked: grounding.checked,
      unsupported: grounding.unsupported.length,
      redrafts: grounding.redrafts,
    },
  });
  return row;
}

/** Earlier versions of a job and the changes asked for, oldest first. */
export async function jobRoundsFor(jobId: string) {
  return db().select().from(jobRounds).where(eq(jobRounds.jobId, jobId)).orderBy(jobRounds.round);
}

/**
 * Sends a delivered job back for another round: keeps the version that was
 * delivered and the change asked for, clears the result, and drafts again.
 * The new draft goes through the same review gate as the first.
 */
export async function reviseJob(
  client: ModelClient,
  jobId: string,
  input: { output: string; request: string; round: number; actor: Actor },
) {
  await db().transaction(async (tx) => {
    const [job] = await tx
      .update(jobs)
      .set({
        status: "review",
        draft: "",
        finalOutput: null,
        editSize: null,
        approvedBy: null,
        reviewedAt: null,
        flags: [],
        grounding: null,
      })
      .where(and(eq(jobs.id, jobId), eq(jobs.status, "approved")))
      .returning({ skillId: jobs.skillId });
    if (!job) throw new Error("This order changed. Refresh and try again.");
    await tx
      .insert(jobRounds)
      .values({ jobId, round: input.round, output: input.output, request: input.request });
    await audit(
      {
        actor: input.actor,
        action: "job.revision_requested",
        entityType: "job",
        entityId: jobId,
        skillId: job.skillId,
        details: { round: input.round },
      },
      tx,
    );
  });
  return draftJob(client, jobId);
}

/** Open and draft in one step: owner jobs, and renter jobs paid with mock payments. */
export async function createJob(client: ModelClient, job: NewJob) {
  const row = await openJob(job);
  return draftJob(client, row.id);
}

/** A tool skill's job with no links yet waits for the requester to set it up. */
export async function jobNeedsSetup(jobId: string): Promise<boolean> {
  const { job, version } = await getJobWithSkill(jobId);
  if (job.draft || !(version.sheet.tools ?? []).length) return false;
  return (await jobLinks(jobId)).length === 0;
}

/**
 * The requester starts a job that waited for setup: links are required when
 * the skill declares tools, and the policy defaults to asking for each write.
 */
export async function startJob(client: ModelClient, jobId: string, userId: string) {
  const { job, version } = await getJobWithSkill(jobId);
  if (job.requesterUserId !== userId) {
    throw new Error("Only the person who asked for the job starts it.");
  }
  if (job.draft) return job;
  if (job.status === "awaiting_payment") {
    throw new Error("Work starts once the payment is confirmed.");
  }
  const actor: Actor = job.origin === "renter" ? `renter:${job.requesterName}` : "owner";
  const links = await jobLinks(jobId);
  if ((version.sheet.tools ?? []).length && !links.length) {
    throw new Error("Link at least one of your apps first.");
  }
  if (links.length && !job.toolPolicy) {
    await setJobToolPolicy(jobId, userId, { mode: "approve_each", tools: [] }, actor);
  }
  return draftJob(client, jobId);
}

/* ---------- Tool-using jobs ---------- */

interface RunnerContext {
  jobId: string;
  skillId: string;
  /** Whose tokens: the requester, or the skill owner for owner jobs. */
  ownerId: string;
  links: { kind: "app" | "mcp"; ref: string }[];
  policy: JobToolPolicy | null;
  /** Tools the skill declares; empty means any linked tool. */
  declaredTools: string[];
  actor: Actor;
  fetchFn?: typeof fetch;
}

async function runnerContext(
  jobId: string,
  actor: Actor,
  fetchFn?: typeof fetch,
): Promise<RunnerContext> {
  const { job, skill, version } = await getJobWithSkill(jobId);
  const ownerId = job.requesterUserId ?? skill.ownerId;
  if (!ownerId) throw new Error("This job has no account to act through.");
  return {
    jobId,
    skillId: job.skillId,
    ownerId,
    links: await jobLinks(jobId),
    policy: job.toolPolicy,
    declaredTools: version.sheet.tools ?? [],
    actor,
    fetchFn,
  };
}

interface ResolvedTool extends ToolSpec {
  link: { kind: "app" | "mcp"; ref: string };
  serverId: string | null;
}

async function listRunnerTools(ctx: RunnerContext): Promise<ResolvedTool[]> {
  const specs: ResolvedTool[] = [];
  const servers = ctx.links.some((l) => l.kind === "mcp")
    ? await listMcpServers(ctx.ownerId).catch(() => [])
    : [];
  for (const link of ctx.links) {
    if (link.kind === "app") {
      for (const tool of TOOLS.filter((t) => t.provider === link.ref)) {
        specs.push({
          name: tool.name,
          server: null,
          description: tool.description,
          writes: tool.writes,
          link,
          serverId: null,
        });
      }
    } else {
      // A server disconnected since linking offers nothing, rather than failing the job.
      const server = servers.find((s) => s.id === link.ref);
      if (!server) continue;
      // MCP servers don't say which tools write, so every MCP tool needs
      // approval (fail-closed).
      for (const t of server.tools) {
        specs.push({
          name: t.name,
          server: server.name,
          description: t.description,
          writes: true,
          link,
          serverId: server.id,
        });
      }
    }
  }
  if (ctx.declaredTools.length) return specs.filter((s) => ctx.declaredTools.includes(s.name));
  return specs;
}

/** Latest decision for this exact call, if the renter made one. */
async function latestDecision(
  ctx: RunnerContext,
  call: ToolCall,
): Promise<{ status: string; id: string } | null> {
  const rows = await db()
    .select()
    .from(jobApprovals)
    .where(and(eq(jobApprovals.jobId, ctx.jobId), eq(jobApprovals.tool, call.tool)))
    .orderBy(desc(jobApprovals.createdAt))
    .limit(5);
  // Stored args are truncated; compare truncated forms.
  const want = JSON.stringify(truncateValue(call.args));
  return rows.find((r) => JSON.stringify(r.args) === want) ?? null;
}

async function runRunnerTool(ctx: RunnerContext, call: ToolCall): Promise<ToolOutcome> {
  const specs = await listRunnerTools(ctx);
  const serverName = call.server?.trim() || null;
  const spec =
    specs.find((s) => s.name === call.tool && s.server === serverName) ??
    (serverName
      ? specs.find(
          (s) => s.name === call.tool && s.server?.toLowerCase() === serverName.toLowerCase(),
        )
      : undefined);
  if (!spec) {
    return {
      status: "error",
      result: null,
      targetId: null,
      preview: call.tool,
      message: `No tool ${serverName ? `${serverName} / ` : ""}${call.tool} on this job.`,
    };
  }
  const appTool = spec.server ? null : toolNamed(spec.name);
  let parsedArgs: Record<string, unknown> = call.args;
  if (appTool) {
    try {
      parsedArgs = appTool.args.parse(call.args) as Record<string, unknown>;
    } catch {
      return {
        status: "error",
        result: null,
        targetId: null,
        preview: spec.name,
        message: `Those arguments don't fit ${spec.name}.`,
      };
    }
  }
  const argText = JSON.stringify(call.args);
  const preview = spec.server
    ? `Run ${spec.name} on ${spec.server} with ${argText.length > 300 ? `${argText.slice(0, 300)}…` : argText}`
    : (appTool?.preview?.(parsedArgs) ?? spec.name);
  const decision = spec.writes ? await latestDecision(ctx, call) : null;
  if (decision?.status === "denied") {
    return {
      status: "denied",
      result: null,
      targetId: null,
      preview,
      approvalId: decision.id,
      message: "The renter declined this call.",
    };
  }
  const verdict = policyAllows(
    ctx.policy,
    { writes: spec.writes, tool: spec.name },
    decision?.status === "approved",
  );
  if (verdict === "ask") {
    if (decision?.status === "pending") {
      return { status: "pending", result: null, targetId: null, preview, approvalId: decision.id };
    }
    const [row] = await db()
      .insert(jobApprovals)
      .values({
        jobId: ctx.jobId,
        tool: spec.name,
        server: spec.server,
        args: truncateValue(call.args) as Record<string, unknown>,
        preview,
        status: "pending",
      })
      .returning({ id: jobApprovals.id });
    await audit({
      actor: ctx.actor,
      action: "job.tool_pending",
      entityType: "job",
      entityId: ctx.jobId,
      skillId: ctx.skillId,
      details: { tool: spec.name, ...(spec.server && { server: spec.server }) },
    });
    return { status: "pending", result: null, targetId: null, preview, approvalId: row.id };
  }
  try {
    const raw = spec.server
      ? await runMcpTool(ctx, spec, call.args)
      : await runAppTool(ctx, appTool!, parsedArgs);
    const targetId =
      spec.server && typeof raw === "string" ? targetInText(raw) : targetOf(spec.name, raw);
    const result = truncateValue(raw);
    await audit({
      actor: ctx.actor,
      action: "job.tool_call",
      entityType: "job",
      entityId: ctx.jobId,
      skillId: ctx.skillId,
      details: {
        tool: spec.name,
        ...(spec.server && { server: spec.server }),
        ...(targetId && { targetId }),
        status: "done",
      },
    });
    return { status: "done", result, targetId, preview };
  } catch (error) {
    const message = error instanceof Error ? error.message : "The call failed.";
    await audit({
      actor: ctx.actor,
      action: "job.tool_call",
      entityType: "job",
      entityId: ctx.jobId,
      skillId: ctx.skillId,
      details: {
        tool: spec.name,
        ...(spec.server && { server: spec.server }),
        status: "error",
      },
    });
    return { status: "error", result: null, targetId: null, preview, message };
  }
}

async function runAppTool(
  ctx: RunnerContext,
  tool: NonNullable<ReturnType<typeof toolNamed>>,
  args: Record<string, unknown>,
): Promise<unknown> {
  const token = await accessTokenFor(ctx.ownerId, tool.provider);
  const account = await connectionAccountFor(ctx.ownerId, tool.provider);
  // Jobs carry no clock; local times in args are read as UTC.
  return tool.run(args, { token, account, offset: 0, fetch: ctx.fetchFn ?? fetch });
}

async function runMcpTool(
  ctx: RunnerContext,
  spec: ResolvedTool,
  args: Record<string, unknown>,
): Promise<string> {
  const { client } = await mcpServerClient(ctx.ownerId, spec.serverId!, ctx.fetchFn);
  const out = await client.callTool(spec.name, args);
  if (out.isError) throw new Error(out.text.slice(0, 500));
  return out.text;
}

/** The real runner for a job: linked connections, policy, approvals, audit. */
export async function jobToolRunner(
  jobId: string,
  actor: Actor,
  fetchFn?: typeof fetch,
): Promise<ToolRunner> {
  const ctx = await runnerContext(jobId, actor, fetchFn);
  return {
    list: () => listRunnerTools(ctx),
    run: (call) => runRunnerTool(ctx, call),
  };
}

/**
 * The tool phase: works through the renter's apps, persists the transcript,
 * and pauses for approvals. Returns findings for the draft, or paused.
 */
export async function runJobTools(
  client: ModelClient,
  jobId: string,
  fetchFn?: typeof fetch,
): Promise<{ paused: boolean; findings: string }> {
  const job = await getJob(jobId);
  const actor: Actor = job.origin === "renter" ? `renter:${job.requesterName}` : "owner";
  const runner = await jobToolRunner(jobId, actor, fetchFn);
  const result = await runToolLoop(client, runner, { brief: job.input, transcript: job.toolCalls });
  await db().update(jobs).set({ toolCalls: result.transcript }).where(eq(jobs.id, jobId));
  if (result.pending) {
    await db().update(jobs).set({ status: "awaiting_approval" }).where(eq(jobs.id, jobId));
    await audit({
      actor,
      action: "job.tools_paused",
      entityType: "job",
      entityId: jobId,
      skillId: job.skillId,
      details: { tool: result.pending.tool },
    });
    return { paused: true, findings: "" };
  }
  const findings = result.done ? result.findings : "(Tool work stopped before finishing.)";
  await db()
    .update(jobs)
    .set({ toolFindings: findings || null })
    .where(eq(jobs.id, jobId));
  await verifyJobWrites(jobId, result.transcript, runner, actor);
  return { paused: false, findings };
}

/**
 * The renter decides on a write, then the job resumes: the loop re-runs the
 * decided call first and drafting continues when nothing else waits.
 */
export async function decideJobApproval(
  client: ModelClient,
  jobId: string,
  input: { approvalId: string; approve: boolean; userId: string; actor: Actor },
  fetchFn?: typeof fetch,
) {
  const job = await getJob(jobId);
  if (job.requesterUserId !== input.userId) {
    throw new Error("Only the person who asked for the job decides on its writes.");
  }
  const [approval] = await db()
    .select()
    .from(jobApprovals)
    .where(and(eq(jobApprovals.id, input.approvalId), eq(jobApprovals.jobId, jobId)));
  if (!approval || approval.status !== "pending") {
    throw new Error("That request is already decided.");
  }
  await db()
    .update(jobApprovals)
    .set({
      status: input.approve ? "approved" : "denied",
      decidedBy: input.actor,
      decidedAt: new Date(),
    })
    .where(eq(jobApprovals.id, approval.id));
  await audit({
    actor: input.actor,
    action: input.approve ? "job.tool_approved" : "job.tool_denied",
    entityType: "job",
    entityId: jobId,
    skillId: job.skillId,
    details: { tool: approval.tool, ...(approval.server && { server: approval.server }) },
  });
  if (job.draft) return getJob(jobId);
  const outcome = await runJobTools(client, jobId, fetchFn);
  if (outcome.paused) return getJob(jobId);
  return draftJobText(client, jobId, outcome.findings, Math.random);
}

/**
 * Read-back: after writing, check the result is really there. Native writes
 * with a known read-back are re-read; MCP writes pass when a later read in
 * the transcript mentions what they created. Missing ones flag the job for
 * owner review. Verification reads are audited but stay out of the
 * transcript, which is the loop's own work.
 */
async function verifyJobWrites(
  jobId: string,
  transcript: JobToolCall[],
  runner: ToolRunner,
  actor: Actor,
): Promise<void> {
  const job = await getJob(jobId);
  const specs = await runner.list();
  const writes = new Set(specs.filter((s) => s.writes).map((s) => `${s.server ?? ""} ${s.name}`));
  let changed = false;
  for (let i = 0; i < transcript.length; i++) {
    const call = transcript[i];
    if (call.status !== "done" || !writes.has(`${call.server ?? ""} ${call.tool}`)) continue;
    const verified = await verifyOneWrite(runner, transcript, i);
    if (verified !== call.verified) {
      call.verified = verified;
      changed = true;
    }
  }
  const missing = transcript.filter((c) => c.verified === false);
  if (changed || missing.length) {
    await db()
      .update(jobs)
      .set({
        ...(changed && { toolCalls: transcript }),
        ...(missing.length && {
          flags: [
            ...job.flags,
            ...missing.map((c) => ({
              kind: "uncertain" as const,
              message: `Created with ${c.server ? `${c.server} / ` : ""}${c.tool} but couldn't read it back.`,
            })),
          ],
        }),
      })
      .where(eq(jobs.id, jobId));
  }
  await audit({
    actor,
    action: "job.tools_verified",
    entityType: "job",
    entityId: jobId,
    skillId: job.skillId,
    details: {
      checked: transcript.filter((c) => c.verified !== null).length,
      missing: missing.length,
    },
  });
}

async function verifyOneWrite(
  runner: ToolRunner,
  transcript: JobToolCall[],
  index: number,
): Promise<boolean | null> {
  const call = transcript[index];
  // An MCP write passes when a later read in the transcript mentions its receipt.
  if (call.server) {
    if (!call.targetId) return null;
    const receipt: string = call.targetId;
    return transcript
      .slice(index + 1)
      .some((later) => later.status === "done" && JSON.stringify(later.result).includes(receipt))
      ? true
      : null;
  }
  const read = async (tool: string, args: Record<string, unknown>) => {
    const out = await runner.run({ tool, server: null, args });
    return out.status === "done" ? JSON.stringify(out.result) : null;
  };
  const args = call.args as Record<string, unknown>;
  if (call.tool === "notion_create_page" && typeof args.title === "string") {
    const found = await read("notion_search", { query: args.title });
    if (found === null) return null;
    return found.includes(call.targetId ?? args.title);
  }
  if (
    call.tool === "calendar_create" &&
    typeof args.title === "string" &&
    typeof args.start === "string"
  ) {
    const found = await read("calendar_list", { from: args.start, days: 1 });
    if (found === null) return null;
    return found.includes(args.title);
  }
  // Sends and posts are accepted on the provider's confirmation.
  return null;
}

/** The owner's decision. Approving with changes records how big the edit was. */
export async function reviewJob(
  jobId: string,
  decision: "approve" | "reject",
  finalOutput?: string,
) {
  const job = await getJob(jobId);
  if (job.origin === "trial") throw new Error("Trials aren't reviewed; run another if it missed.");
  if (job.status !== "review") throw new Error("This job isn't waiting for review");

  if (decision === "reject") {
    await db()
      .update(jobs)
      .set({
        status: "rejected",
        editSize: "rejected",
        approvedBy: "owner",
        reviewedAt: new Date(),
      })
      .where(eq(jobs.id, jobId));
    await audit({
      actor: "owner",
      action: "job.rejected",
      entityType: "job",
      entityId: jobId,
      skillId: job.skillId,
    });
    await refundForJob(jobId, "Declined by the skill owner", "owner");
    return;
  }

  const final = normalizeText(finalOutput ?? job.draft);
  if (!final) throw new Error("The approved output is empty");
  const editSize = classifyEdit(job.draft, final);
  await db()
    .update(jobs)
    .set({
      status: "approved",
      finalOutput: final,
      editSize,
      approvedBy: "owner",
      reviewedAt: new Date(),
    })
    .where(eq(jobs.id, jobId));
  await audit({
    actor: "owner",
    action: "job.approved",
    entityType: "job",
    entityId: jobId,
    skillId: job.skillId,
    details: { editSize },
  });
}

/**
 * A renter reports a problem with a delivered result. The payment is refunded
 * and the skill drops back to level 0: every result is reviewed again.
 */
export async function complainAboutJob(jobId: string, complaint: string) {
  const job = await getJob(jobId);
  if (job.origin !== "renter" || job.status !== "approved") {
    throw new Error("Only delivered orders can be reported");
  }
  if (job.complainedAt) throw new Error("A problem was already reported for this order");
  const text = complaint.trim();
  if (text.length < 5) throw new Error("Say briefly what went wrong");

  const actor: Actor = `renter:${job.requesterName}`;
  await db()
    .update(jobs)
    .set({ complaint: text.slice(0, 1000), complainedAt: new Date() })
    .where(eq(jobs.id, jobId));
  await setTrustLevelUnchecked(job.skillId, 0, actor, "complaint");
  await audit({
    actor,
    action: "job.complaint",
    entityType: "job",
    entityId: jobId,
    skillId: job.skillId,
  });
  await refundForJob(jobId, "Renter reported a problem", actor);
}

export async function getJob(jobId: string) {
  const job = await db().query.jobs.findFirst({ where: eq(jobs.id, jobId) });
  if (!job) throw new NotFoundError(`No job ${jobId}`);
  return job;
}

export async function getJobWithSkill(jobId: string) {
  const [row] = await db()
    .select({ job: jobs, skill: skills, version: skillVersions })
    .from(jobs)
    .innerJoin(skills, eq(jobs.skillId, skills.id))
    .innerJoin(skillVersions, eq(jobs.skillVersionId, skillVersions.id))
    .where(eq(jobs.id, jobId));
  if (!row) throw new NotFoundError(`No job ${jobId}`);
  return row;
}

/** Jobs on the given skills, or on every skill when null (admins). */
export async function listJobs(skillIds: string[] | null) {
  await purgeExpiredJobs();
  if (skillIds && skillIds.length === 0) return [];
  return db()
    .select({ job: jobs, skill: skills, version: skillVersions })
    .from(jobs)
    .innerJoin(skills, eq(jobs.skillId, skills.id))
    .innerJoin(skillVersions, eq(jobs.skillVersionId, skillVersions.id))
    .where(skillIds ? inArray(jobs.skillId, skillIds) : undefined)
    .orderBy(desc(jobs.createdAt));
}

/** Orders this renter placed, newest first. */
export async function listOrdersFor(userId: string) {
  return db()
    .select({ job: jobs, skill: skills })
    .from(jobs)
    .innerJoin(skills, eq(jobs.skillId, skills.id))
    .where(and(eq(jobs.requesterUserId, userId), eq(jobs.origin, "renter")))
    .orderBy(desc(jobs.createdAt));
}

/** Deletes jobs past their retention date. Transactions survive with job_id cleared. */
export async function purgeExpiredJobs(now = new Date()) {
  const removed = await db().delete(jobs).where(lt(jobs.expiresAt, now)).returning({ id: jobs.id });
  if (removed.length) {
    await audit({
      actor: "system",
      action: "jobs.purged",
      entityType: "job",
      details: { count: removed.length },
    });
  }
  return removed.length;
}

/** Approval stats: the share of owner-reviewed jobs approved unchanged or with minor edits. */
export function approvalStats(rows: { status: string; editSize: string | null }[]) {
  const reviewed = rows.filter((r) => r.status === "approved" || r.status === "rejected");
  const good = reviewed.filter((r) => r.editSize === "none" || r.editSize === "minor").length;
  return {
    reviewed: reviewed.length,
    approvedClean: good,
    rate: reviewed.length ? Math.round((good / reviewed.length) * 1000) / 10 : null,
  };
}

/** The record the trust ladder is judged on: jobs on the currently published version. */
export async function trustRecord(skillId: string): Promise<TrustRecord> {
  const skill = await db().query.skills.findFirst({ where: eq(skills.id, skillId) });
  if (!skill?.publishedVersionId) {
    return {
      reviewed: 0,
      clean: 0,
      rejected: 0,
      jobsAtLevel1: 0,
      rejectedAtLevel1: 0,
      complaints: 0,
    };
  }
  const rows = (
    await db()
      .select({
        origin: jobs.origin,
        status: jobs.status,
        editSize: jobs.editSize,
        approvedBy: jobs.approvedBy,
        trustLevel: jobs.trustLevel,
        complainedAt: jobs.complainedAt,
      })
      .from(jobs)
      .where(eq(jobs.skillVersionId, skill.publishedVersionId))
  ).filter((r) => r.origin !== "trial");
  const ownerReviewed = rows.filter(
    (r) => r.approvedBy === "owner" && (r.status === "approved" || r.status === "rejected"),
  );
  const atLevel1 = rows.filter(
    (r) => r.trustLevel >= 1 && (r.status === "approved" || r.status === "rejected"),
  );
  return {
    reviewed: ownerReviewed.length,
    clean: ownerReviewed.filter((r) => r.editSize === "none" || r.editSize === "minor").length,
    rejected: ownerReviewed.filter((r) => r.status === "rejected").length,
    jobsAtLevel1: atLevel1.length,
    rejectedAtLevel1: atLevel1.filter((r) => r.status === "rejected").length,
    complaints: rows.filter((r) => r.complainedAt).length,
  };
}

export async function trustStatus(skillId: string) {
  const record = await trustRecord(skillId);
  return { record, levels: eligibility(record, trustThresholds()) };
}

/** The owner climbs or steps down the ladder. Climbing needs the record; stepping down never does. */
export async function setTrustLevel(skillId: string, level: TrustLevel) {
  const skill = await db().query.skills.findFirst({ where: eq(skills.id, skillId) });
  if (!skill) throw new NotFoundError("No such skill");
  if (
    level > skill.trustLevel &&
    !canSetLevel(level, await trustRecord(skillId), trustThresholds())
  ) {
    throw new Error(`This skill hasn't earned level ${level} yet`);
  }
  await setTrustLevelUnchecked(skillId, level, "owner", "owner decision");
}

async function setTrustLevelUnchecked(
  skillId: string,
  level: TrustLevel,
  actor: Actor,
  reason: string,
) {
  const [before] = await db()
    .select({ level: skills.trustLevel })
    .from(skills)
    .where(eq(skills.id, skillId));
  if (before?.level === level) return;
  await db().update(skills).set({ trustLevel: level }).where(eq(skills.id, skillId));
  await audit({
    actor,
    action: "trust.changed",
    entityType: "skill",
    entityId: skillId,
    skillId,
    details: { from: before?.level, to: level, reason },
  });
}

/** Jobs from the last `days` days that the owner hasn't had to look at. */
export async function autoApprovedCount(skillId: string, days = 7) {
  const since = new Date(Date.now() - days * 86_400_000);
  const rows = await db()
    .select({ id: jobs.id })
    .from(jobs)
    .where(and(eq(jobs.skillId, skillId), eq(jobs.approvedBy, "auto"), gte(jobs.createdAt, since)));
  return rows.length;
}
