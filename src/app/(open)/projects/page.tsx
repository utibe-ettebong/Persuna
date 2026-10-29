import type { Metadata } from "next";
import Link from "next/link";
import { PROJECT_STATUS as STATUS } from "@/components/projects";
import { Badge, buttonClass, Card, PageHeader } from "@/components/ui";
import { getUser } from "@/lib/auth/session";
import { formatUsd } from "@/lib/money";
import { plural } from "@/lib/plural";
import { daysLeft } from "@/lib/projects/rules";
import { listOpenProjects, projectsFor } from "@/lib/projects/service";

export const dynamic = "force-dynamic";
export const metadata: Metadata = {
  title: "Projects",
  description:
    "Post work and get proposals from people with Persuna-verified skills. Persuna sets clear criteria, checks every delivery, and holds payment in escrow per milestone.",
  robots: { index: true, follow: true },
};

export default async function ProjectsPage() {
  const user = await getUser();
  const [open, mine] = await Promise.all([
    listOpenProjects(),
    user ? projectsFor(user.id) : Promise.resolve(null),
  ]);
  const now = new Date();
  const postHref = user ? "/projects/new" : `/sign-in?next=${encodeURIComponent("/projects/new")}`;

  return (
    <div className="space-y-10">
      <PageHeader
        eyebrow="Projects"
        title="Post work. Persuna keeps it fair."
        description="Bigger than one task? Post a project. Persuna turns your brief into clear criteria and milestones, gives you a fit report on every proposal, checks each delivery against its criteria for both sides, and holds each milestone's payment in escrow until you approve it."
      >
        <Link href={postHref} className={buttonClass("primary")}>
          Post a project
        </Link>
      </PageHeader>

      {mine && (mine.posted.length > 0 || mine.proposed.length > 0) && (
        <section className="space-y-3">
          <h2 className="font-display text-2xl font-medium tracking-[-0.02em]">Yours</h2>
          <ul className="divide-y divide-line rounded-md border border-line bg-card">
            {mine.posted.map((p) => (
              <Row key={p.id} id={p.id} title={p.title} status={p.status} note="you posted" />
            ))}
            {mine.proposed.map(({ project, proposal }) => (
              <Row
                key={project.id}
                id={project.id}
                title={project.title}
                status={project.status}
                note={`your proposal: ${proposal.status}`}
              />
            ))}
          </ul>
        </section>
      )}

      <section className="space-y-3">
        <h2 className="font-display text-2xl font-medium tracking-[-0.02em]">Open projects</h2>
        {open.length === 0 ? (
          <Card className="hatch p-10 text-center">
            <p className="mx-auto max-w-md rounded-md border border-line bg-card p-6 text-sm text-muted">
              No open projects right now. Post one, or list a skill so people can rent it per task.
            </p>
          </Card>
        ) : (
          <ul className="grid gap-px overflow-hidden rounded-md border border-line bg-line sm:grid-cols-2">
            {open.map(({ project, proposals }) => {
              const left = daysLeft(project.deadline, now);
              return (
                <li key={project.id} className="bg-card">
                  <Link
                    href={`/projects/${project.id}`}
                    className="group flex h-full flex-col gap-3 p-6 transition-colors hover:bg-accent-soft/40"
                  >
                    <p className="font-display text-xl font-medium tracking-[-0.02em] group-hover:text-accent">
                      {project.title}
                    </p>
                    <p className="line-clamp-3 flex-1 text-sm leading-relaxed text-muted">
                      {project.plan?.scope}
                    </p>
                    <div className="flex flex-wrap gap-2">
                      <Badge>{plural(project.plan?.milestones.length ?? 0, "milestone")}</Badge>
                      <Badge>{plural(proposals, "proposal")}</Badge>
                      <Badge tone={left < 3 ? "warn" : "neutral"}>
                        {left > 0 ? `${left} day(s) left` : "due"}
                      </Badge>
                    </div>
                    <div className="flex items-end justify-between border-t border-line pt-4">
                      <span>
                        <span className="label-mono block text-faint">Budget</span>
                        <span className="font-display text-2xl font-medium tabular-nums tracking-[-0.02em]">
                          {formatUsd(project.budgetCents)}
                        </span>
                      </span>
                      <span className="label-mono text-accent">View →</span>
                    </div>
                  </Link>
                </li>
              );
            })}
          </ul>
        )}
      </section>
    </div>
  );
}

function Row({
  id,
  title,
  status,
  note,
}: {
  id: string;
  title: string;
  status: string;
  note: string;
}) {
  const s = STATUS[status];
  return (
    <li>
      <Link
        href={`/projects/${id}`}
        className="flex flex-wrap items-center justify-between gap-2 px-4 py-3 hover:bg-accent-soft/40"
      >
        <span className="font-medium">{title}</span>
        <span className="flex items-center gap-2 text-sm text-muted">
          {note}
          <Badge tone={s.tone}>{s.label}</Badge>
        </span>
      </Link>
    </li>
  );
}
