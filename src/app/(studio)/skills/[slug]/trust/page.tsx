import type { Metadata } from "next";
import { setTrustLevelAction } from "@/app/actions/jobs";
import { ActionForm } from "@/components/action-form";
import { Badge, Card, PageHeader, SkillTabs } from "@/components/ui";
import { autoApprovedCount, trustStatus } from "@/lib/jobs/service";
import { TRUST_LABEL, type TrustLevel } from "@/lib/jobs/trust";
import { orNotFound } from "@/lib/load";
import { getSkillBySlug } from "@/lib/skill/service";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ slug: string }> };

export async function generateMetadata({ params }: Params): Promise<Metadata> {
  const skill = await orNotFound(async () => getSkillBySlug((await params).slug));
  return { title: `Trust · ${skill.name}` };
}

export default async function TrustPage({ params }: Params) {
  const skill = await orNotFound(async () => getSkillBySlug((await params).slug));
  const [{ record, levels }, autoCount] = await Promise.all([
    trustStatus(skill.id),
    autoApprovedCount(skill.id),
  ]);

  return (
    <div className="space-y-8">
      <PageHeader
        eyebrow="Skill"
        title={skill.name}
        description="How much this skill may do without you. It starts at review-everything and earns autonomy from its record on the published version."
      />
      <SkillTabs slug={skill.slug} active="Trust" />

      <div className="grid gap-4 sm:grid-cols-3">
        <Stat label="Current level" value={`Level ${skill.trustLevel}`} />
        <Stat label="Reviewed jobs, this version" value={`${record.reviewed}`} />
        <Stat label="Auto-approved, last 7 days" value={`${autoCount}`} />
      </div>

      <ol className="space-y-3">
        {levels.map((l) => {
          const current = l.level === skill.trustLevel;
          return (
            <li key={l.level}>
              <Card className={`p-5 ${current ? "border-accent" : ""}`}>
                <div className="flex flex-wrap items-start justify-between gap-4">
                  <div className="max-w-2xl">
                    <h2 className="flex items-center gap-2 font-semibold">
                      Level {l.level}: {TRUST_LABEL[l.level as TrustLevel]}
                      {current && <Badge tone="accent">current</Badge>}
                    </h2>
                    <p className="mt-1 text-sm text-muted">{l.reason}</p>
                  </div>
                  {!current && (l.eligible || l.level < skill.trustLevel) && (
                    <ActionForm
                      action={setTrustLevelAction}
                      pendingLabel="Saving…"
                      buttons={[
                        {
                          label:
                            l.level < skill.trustLevel
                              ? `Step down to ${l.level}`
                              : `Move to level ${l.level}`,
                          intent: String(l.level),
                          variant: l.level < skill.trustLevel ? "secondary" : "primary",
                        },
                      ]}
                    >
                      <input type="hidden" name="slug" value={skill.slug} />
                    </ActionForm>
                  )}
                  {!current && !l.eligible && l.level > skill.trustLevel && (
                    <Badge>not earned yet</Badge>
                  )}
                </div>
              </Card>
            </li>
          );
        })}
      </ol>

      <Card className="p-5 text-sm text-muted">
        <p className="font-medium text-foreground">Rules that always apply</p>
        <ul className="mt-2 list-disc space-y-1 pl-5">
          <li>Jobs the self-check flags always come to you, at any level.</li>
          <li>Renters who pay for guaranteed review always get your review.</li>
          <li>Publishing a new version resets the skill to level 0.</li>
          <li>A renter complaint drops the skill back to level 0.</li>
        </ul>
      </Card>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <Card className="p-4">
      <p className="label-mono text-muted">{label}</p>
      <p className="mt-2 font-display text-2xl font-medium tabular-nums tracking-[-0.02em]">
        {value}
      </p>
    </Card>
  );
}
