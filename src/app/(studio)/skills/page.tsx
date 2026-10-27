import Link from "next/link";
import { SectionLabel } from "@/components/brand";
import { Badge, buttonClass, Card, PageHeader } from "@/components/ui";
import { listSkills } from "@/lib/skill/service";

export const dynamic = "force-dynamic";

export default async function SkillsPage() {
  const skills = await listSkills();

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
              Name one task you do often
            </p>
            <p className="mt-2 text-sm text-muted">
              Then add 10–15 before-and-after examples and let the agent learn your method.
            </p>
            <Link href="/skills/new" className={`${buttonClass("primary")} mt-5`}>
              Create a skill
            </Link>
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
