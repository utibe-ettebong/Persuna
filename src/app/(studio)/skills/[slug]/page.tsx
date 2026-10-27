import type { Metadata } from "next";
import Link from "next/link";
import {
  extractAction,
  makeCurrentAction,
  publishAction,
  runTestsAction,
} from "@/app/actions/skills";
import { ActionForm } from "@/components/action-form";
import { ScoreBadge, ScoreTrend } from "@/components/score-trend";
import { Badge, Card, PageHeader, SkillTabs } from "@/components/ui";
import { orNotFound } from "@/lib/load";
import { plural } from "@/lib/plural";
import { getSkillOverview } from "@/lib/skill/service";
import { RULE_CATEGORIES } from "@/lib/skill/types";

export const dynamic = "force-dynamic";

type Params = {
  params: Promise<{ slug: string }>;
  searchParams: Promise<{ sample?: string }>;
};

const load = async (slug: string) => orNotFound(() => getSkillOverview(slug));

export async function generateMetadata({ params }: Params): Promise<Metadata> {
  const { skill } = await load((await params).slug);
  return { title: skill.name };
}

export default async function SkillPage({ params, searchParams }: Params) {
  const { sample } = await searchParams;
  const { skill, versions, counts, corrections } = await load((await params).slug);
  const current = versions.find((v) => v.id === skill.currentVersionId) ?? null;
  const published = versions.find((v) => v.id === skill.publishedVersionId) ?? null;
  const pending = corrections.filter((c) => c.status === "pending");
  const trend = [...versions]
    .reverse()
    .filter((v) => v.latestRun?.meanScore != null)
    .map((v) => ({ label: `v${v.version}`, score: v.latestRun!.meanScore! }));
  const canTest = counts.train > 0 && counts.test > 0;
  const publishedScore = published?.latestRun?.meanScore ?? null;

  return (
    <div className="space-y-8">
      <PageHeader
        eyebrow="Skill"
        title={skill.name}
        description={
          <>
            {skill.taskDescription}
            <br />
            {plural(counts.train, "training pair")} · {counts.test} held back for testing ·{" "}
            {published ? (
              <span className="text-good">v{published.version} published</span>
            ) : (
              "not published yet"
            )}
          </>
        }
      >
        {counts.train > 0 && (
          <ActionForm
            action={extractAction}
            label={current ? "Re-extract rules" : "Extract rules"}
            pendingLabel="Reading examples…"
            variant={current ? "secondary" : "primary"}
          >
            <input type="hidden" name="slug" value={skill.slug} />
          </ActionForm>
        )}
        {current && canTest && (
          <ActionForm
            action={runTestsAction}
            label={`Run tests on v${current.version}`}
            pendingLabel="Drafting and scoring…"
          >
            <input type="hidden" name="versionId" value={current.id} />
          </ActionForm>
        )}
      </PageHeader>

      <SkillTabs slug={skill.slug} active="Overview" />

      {sample && !current && (
        <Card className="border-accent/50 bg-accent-soft/40 p-5 text-sm">
          <p className="font-medium">Your sample skill is ready. Try the loop in four steps:</p>
          <ol className="mt-2 list-decimal space-y-1 pl-5 text-muted">
            <li>
              <strong className="text-foreground">Extract rules</strong> (top right): the AI reads
              the four training examples and writes the method down.
            </li>
            <li>
              <strong className="text-foreground">Run tests</strong>: it drafts the two held-back
              meetings and scores itself against the real minutes.
            </li>
            <li>Open the test run, edit a draft, and accept the rule change it proposes.</li>
            <li>Publish, then submit your own notes under Jobs.</li>
          </ol>
        </Card>
      )}

      {!canTest && (
        <Card className="p-5 text-sm">
          <Link href={`/skills/${skill.slug}/examples`} className="font-medium underline">
            Add before-and-after examples
          </Link>
          : about 10 for training and 5 held back for testing. You need at least one of each to run
          tests.
        </Card>
      )}

      {pending.length > 0 && (
        <section aria-labelledby="pending-heading">
          <h2
            id="pending-heading"
            className="mb-3 font-display text-lg font-medium tracking-[-0.02em]"
          >
            Proposed rule changes to review
          </h2>
          <ul className="space-y-2">
            {pending.map((c) => (
              <li key={c.id}>
                <Link
                  href={`/corrections/${c.id}`}
                  className="flex items-center justify-between gap-3 rounded-lg border border-accent/40 bg-card p-3 text-sm hover:bg-subtle"
                >
                  <span>{c.explanation}</span>
                  <Badge tone="accent">{plural(c.ruleOps.length, "change")} · review</Badge>
                </Link>
              </li>
            ))}
          </ul>
        </section>
      )}

      <section className="grid gap-8 lg:grid-cols-[1fr_22rem]">
        <Card className="p-5">
          <h2 className="font-display text-lg font-medium tracking-[-0.02em]">
            Skill sheet {current && <span className="text-muted">v{current.version}</span>}
          </h2>
          {current ? (
            <div className="mt-4 space-y-5 text-sm">
              <p className="leading-relaxed">{current.sheet.summary}</p>
              {RULE_CATEGORIES.map((category) => {
                const rules = current.sheet.rules.filter((r) => r.category === category);
                if (rules.length === 0) return null;
                return (
                  <div key={category}>
                    <h3 className="label-mono text-muted">{category}</h3>
                    <ul className="mt-2 space-y-1.5">
                      {rules.map((r) => (
                        <li key={r.id} className="flex gap-3">
                          <span className="w-8 shrink-0 font-mono text-xs text-muted">{r.id}</span>
                          <span>{r.text}</span>
                        </li>
                      ))}
                    </ul>
                  </div>
                );
              })}
              <details>
                <summary className="cursor-pointer label-mono text-muted">Output template</summary>
                <pre className="mt-2 overflow-x-auto rounded bg-subtle p-3 font-mono text-xs">
                  {current.sheet.template}
                </pre>
              </details>
            </div>
          ) : (
            <p className="mt-3 text-sm text-muted">
              No rules yet. Extract them from the {plural(counts.train, "training pair")} to create
              v1.
            </p>
          )}
        </Card>

        <aside className="space-y-8">
          <div>
            <h2 className="mb-3 font-display text-lg font-medium tracking-[-0.02em]">
              Replication score
            </h2>
            <ScoreTrend points={trend} />
          </div>
          <div>
            <h2 className="mb-3 font-display text-lg font-medium tracking-[-0.02em]">Versions</h2>
            <Card>
              <ul className="divide-y divide-line text-sm">
                {versions.map((v) => {
                  const isCurrent = v.id === skill.currentVersionId;
                  const isPublished = v.id === skill.publishedVersionId;
                  const score = v.latestRun?.status === "complete" ? v.latestRun.meanScore : null;
                  const lower = score !== null && publishedScore !== null && score < publishedScore;
                  return (
                    <li key={v.id} className="space-y-2 p-3">
                      <div className="flex items-center justify-between gap-2">
                        <div className="flex flex-wrap items-center gap-1.5">
                          <span className="font-medium">v{v.version}</span>
                          <span className="text-muted">{v.source}</span>
                          {isPublished && <Badge tone="good">published</Badge>}
                          {isCurrent && <Badge>working</Badge>}
                        </div>
                        {v.latestRun ? (
                          <Link href={`/runs/${v.latestRun.id}`} className="hover:underline">
                            <ScoreBadge score={v.latestRun.meanScore} />
                          </Link>
                        ) : (
                          <span className="text-xs text-muted">untested</span>
                        )}
                      </div>
                      {(!isCurrent || (!isPublished && score !== null)) && (
                        <div className="flex flex-wrap gap-2">
                          {!isCurrent && (
                            <ActionForm
                              action={makeCurrentAction}
                              label="Work on this"
                              pendingLabel="…"
                              variant="secondary"
                            >
                              <input type="hidden" name="slug" value={skill.slug} />
                              <input type="hidden" name="versionId" value={v.id} />
                            </ActionForm>
                          )}
                          {!isPublished && score !== null && (
                            <ActionForm
                              action={publishAction}
                              label="Publish"
                              pendingLabel="Publishing…"
                              variant="secondary"
                            >
                              <input type="hidden" name="slug" value={skill.slug} />
                              <input type="hidden" name="versionId" value={v.id} />
                              {lower && (
                                <label className="mb-2 flex items-start gap-2 text-xs text-warn">
                                  <input type="checkbox" name="confirmLower" className="mt-0.5" />
                                  Scores lower than published v{published?.version}. I&apos;ve
                                  reviewed its test run.
                                </label>
                              )}
                            </ActionForm>
                          )}
                        </div>
                      )}
                    </li>
                  );
                })}
                {versions.length === 0 && <li className="p-3 text-muted">None yet</li>}
              </ul>
            </Card>
            <p className="mt-2 text-xs text-muted">
              The working version is what tests, rule edits and corrections build on. Jobs and
              renters always use the published version.
            </p>
          </div>
        </aside>
      </section>

      {corrections.some((c) => c.status !== "pending") && (
        <section>
          <h2 className="mb-3 font-display text-lg font-medium tracking-[-0.02em]">
            Correction log
          </h2>
          <ul className="space-y-3 text-sm">
            {corrections
              .filter((c) => c.status !== "pending")
              .map((c) => {
                const to = versions.find((v) => v.id === c.toVersionId);
                return (
                  <li key={c.id}>
                    <Card className="p-4">
                      <p className="flex flex-wrap items-center gap-2">
                        {c.status === "accepted" ? (
                          <Badge tone="good">accepted → v{to?.version}</Badge>
                        ) : (
                          <Badge tone="danger">rejected</Badge>
                        )}
                        <span>{c.reason}</span>
                        {c.jobId && <Badge>from a job</Badge>}
                      </p>
                      <ul className="mt-2 space-y-1 font-mono text-xs text-muted">
                        {c.ruleOps.map((op, i) => (
                          <li key={i}>
                            {op.op} {"id" in op ? op.id : ""} {"text" in op ? `“${op.text}”` : ""}
                          </li>
                        ))}
                      </ul>
                    </Card>
                  </li>
                );
              })}
          </ul>
        </section>
      )}
    </div>
  );
}
