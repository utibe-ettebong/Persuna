import type { Metadata } from "next";
import { decideCorrectionAction } from "@/app/actions/skills";
import { ActionForm } from "@/components/action-form";
import { Badge, Card, PageHeader } from "@/components/ui";
import { assertCorrectionOwner } from "@/lib/auth/access";
import { requireUser } from "@/lib/auth/session";
import { orNotFound } from "@/lib/load";
import { getCorrection } from "@/lib/skill/service";
import type { Rule } from "@/lib/skill/types";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Review rule changes" };

type Params = { params: Promise<{ id: string }> };

const SOURCE_LABEL = {
  test: "your edit of a test draft",
  job: "your edit of a real job",
  interview: "your interview answers",
  walkthrough: "your voice walkthrough",
  screen: "your screen walkthrough",
  companion: "what you taught your Persuna",
  episode: "what Persuna watched you do",
} as const;

export default async function CorrectionPage({ params }: Params) {
  const { id } = await params;
  const user = await requireUser();
  const { correction, skill, from } = await orNotFound(async () => {
    await assertCorrectionOwner(user, id);
    return getCorrection(id);
  }, id);
  const before = new Map(from.sheet.rules.map((r) => [r.id, r]));
  const after = new Map(correction.proposedSheet.rules.map((r) => [r.id, r]));
  const changed = correction.proposedSheet.rules.filter(
    (r) =>
      !before.has(r.id) ||
      before.get(r.id)!.text !== r.text ||
      before.get(r.id)!.category !== r.category,
  );
  const removed = from.sheet.rules.filter((r) => !after.has(r.id));
  const templateChanged = from.sheet.template !== correction.proposedSheet.template;

  return (
    <div className="max-w-3xl space-y-6">
      <PageHeader
        back={{ href: `/skills/${skill.slug}`, label: skill.name }}
        title="Review proposed rule changes"
        description={`From ${SOURCE_LABEL[correction.source]}, based on v${from.version}. ${
          correction.source === "test" || correction.source === "job"
            ? `Your reason: “${correction.reason}”`
            : ""
        }`}
      />

      <Card className="space-y-4 p-5 text-sm">
        <p className="leading-relaxed">{correction.explanation}</p>
        {changed.map((r) => (
          <RuleChange key={r.id} rule={r} previous={before.get(r.id)} />
        ))}
        {removed.map((r) => (
          <div key={r.id} className="rounded-md border border-danger/30 p-3">
            <Badge tone="danger">remove {r.id}</Badge>
            <p className="mt-2 text-muted line-through">{r.text}</p>
          </div>
        ))}
        {templateChanged && (
          <div className="rounded-md border border-accent/30 p-3">
            <Badge tone="accent">new output template</Badge>
            <pre className="mt-2 overflow-x-auto font-mono text-xs">
              {correction.proposedSheet.template}
            </pre>
          </div>
        )}
      </Card>

      {correction.status === "pending" ? (
        <ActionForm
          action={decideCorrectionAction}
          pendingLabel="Saving the new version and re-running tests…"
          buttons={[
            { label: "Accept and re-test", intent: "accept" },
            { label: "Reject", intent: "reject", variant: "danger" },
          ]}
        >
          <input type="hidden" name="correctionId" value={correction.id} />
        </ActionForm>
      ) : (
        <p className="text-sm text-muted">This proposal was {correction.status}.</p>
      )}
    </div>
  );
}

function RuleChange({ rule, previous }: { rule: Rule; previous?: Rule }) {
  return (
    <div className={`rounded-md border p-3 ${previous ? "border-warn/30" : "border-good/30"}`}>
      <Badge tone={previous ? "warn" : "good"}>
        {previous ? "change" : "add"} {rule.id} · {rule.category}
      </Badge>
      {previous && <p className="mt-2 text-muted line-through">{previous.text}</p>}
      <p className="mt-2">{rule.text}</p>
    </div>
  );
}
