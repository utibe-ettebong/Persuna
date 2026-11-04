import type { Metadata } from "next";
import Link from "next/link";
import { reviewJobAction, teachFromJobAction } from "@/app/actions/jobs";
import { ActionForm } from "@/components/action-form";
import { JobApprovals, JobToolSetup } from "@/components/job-tools";
import { Badge, buttonClass, Card, Field, inputClass, PageHeader, Prose } from "@/components/ui";
import { WordDiff } from "@/components/word-diff";
import { getJobWithSkill, jobRoundsFor } from "@/lib/jobs/service";
import { jobApprovalsFor, jobToolSetup } from "@/lib/jobs/tools";
import { listConnections } from "@/lib/connections/service";
import { listMcpServers } from "@/lib/mcp/service";
import { assertJobOwner } from "@/lib/auth/access";
import { requireUser } from "@/lib/auth/session";
import { looksLikeCsv } from "@/lib/docs/csv";
import { orNotFound } from "@/lib/load";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Review job" };

type Params = { params: Promise<{ id: string }> };

export default async function JobPage({ params }: Params) {
  const { id } = await params;
  const user = await requireUser();
  const { job, skill, version } = await orNotFound(async () => {
    await assertJobOwner(user, id);
    return getJobWithSkill(id);
  }, id);
  const edited = job.status === "approved" && job.editSize !== "none";
  const rounds = await jobRoundsFor(job.id);
  const lastRound = rounds.at(-1);
  const isTrial = job.origin === "trial";
  const trialPublished = job.skillVersionId === skill.publishedVersionId;
  // Setup and approvals show only when you are the requester (your own jobs);
  // a renter's links and approvals stay on their order page.
  const [setup, approvals, apps, servers] = await Promise.all([
    jobToolSetup(id, user.id),
    jobApprovalsFor(id, user.id),
    listConnections(user.id).catch(() => []),
    listMcpServers(user.id).catch(() => []),
  ]);

  return (
    <div className="space-y-6">
      <PageHeader
        back={{ href: "/jobs", label: "Jobs" }}
        title={skill.name}
        description={
          <>
            v{version.version}
            {isTrial && !trialPublished ? " (unpublished)" : ""} ·{" "}
            {job.origin === "renter"
              ? `Rented by ${job.requesterName}`
              : isTrial
                ? "Your trial run"
                : "Your job"}{" "}
            · deleted on {job.expiresAt.toLocaleDateString("en-GB", { dateStyle: "medium" })}
          </>
        }
      >
        {job.status === "approved" && (
          <>
            <a href={`/jobs/${job.id}/download?format=docx`} className={buttonClass("primary")}>
              Download .docx
            </a>
            <a href={`/jobs/${job.id}/download?format=pdf`} className={buttonClass("secondary")}>
              .pdf
            </a>
            <a href={`/jobs/${job.id}/download?format=pptx`} className={buttonClass("secondary")}>
              .pptx
            </a>
            {job.finalOutput && looksLikeCsv(job.finalOutput) && (
              <a href={`/jobs/${job.id}/download?format=xlsx`} className={buttonClass("secondary")}>
                .xlsx
              </a>
            )}
            <a href={`/jobs/${job.id}/download?format=md`} className={buttonClass("secondary")}>
              .md
            </a>
          </>
        )}
      </PageHeader>

      <div className="flex flex-wrap gap-2">
        {isTrial && <Badge>Trial</Badge>}
        {isTrial && job.toolPolicy?.dryRun !== false && <Badge>dry run: every call asks</Badge>}
        {job.status === "awaiting_payment" && <Badge>waiting for the renter&apos;s payment</Badge>}
        {job.status === "awaiting_approval" && (
          <Badge tone="accent">
            {job.origin === "renter" ? "waiting for the renter's approval" : "needs your approval"}
          </Badge>
        )}
        {job.status === "review" && !isTrial && <Badge tone="accent">needs your review</Badge>}
        {job.approvedBy === "auto" && <Badge>auto-approved at trust level {job.trustLevel}</Badge>}
        {job.ownerReviewRequired && <Badge tone="accent">renter paid for your review</Badge>}
        {job.complaint && <Badge tone="danger">renter reported a problem</Badge>}
        {job.status === "approved" && <Badge tone="good">approved</Badge>}
        {job.status === "rejected" && <Badge tone="danger">rejected</Badge>}
        {job.editSize && job.editSize !== "rejected" && <Badge>{job.editSize} edit</Badge>}
        {job.rating && <Badge tone="good">renter rated {job.rating}/5</Badge>}
      </div>

      {job.grounding && (
        <Card
          className={`p-4 text-sm ${job.grounding.unsupported.length ? "border-warn/50" : "border-good/40"}`}
        >
          <h2
            className={`text-sm font-semibold ${job.grounding.unsupported.length ? "text-warn" : "text-good"}`}
          >
            {job.grounding.unsupported.length
              ? `${job.grounding.unsupported.length} of ${job.grounding.checked} statements aren't backed by the input`
              : `All ${job.grounding.checked} statements checked against the input`}
          </h2>
          <p className="mt-1 text-muted">
            Each fact in the draft was matched to the exact words in the input that support it, and
            each quote was checked word for word.
            {job.grounding.redrafts > 0 &&
              ` The draft was rewritten ${job.grounding.redrafts === 1 ? "once" : `${job.grounding.redrafts} times`} to remove unsupported statements.`}
          </p>
          {job.grounding.unsupported.length > 0 && (
            <ul className="mt-2 list-disc space-y-1 pl-5">
              {job.grounding.unsupported.map((c, i) => (
                <li key={i}>{c.claim}</li>
              ))}
            </ul>
          )}
        </Card>
      )}

      {job.flags.length > 0 && (
        <Card className="border-warn/50 p-4">
          <h2 className="text-sm font-semibold text-warn">
            The agent&apos;s self-check flagged this
          </h2>
          <ul className="mt-2 space-y-1 text-sm">
            {job.flags.map((f, i) => (
              <li key={i}>
                <span className="font-mono text-xs text-muted">{f.kind.replace("_", " ")}</span>{" "}
                {f.message}
              </li>
            ))}
          </ul>
        </Card>
      )}

      {job.complaint && (
        <Card className="border-danger/40 p-4 text-sm">
          <p className="font-semibold text-danger">Renter&apos;s complaint</p>
          <p className="mt-1">{job.complaint}</p>
          <p className="mt-1 text-muted">
            The renter was refunded and the skill is back to level 0.
          </p>
        </Card>
      )}

      {setup && !setup.started && setup.declaredTools.length > 0 && (
        <JobToolSetup jobId={id} page="job" setup={setup} apps={apps} servers={servers} />
      )}

      <JobApprovals jobId={id} page="job" approvals={approvals} />

      {lastRound && (
        <Card className="space-y-2 p-4">
          <h2 className="label-mono text-muted">
            Change request {lastRound.round} from {job.requesterName}
          </h2>
          <p className="text-sm">&ldquo;{lastRound.request}&rdquo;</p>
          <details>
            <summary className="cursor-pointer text-sm text-muted">
              The version they asked to change
            </summary>
            <div className="mt-2 rounded-md bg-subtle p-3">
              <Prose>{lastRound.output}</Prose>
            </div>
          </details>
        </Card>
      )}

      <div className="grid gap-6 lg:grid-cols-2">
        <Card className="p-4">
          <h2 className="mb-2 label-mono text-muted">Input</h2>
          <Prose>{job.input}</Prose>
        </Card>

        {isTrial && job.status === "review" && job.draft ? (
          <Card className="p-4">
            <h2 className="mb-2 label-mono text-muted">Trial result</h2>
            <Prose>{job.draft}</Prose>
            <p className="mt-3 text-sm text-muted">
              Trials never count toward trust, earnings, or stats.{" "}
              <Link href={`/skills/${skill.slug}#try-it`} className="underline">
                Run another trial
              </Link>
            </p>
          </Card>
        ) : isTrial && !job.draft ? (
          <Card className="p-4">
            <h2 className="mb-2 label-mono text-muted">Trial waiting to run</h2>
            <p className="text-sm text-muted">
              Link your apps below, then start the trial. Each tool call asks first.
            </p>
          </Card>
        ) : job.status === "review" ? (
          <Card className="p-4">
            <ActionForm
              action={reviewJobAction}
              pendingLabel="Saving…"
              className="space-y-3"
              buttons={[
                { label: "Approve", intent: "approve" },
                { label: "Reject", intent: "reject", variant: "danger" },
              ]}
            >
              <input type="hidden" name="jobId" value={job.id} />
              <Field label="Agent draft" hint="edit anything before approving">
                <textarea
                  name="finalOutput"
                  defaultValue={job.draft}
                  rows={22}
                  className={`${inputClass} font-mono text-xs`}
                />
              </Field>
            </ActionForm>
          </Card>
        ) : (
          <Card className="p-4">
            <h2 className="mb-2 label-mono text-muted">
              {job.status === "approved"
                ? "Approved output, changes from the draft marked"
                : job.status === "awaiting_payment"
                  ? "Draft"
                  : job.status === "awaiting_approval"
                    ? "Paused"
                    : "Rejected draft"}
            </h2>
            {job.status === "approved" ? (
              <WordDiff draft={job.draft} reference={job.finalOutput ?? ""} />
            ) : job.status === "awaiting_payment" ? (
              <p className="text-sm text-muted">
                Drafting starts once the renter&apos;s payment is confirmed.
              </p>
            ) : job.status === "awaiting_approval" ? (
              <p className="text-sm text-muted">
                Paused: waiting for {job.origin === "renter" ? "the renter" : "you"} to approve a
                write in {job.origin === "renter" ? "their" : "your"} apps.
              </p>
            ) : (
              <Prose>{job.draft}</Prose>
            )}
          </Card>
        )}
      </div>

      {edited && (
        <Card className="p-5">
          <h2 className="font-display text-lg font-medium tracking-[-0.02em]">
            Teach the skill from your edit
          </h2>
          <p className="mt-1 text-sm text-muted">
            Your changes become proposed rule changes for you to accept or reject. Only the rule
            changes and your reason are kept, never this client&apos;s text.
          </p>
          <ActionForm
            action={teachFromJobAction}
            label="Propose rule changes"
            pendingLabel="Turning your edit into rules…"
            className="mt-4 space-y-3"
          >
            <input type="hidden" name="jobId" value={job.id} />
            <Field label="Why did you change it?" hint="optional">
              <input
                name="reason"
                maxLength={500}
                className={inputClass}
                placeholder="e.g. Decisions always go in bold"
              />
            </Field>
          </ActionForm>
        </Card>
      )}
    </div>
  );
}
