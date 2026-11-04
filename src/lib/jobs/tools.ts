/**
 * Tools for jobs: which of the renter's connections a job may act through,
 * the approval policy for writes, and the small helpers the runner uses.
 * Tool outputs are job material: stored with the job and purged with it,
 * never copied into skills, examples or corrections. The seller sees that
 * tools ran (tool name, server label, target id, status) but never the
 * renter's connections themselves.
 */
import { and, eq } from "drizzle-orm";
import { db } from "@/db/client";
import {
  appConnections,
  jobApprovals,
  jobConnections,
  jobs,
  mcpServers,
  skillVersions,
  type JobConnection,
  type JobToolPolicy,
} from "@/db/schema";
import { audit, type Actor } from "@/lib/audit";
import { PROVIDERS, isProvider } from "@/lib/connections/providers";
import { NotFoundError } from "@/lib/skill/service";

/** A linked connection, as the runner sees it. */
export interface JobLink {
  kind: "app" | "mcp";
  ref: string;
}

export const isJobLinkKind = (value: string): value is JobLink["kind"] =>
  value === "app" || value === "mcp";

/**
 * Whether a call runs now or waits for the renter: reads run freely within
 * linked connections; writes run when approved or preapproved for the tool.
 */
export function policyAllows(
  policy: JobToolPolicy | null,
  call: { writes: boolean; tool: string },
  approved: boolean,
): "run" | "ask" {
  if (policy?.dryRun && !approved) return "ask";
  if (!call.writes) return "run";
  if (approved) return "run";
  if (policy?.mode === "preapproved" && policy.tools.includes(call.tool)) return "run";
  return "ask";
}

/**
 * Id or link of what a call created, for the transcript and audit. Known
 * tool shapes first, then the common id fields. Null when unrecognized.
 */
export function targetOf(tool: string, result: unknown): string | null {
  if (!result || typeof result !== "object") return null;
  const r = result as Record<string, unknown>;
  const str = (value: unknown) => (typeof value === "string" && value ? value : null);
  if (tool === "notion_create_page") return str(r.url);
  if (tool === "calendar_create") return str(r.link);
  if (tool === "facebook_post" || tool === "x_post") return str(r.id);
  return str(r.url) ?? str(r.link) ?? str(r.id) ?? str(r.targetId);
}

/** First URL in free text (an MCP write's receipt), for the transcript and audit. */
export function targetInText(text: string): string | null {
  const match = text.match(/https?:\/\/[^\s)>\]]+/);
  return match?.[0] ?? null;
}

/** Cap a stored value: job material, but bounded. */
export function truncateValue(value: unknown, maxChars = 4000): unknown {
  const text = JSON.stringify(value) ?? "null";
  if (text.length <= maxChars) return value ?? null;
  return { truncated: `${text.slice(0, maxChars)}…`, chars: text.length };
}

/**
 * Links one of the requester's own connections to a job, before it starts.
 * The connection must already be theirs; the seller never sees these links.
 */
export async function linkJobConnection(
  jobId: string,
  ownerId: string,
  link: JobLink,
  actor: Actor,
): Promise<void> {
  const job = await db().query.jobs.findFirst({ where: eq(jobs.id, jobId) });
  if (!job) throw new NotFoundError(`No job ${jobId}`);
  if (job.requesterUserId !== ownerId) {
    throw new Error("Only the person who asked for the job links their apps to it.");
  }
  if (job.draft) throw new Error("This job already started; its connections are fixed.");
  if (link.kind === "app") {
    if (!isProvider(link.ref)) throw new Error("Unknown app.");
    const [conn] = await db()
      .select({ id: appConnections.id })
      .from(appConnections)
      .where(and(eq(appConnections.userId, ownerId), eq(appConnections.provider, link.ref)));
    if (!conn) throw new Error(`Connect ${PROVIDERS[link.ref].name} first.`);
  } else if (link.kind === "mcp") {
    const [srv] = await db()
      .select({ id: mcpServers.id })
      .from(mcpServers)
      .where(and(eq(mcpServers.userId, ownerId), eq(mcpServers.id, link.ref)));
    if (!srv) throw new Error("That MCP server isn't connected.");
  } else {
    throw new Error("Unknown connection kind.");
  }
  await db()
    .insert(jobConnections)
    .values({ jobId, kind: link.kind, ref: link.ref })
    .onConflictDoNothing();
  await audit({
    actor,
    action: "job.connection_linked",
    entityType: "job",
    entityId: jobId,
    skillId: job.skillId,
    details: { kind: link.kind },
  });
}

/** Removes a link before the job starts. */
export async function unlinkJobConnection(
  jobId: string,
  ownerId: string,
  link: JobLink,
  actor: Actor,
): Promise<void> {
  const job = await db().query.jobs.findFirst({ where: eq(jobs.id, jobId) });
  if (!job) throw new NotFoundError(`No job ${jobId}`);
  if (job.requesterUserId !== ownerId) {
    throw new Error("Only the person who asked for the job changes its connections.");
  }
  if (job.draft) throw new Error("This job already started; its connections are fixed.");
  await db()
    .delete(jobConnections)
    .where(
      and(
        eq(jobConnections.jobId, jobId),
        eq(jobConnections.kind, link.kind),
        eq(jobConnections.ref, link.ref),
      ),
    );
  await audit({
    actor,
    action: "job.connection_unlinked",
    entityType: "job",
    entityId: jobId,
    skillId: job.skillId,
    details: { kind: link.kind },
  });
}

/**
 * A job's linked connections: full refs for the requester, who owns them;
 * nothing for anyone else (the seller never sees them).
 */
export async function jobConnectionsFor(jobId: string, viewerId: string): Promise<JobConnection[]> {
  const job = await db().query.jobs.findFirst({ where: eq(jobs.id, jobId) });
  if (!job) throw new NotFoundError(`No job ${jobId}`);
  if (job.requesterUserId !== viewerId) return [];
  return db().select().from(jobConnections).where(eq(jobConnections.jobId, jobId));
}

/** Links for the runner (no viewer: the job acts through them, never shows them). */
export async function jobLinks(jobId: string): Promise<JobLink[]> {
  const rows = await db().select().from(jobConnections).where(eq(jobConnections.jobId, jobId));
  return rows.flatMap((r) => (isJobLinkKind(r.kind) ? [{ kind: r.kind, ref: r.ref }] : []));
}

/**
 * Sets the job's tool policy: approve each write, or pre-approve named
 * tools. Only the requester, before the job starts.
 */
export async function setJobToolPolicy(
  jobId: string,
  ownerId: string,
  policy: JobToolPolicy,
  actor: Actor,
): Promise<void> {
  const job = await db().query.jobs.findFirst({ where: eq(jobs.id, jobId) });
  if (!job) throw new NotFoundError(`No job ${jobId}`);
  if (job.requesterUserId !== ownerId) {
    throw new Error("Only the person who asked for the job sets its approval policy.");
  }
  if (job.draft) throw new Error("This job already started; its policy is fixed.");
  if (policy.mode !== "approve_each" && policy.mode !== "preapproved") {
    throw new Error("Unknown approval policy.");
  }
  const tools = [...new Set(policy.tools.map((t) => t.trim()).filter(Boolean))].slice(0, 50);
  const dryRun = policy.dryRun ?? job.toolPolicy?.dryRun;
  await db()
    .update(jobs)
    .set({ toolPolicy: { mode: policy.mode, tools, ...(dryRun === undefined ? {} : { dryRun }) } })
    .where(eq(jobs.id, jobId));
  await audit({
    actor,
    action: "job.tool_policy",
    entityType: "job",
    entityId: jobId,
    skillId: job.skillId,
    details: { mode: policy.mode, tools: tools.length, ...(dryRun ? { dryRun: true } : {}) },
  });
}

/**
 * Setup state for the order and job pages: whether the job started, what
 * the skill declares, the policy, and the links. Requester only; null for
 * anyone else. Never content.
 */
export async function jobToolSetup(
  jobId: string,
  viewerId: string,
): Promise<{
  started: boolean;
  declaredTools: string[];
  policy: JobToolPolicy | null;
  links: JobConnection[];
} | null> {
  const job = await db().query.jobs.findFirst({ where: eq(jobs.id, jobId) });
  if (!job || job.requesterUserId !== viewerId) return null;
  const version = await db().query.skillVersions.findFirst({
    where: eq(skillVersions.id, job.skillVersionId),
  });
  return {
    started: Boolean(job.draft),
    declaredTools: version?.sheet.tools ?? [],
    policy: job.toolPolicy,
    links: await jobConnectionsFor(jobId, viewerId),
  };
}

/** Approvals waiting on, or decided for, a job. Requester only. */
export async function jobApprovalsFor(jobId: string, viewerId: string) {
  const job = await db().query.jobs.findFirst({ where: eq(jobs.id, jobId) });
  if (!job) throw new NotFoundError(`No job ${jobId}`);
  if (job.requesterUserId !== viewerId) return [];
  return db().select().from(jobApprovals).where(eq(jobApprovals.jobId, jobId));
}
