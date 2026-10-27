import type { Metadata } from "next";
import Link from "next/link";
import { createJobAction } from "@/app/actions/jobs";
import { ActionForm } from "@/components/action-form";
import { VoiceRecorder } from "@/components/voice-recorder";
import { Badge, Card, Field, inputClass, PageHeader } from "@/components/ui";
import { approvalStats, listJobs } from "@/lib/jobs/service";
import { visibleSkillIds } from "@/lib/auth/access";
import { requireUser } from "@/lib/auth/session";
import { listSkills } from "@/lib/skill/service";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Jobs" };

const STATUS_BADGE = {
  awaiting_payment: { tone: "neutral", label: "awaiting payment" },
  review: { tone: "accent", label: "needs review" },
  approved: { tone: "good", label: "approved" },
  rejected: { tone: "danger", label: "rejected" },
} as const;

export default async function JobsPage() {
  const user = await requireUser();
  const [jobs, skills] = await Promise.all([
    visibleSkillIds(user).then(listJobs),
    listSkills(user.isAdmin ? null : user.id),
  ]);
  const publishable = skills.filter((s) => s.publishedVersionId);
  const queue = jobs.filter((j) => j.job.status === "review");
  const done = jobs.filter((j) => j.job.status !== "review");
  const stats = approvalStats(jobs.map((j) => j.job));

  return (
    <div className="space-y-8">
      <PageHeader
        eyebrow="Studio · Jobs"
        title="Jobs"
        description={
          stats.rate === null
            ? "Real work through your published skills. Nothing goes out until you approve it."
            : `${stats.rate}% of ${stats.reviewed} reviewed jobs approved unchanged or with minor edits.`
        }
      />

      <section aria-labelledby="new-job">
        <h2 id="new-job" className="mb-3 font-display text-lg font-medium tracking-[-0.02em]">
          New job
        </h2>
        <Card className="p-5">
          {publishable.length === 0 ? (
            <p className="text-sm text-muted">
              Publish a skill version first; jobs always use the published version.
            </p>
          ) : (
            <ActionForm
              action={createJobAction}
              label="Draft it"
              pendingLabel="Drafting…"
              className="space-y-4"
            >
              <Field label="Skill">
                <select name="skillId" className={inputClass}>
                  {publishable.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.name}
                    </option>
                  ))}
                </select>
              </Field>
              <Field label="Input">
                <textarea
                  name="inputText"
                  rows={8}
                  className={`${inputClass} font-mono text-xs`}
                  placeholder="Paste the input here…"
                />
              </Field>
              <Field label="…or upload" hint=".md, .txt or .docx">
                <input
                  type="file"
                  name="inputFile"
                  accept=".md,.markdown,.txt,.docx"
                  className="mt-1 block w-full text-sm text-muted file:mr-3 file:rounded file:border file:border-line file:bg-subtle file:px-2 file:py-1"
                />
              </Field>
              <details className="rounded-md border border-line p-3">
                <summary className="cursor-pointer text-sm font-medium">
                  …or send a voice note
                </summary>
                <p className="mt-2 text-sm text-muted">
                  The recording is transcribed and the transcript becomes the job&apos;s input.
                </p>
                <div className="mt-3">
                  <VoiceRecorder />
                </div>
              </details>
            </ActionForm>
          )}
        </Card>
      </section>

      <JobList
        title={`Waiting for your review (${queue.length})`}
        rows={queue}
        empty="Nothing waiting."
      />
      <JobList title="Reviewed" rows={done} empty="No reviewed jobs yet." />
    </div>
  );
}

function JobList({
  title,
  rows,
  empty,
}: {
  title: string;
  rows: Awaited<ReturnType<typeof listJobs>>;
  empty: string;
}) {
  return (
    <section>
      <h2 className="mb-3 font-display text-lg font-medium tracking-[-0.02em]">{title}</h2>
      {rows.length === 0 ? (
        <p className="text-sm text-muted">{empty}</p>
      ) : (
        <Card>
          <ul className="divide-y divide-line text-sm">
            {rows.map(({ job, skill, version }) => {
              const badge = STATUS_BADGE[job.status];
              return (
                <li key={job.id}>
                  <Link
                    href={`/jobs/${job.id}`}
                    className="flex flex-wrap items-center justify-between gap-2 p-3 hover:bg-subtle"
                  >
                    <span className="min-w-0">
                      <span className="font-medium">{skill.name}</span>{" "}
                      <span className="text-muted">
                        v{version.version} ·{" "}
                        {job.origin === "renter" ? `rented by ${job.requesterName}` : "your job"} ·{" "}
                        {job.createdAt.toLocaleString("en-GB", {
                          dateStyle: "medium",
                          timeStyle: "short",
                        })}
                      </span>
                    </span>
                    <span className="flex gap-1.5">
                      {job.flags.length > 0 && job.status === "review" && (
                        <Badge tone="warn">{job.flags.length} flagged</Badge>
                      )}
                      {job.approvedBy === "auto" ? (
                        <Badge>auto-approved</Badge>
                      ) : (
                        job.editSize &&
                        job.editSize !== "rejected" && <Badge>{job.editSize} edit</Badge>
                      )}
                      <Badge tone={badge.tone}>{badge.label}</Badge>
                    </span>
                  </Link>
                </li>
              );
            })}
          </ul>
        </Card>
      )}
    </section>
  );
}
