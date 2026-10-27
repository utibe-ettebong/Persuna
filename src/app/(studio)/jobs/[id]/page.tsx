import type { Metadata } from "next";
import { reviewJobAction, teachFromJobAction } from "@/app/actions/jobs";
import { ActionForm } from "@/components/action-form";
import { Badge, buttonClass, Card, Field, inputClass, PageHeader, Prose } from "@/components/ui";
import { WordDiff } from "@/components/word-diff";
import { getJobWithSkill } from "@/lib/jobs/service";
import { assertJobOwner } from "@/lib/auth/access";
import { requireUser } from "@/lib/auth/session";
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

  return (
    <div className="space-y-6">
      <PageHeader
        back={{ href: "/jobs", label: "Jobs" }}
        title={skill.name}
        description={
          <>
            v{version.version} ·{" "}
            {job.origin === "renter" ? `Rented by ${job.requesterName}` : "Your job"} · deleted on{" "}
            {job.expiresAt.toLocaleDateString("en-GB", { dateStyle: "medium" })}
          </>
        }
      >
        {job.status === "approved" && (
          <>
            <a href={`/jobs/${job.id}/download?format=docx`} className={buttonClass("primary")}>
              Download .docx
            </a>
            <a href={`/jobs/${job.id}/download?format=md`} className={buttonClass("secondary")}>
              Download .md
            </a>
          </>
        )}
      </PageHeader>

      <div className="flex flex-wrap gap-2">
        {job.status === "awaiting_payment" && <Badge>waiting for the renter&apos;s payment</Badge>}
        {job.status === "review" && <Badge tone="accent">needs your review</Badge>}
        {job.approvedBy === "auto" && <Badge>auto-approved at trust level {job.trustLevel}</Badge>}
        {job.ownerReviewRequired && <Badge tone="accent">renter paid for your review</Badge>}
        {job.complaint && <Badge tone="danger">renter reported a problem</Badge>}
        {job.status === "approved" && <Badge tone="good">approved</Badge>}
        {job.status === "rejected" && <Badge tone="danger">rejected</Badge>}
        {job.editSize && job.editSize !== "rejected" && <Badge>{job.editSize} edit</Badge>}
        {job.rating && <Badge tone="good">renter rated {job.rating}/5</Badge>}
      </div>

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

      <div className="grid gap-6 lg:grid-cols-2">
        <Card className="p-4">
          <h2 className="mb-2 label-mono text-muted">Input</h2>
          <Prose>{job.input}</Prose>
        </Card>

        {job.status === "review" ? (
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
                  : "Rejected draft"}
            </h2>
            {job.status === "approved" ? (
              <WordDiff draft={job.draft} reference={job.finalOutput ?? ""} />
            ) : job.status === "awaiting_payment" ? (
              <p className="text-sm text-muted">
                Drafting starts once the renter&apos;s payment is confirmed.
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
