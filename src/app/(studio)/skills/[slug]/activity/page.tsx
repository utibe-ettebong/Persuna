import type { Metadata } from "next";
import { AuditTable } from "@/components/audit-table";
import { PageHeader, SkillTabs } from "@/components/ui";
import { listAuditEvents } from "@/lib/audit";
import { orNotFound } from "@/lib/load";
import { getSkillBySlug } from "@/lib/skill/service";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ slug: string }> };

export async function generateMetadata({ params }: Params): Promise<Metadata> {
  const skill = await orNotFound(async () => getSkillBySlug((await params).slug));
  return { title: `Activity · ${skill.name}` };
}

export default async function ActivityPage({ params }: Params) {
  const skill = await orNotFound(async () => getSkillBySlug((await params).slug));
  const events = await listAuditEvents({ skillId: skill.id });
  return (
    <div className="space-y-8">
      <PageHeader
        eyebrow="Skill"
        title={skill.name}
        description="Every change to this skill, its jobs and its listing."
      />
      <SkillTabs slug={skill.slug} active="Activity" />
      <AuditTable events={events} />
    </div>
  );
}
