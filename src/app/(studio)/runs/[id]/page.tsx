import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { proposeFromTestAction } from "@/app/actions/skills";
import { ActionForm } from "@/components/action-form";
import { ScoreBadge } from "@/components/score-trend";
import { WordDiff } from "@/components/word-diff";
import { plural } from "@/lib/plural";
import { getRun, NotFoundError } from "@/lib/skill/service";
import { CRITERIA } from "@/lib/skill/types";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ id: string }> };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

async function load(id: string) {
  if (!UUID.test(id)) notFound();
  try {
    return await getRun(id);
  } catch (error) {
    if (error instanceof NotFoundError) notFound();
    throw error;
  }
}

export async function generateMetadata({ params }: Params): Promise<Metadata> {
  const { version } = await load((await params).id);
  return { title: `Test run v${version.version}` };
}

export default async function RunPage({ params }: Params) {
  const { run, version, skill, results } = await load((await params).id);

  return (
    <div className="space-y-8">
      <header>
        <Link href={`/skills/${skill.slug}`} className="text-sm text-muted hover:underline">
          ← {skill.name}
        </Link>
        <h1 className="mt-2 text-2xl font-semibold">
          v{version.version} replication score: <ScoreBadge score={run.meanScore} />
        </h1>
        <p className="mt-1 text-sm text-muted">
          {plural(results.length, "held-back example")} · {run.status}
          {run.error && <span className="text-danger"> · {run.error}</span>}
        </p>
      </header>

      {results.map(({ result, example }) => (
        <article key={result.id} className="rounded-md border border-line bg-card">
          <header className="flex flex-wrap items-center justify-between gap-3 border-b border-line p-4">
            <h2 className="font-mono text-sm">{example.slug}</h2>
            <div className="flex flex-wrap items-center gap-4 text-xs text-muted">
              {CRITERIA.map((c) => (
                <span key={c}>
                  {c}{" "}
                  <span className="tabular-nums text-foreground">
                    {result.breakdown.criteria[c]}
                  </span>
                </span>
              ))}
              <span className="text-base">
                <ScoreBadge score={result.score} />
              </span>
            </div>
          </header>

          <div className="space-y-3 p-4 text-sm">
            <p className="leading-relaxed">{result.breakdown.rationale}</p>
            {result.breakdown.missing.length > 0 && (
              <p className="text-muted">
                <span className="font-medium text-foreground">Missing:</span>{" "}
                {result.breakdown.missing.join("; ")}
              </p>
            )}
            {result.breakdown.extra.length > 0 && (
              <p className="text-muted">
                <span className="font-medium text-foreground">Extra:</span>{" "}
                {result.breakdown.extra.join("; ")}
              </p>
            )}
          </div>

          <div className="grid gap-px border-t border-line bg-line lg:grid-cols-2">
            <div className="bg-card p-4">
              <h3 className="mb-2 label-mono text-muted">Agent draft</h3>
              <pre className="whitespace-pre-wrap break-words font-sans text-sm leading-relaxed">
                {result.draft}
              </pre>
            </div>
            <div className="bg-card p-4">
              <h3 className="mb-2 label-mono text-muted">Your version, with differences marked</h3>
              <WordDiff draft={result.draft} reference={example.output} />
            </div>
          </div>

          <details className="border-t border-line p-4">
            <summary className="cursor-pointer text-sm font-medium">Correct this draft</summary>
            <ActionForm
              action={proposeFromTestAction}
              label="Propose rule changes"
              pendingLabel="Turning your edit into rules…"
              className="mt-3 space-y-3"
            >
              <input type="hidden" name="resultId" value={result.id} />
              <label className="block text-sm">
                <span className="text-muted">Edit the draft into what you would have written</span>
                <textarea
                  name="edited"
                  defaultValue={result.draft}
                  rows={14}
                  required
                  className="mt-1 w-full rounded-md border border-line bg-background p-3 font-mono text-xs"
                />
              </label>
              <label className="block text-sm">
                <span className="text-muted">Why? (optional, helps the rule generalise)</span>
                <input
                  name="reason"
                  maxLength={500}
                  placeholder="e.g. We never abbreviate the organisation's name"
                  className="mt-1 w-full rounded-md border border-line bg-background p-2"
                />
              </label>
            </ActionForm>
          </details>
        </article>
      ))}
    </div>
  );
}
