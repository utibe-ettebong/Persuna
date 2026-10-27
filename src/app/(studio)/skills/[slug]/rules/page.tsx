import type { Metadata } from "next";
import { RuleEditor } from "@/components/rule-editor";
import { Card, PageHeader, SkillTabs } from "@/components/ui";
import { orNotFound } from "@/lib/load";
import { getSkillOverview } from "@/lib/skill/service";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ slug: string }> };

export async function generateMetadata({ params }: Params): Promise<Metadata> {
  const { skill } = await orNotFound(async () => getSkillOverview((await params).slug));
  return { title: `Edit rules · ${skill.name}` };
}

export default async function RulesPage({ params }: Params) {
  const { skill, versions } = await orNotFound(async () => getSkillOverview((await params).slug));
  const current = versions.find((v) => v.id === skill.currentVersionId);

  return (
    <div className="space-y-8">
      <PageHeader
        eyebrow="Skill"
        title={skill.name}
        description={
          current
            ? `Editing v${current.version}. Saving creates a new version for you to test; nothing already published changes.`
            : undefined
        }
      />
      <SkillTabs slug={skill.slug} active="Edit rules" />
      <Card className="p-5">
        {current ? (
          <RuleEditor key={current.id} slug={skill.slug} sheet={current.sheet} />
        ) : (
          <p className="text-sm text-muted">Extract rules from your examples first.</p>
        )}
      </Card>
    </div>
  );
}
