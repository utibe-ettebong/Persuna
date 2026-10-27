import type { Metadata } from "next";
import { updatePairAction } from "@/app/actions/skills";
import { ActionForm } from "@/components/action-form";
import { AddPairForm } from "@/components/add-pair-form";
import { Badge, Card, PageHeader, Prose, SkillTabs } from "@/components/ui";
import { orNotFound } from "@/lib/load";
import { plural } from "@/lib/plural";
import { getSkillBySlug, listPairs } from "@/lib/skill/service";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ slug: string }> };

export async function generateMetadata({ params }: Params): Promise<Metadata> {
  const skill = await orNotFound(async () => getSkillBySlug((await params).slug));
  return { title: `Examples · ${skill.name}` };
}

export default async function ExamplesPage({ params }: Params) {
  const skill = await orNotFound(async () => getSkillBySlug((await params).slug));
  const pairs = await listPairs(skill.id);
  const train = pairs.filter((p) => p.split === "train").length;
  const test = pairs.length - train;

  return (
    <div className="space-y-8">
      <PageHeader
        eyebrow="Skill"
        title={skill.name}
        description={`${plural(train, "training pair")} · ${test} held back for testing. Aim for about 10 and 5.`}
      />
      <SkillTabs slug={skill.slug} active="Examples" />

      <section aria-labelledby="add-heading">
        <h2 id="add-heading" className="mb-1 font-display text-lg font-medium tracking-[-0.02em]">
          Add a before-and-after pair
        </h2>
        <p className="mb-4 text-sm text-muted">
          A raw input and the finished output you produced from it. Use invented or anonymised
          material only.
        </p>
        <Card className="p-5">
          <AddPairForm
            skillSlug={skill.slug}
            inputType={skill.inputType}
            outputType={skill.outputType}
          />
        </Card>
      </section>

      <section aria-labelledby="pairs-heading">
        <h2 id="pairs-heading" className="mb-3 font-display text-lg font-medium tracking-[-0.02em]">
          Pairs
        </h2>
        {pairs.length === 0 ? (
          <p className="text-sm text-muted">No pairs yet.</p>
        ) : (
          <ul className="space-y-3">
            {pairs.map((pair) => (
              <li key={pair.id}>
                <Card>
                  <details>
                    <summary className="flex cursor-pointer flex-wrap items-center justify-between gap-2 p-4">
                      <span className="flex items-center gap-2 font-mono text-sm">
                        {pair.slug}
                        <Badge tone={pair.split === "train" ? "accent" : "warn"}>
                          {pair.split === "train" ? "training" : "test"}
                        </Badge>
                      </span>
                      <span className="text-xs text-muted">show</span>
                    </summary>
                    <div className="grid gap-px border-t border-line bg-line lg:grid-cols-2">
                      <div className="bg-card p-4">
                        <h3 className="mb-2 label-mono text-muted">Input</h3>
                        <Prose>{pair.input}</Prose>
                      </div>
                      <div className="bg-card p-4">
                        <h3 className="mb-2 label-mono text-muted">Your output</h3>
                        <Prose>{pair.output}</Prose>
                      </div>
                    </div>
                    <div className="border-t border-line p-4">
                      <ActionForm
                        action={updatePairAction}
                        pendingLabel="Saving…"
                        buttons={[
                          pair.split === "train"
                            ? { label: "Move to testing", intent: "test", variant: "secondary" }
                            : { label: "Move to training", intent: "train", variant: "secondary" },
                          { label: "Delete pair", intent: "delete", variant: "danger" },
                        ]}
                      >
                        <input type="hidden" name="skillSlug" value={skill.slug} />
                        <input type="hidden" name="exampleId" value={pair.id} />
                      </ActionForm>
                    </div>
                  </details>
                </Card>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
