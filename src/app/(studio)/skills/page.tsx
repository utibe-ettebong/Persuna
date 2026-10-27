import Link from "next/link";
import { trySampleSkillAction } from "@/app/actions/skills";
import { ActionForm } from "@/components/action-form";
import { SectionLabel } from "@/components/brand";
import { Badge, buttonClass, Card, PageHeader } from "@/components/ui";
import { requireUser } from "@/lib/auth/session";
import { listSkills } from "@/lib/skill/service";

export const dynamic = "force-dynamic";

export default async function SkillsPage() {
  const user = await requireUser();
  const skills = await listSkills(user.isAdmin ? null : user.id);

  return (
    <div className="space-y-10">
      <PageHeader
        eyebrow="Studio · Skills"
        title="Your skills"
        description="Each skill is one task, done your way: trained on your examples, approved by you."
      >
        <Link href="/skills/new" className={buttonClass("primary")}>
          New skill
        </Link>
      </PageHeader>

      {skills.length === 0 ? (
        <Card className="hatch p-10 text-center">
          <div className="mx-auto max-w-md rounded-md border border-line bg-card p-6">
            <SectionLabel index="01">Start here</SectionLabel>
            <p className="mt-3 font-display text-xl font-medium tracking-[-0.02em]">
              Try it on a sample first
            </p>
            <p className="mt-2 text-sm text-muted">
              Get your own copy of a meeting-minutes skill with six invented before-and-after
              examples. Extract its rules, test it, correct a draft and watch the score move.
            </p>
            <div className="mt-5 flex flex-wrap justify-center gap-2">
              <ActionForm
                action={trySampleSkillAction}
                label="Try the sample skill"
                pendingLabel="Setting it up…"
              />
              <Link href="/skills/new" className={buttonClass("secondary")}>
                Create your own
              </Link>
            </div>
          </div>
        </Card>
      ) : (
        <ul className="grid gap-px overflow-hidden rounded-md border border-line bg-line sm:grid-cols-2">
          {skills.map((skill, i) => (
            <li key={skill.id} className="bg-card">
              <Link
                href={`/skills/${skill.slug}`}
                className="group flex h-full flex-col gap-3 p-6 transition-colors hover:bg-accent-soft/40"
              >
                <div className="flex items-center justify-between gap-3">
                  <span className="label-mono text-faint">[{String(i + 1).padStart(2, "0")}]</span>
                  {skill.publishedVersionId ? (
                    <Badge tone="good">Published · level {skill.trustLevel}</Badge>
                  ) : (
                    <Badge>In training</Badge>
                  )}
                </div>
                <p className="font-display text-xl font-medium tracking-[-0.02em] group-hover:text-accent">
                  {skill.name}
                </p>
                <p className="text-sm leading-relaxed text-muted">{skill.taskDescription}</p>
                <p className="label-mono mt-auto text-muted">
                  {skill.inputType} → {skill.outputType}
                </p>
              </Link>
            </li>
          ))}
          {skills.length % 2 === 1 && (
            <li aria-hidden className="hatch hidden bg-background sm:block" />
          )}
        </ul>
      )}
    </div>
  );
}
