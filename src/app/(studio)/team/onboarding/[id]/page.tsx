import type { Metadata } from "next";
import Link from "next/link";
import {
  cancelOnboardingAction,
  checkAction,
  completeModuleAction,
  practiceAction,
  starterSkillsAction,
} from "@/app/actions/teams";
import { ActionForm } from "@/components/action-form";
import { Progress } from "@/components/team";
import { AskBox } from "@/components/team-forms";
import { Badge, Card, Field, inputClass, PageHeader, PanelTitle, Prose } from "@/components/ui";
import type { Tone } from "@/components/ui";
import { requireUser } from "@/lib/auth/session";
import { orNotFound } from "@/lib/load";
import {
  PASS_SCORE,
  canCompleteModule,
  moduleState,
  type ModuleState,
} from "@/lib/teams/onboarding";
import { onboardingView } from "@/lib/teams/service";
import type { Grade } from "@/lib/teams/types";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Onboarding" };

type Props = {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ module?: string }>;
};

const STATE: Record<ModuleState, { label: string; tone: Tone }> = {
  not_started: { label: "To do", tone: "neutral" },
  in_progress: { label: "In progress", tone: "warn" },
  ready: { label: "Ready to finish", tone: "accent" },
  done: { label: "Done", tone: "good" },
};

const VERDICT: Record<string, { label: string; tone: Tone }> = {
  met: { label: "Met", tone: "good" },
  partly: { label: "Partly", tone: "warn" },
  not_met: { label: "Not yet", tone: "danger" },
};

function GradeView({ grade }: { grade: Grade }) {
  return (
    <div
      className={`mt-3 rounded-md border p-3 text-sm ${grade.passed ? "border-good/40 bg-good/8" : "border-warn/40 bg-warn/8"}`}
    >
      <p className="font-medium">
        {grade.score}/100 · {grade.passed ? "Passed" : `Needs ${PASS_SCORE} to pass`}
      </p>
      <p className="mt-1 text-muted">{grade.summary}</p>
      <ul className="mt-2 space-y-2">
        {grade.results.map((r, i) => (
          <li key={i}>
            <Badge tone={VERDICT[r.verdict].tone}>{VERDICT[r.verdict].label}</Badge>{" "}
            <span className="text-muted">{r.item}</span>
            <p className="mt-0.5">{r.feedback}</p>
          </li>
        ))}
      </ul>
    </div>
  );
}

export default async function OnboardingPage({ params, searchParams }: Props) {
  const user = await requireUser();
  const { id } = await params;
  const { module: wanted } = await searchParams;
  const view = await orNotFound(() => onboardingView(user, id), id);
  const { onboarding, org, role, recruit, canWork, isRecruit, admin, progress } = view;
  const { plan } = onboarding;
  const selected =
    plan.modules.find((m) => m.id === wanted) ?? progress.next ?? plan.modules[0] ?? null;
  const mine = selected ? onboarding.progress[selected.id] : undefined;
  const index = selected ? plan.modules.indexOf(selected) : -1;

  return (
    <div className="space-y-6">
      <PageHeader
        back={{ href: `/team?org=${org.slug}`, label: org.name }}
        eyebrow="Onboarding"
        title={isRecruit ? `Welcome to ${org.name}` : `${recruit}'s onboarding`}
        description={`${role.title} at ${org.name}. ${
          onboarding.status === "completed"
            ? "Finished."
            : onboarding.status === "cancelled"
              ? "Cancelled."
              : progress.next
                ? `Next: module ${progress.nextNumber}, ${progress.next.title}.`
                : ""
        }`}
      />
      <Progress done={progress.done} total={progress.total} />
      {isRecruit && plan.welcome && index <= 0 && progress.done === 0 && (
        <p className="max-w-2xl text-sm leading-relaxed">{plan.welcome}</p>
      )}

      {onboarding.status === "completed" && isRecruit && (
        <Card className="p-5">
          <PanelTitle>You&apos;re onboarded</PanelTitle>
          {onboarding.starterSkillsAt ? (
            <p className="text-sm">
              Your starter skills are in{" "}
              <Link href="/skills" className="underline">
                Skills
              </Link>
              . Add a few examples of your own work to each and test them.
            </p>
          ) : (
            <>
              <p className="mb-3 text-sm text-muted">
                Persuna can start you with one skill per workflow in the {role.title} playbook, so
                your own Persuna already works the {org.name} way. They hold the method only, stay
                confidential to {org.name}, and learn from your own examples from here.
              </p>
              <ActionForm
                action={starterSkillsAction}
                label="Create my starter skills"
                pendingLabel="Creating…"
              >
                <input type="hidden" name="onboardingId" value={onboarding.id} />
              </ActionForm>
            </>
          )}
        </Card>
      )}

      <div className="grid gap-6 lg:grid-cols-[16rem_1fr]">
        <nav aria-label="Modules">
          <ol className="space-y-1">
            {plan.modules.map((m, i) => {
              const state = moduleState(onboarding.progress[m.id]);
              const current = m.id === selected?.id;
              return (
                <li key={m.id}>
                  <Link
                    href={`/team/onboarding/${onboarding.id}?module=${m.id}`}
                    aria-current={current ? "page" : undefined}
                    className={`block rounded-md border px-3 py-2 text-sm ${current ? "border-accent bg-card" : "border-line hover:bg-card"}`}
                  >
                    <span className="font-mono text-xs text-faint">{i + 1}.</span> {m.title}
                    <span className="mt-1 block">
                      <Badge tone={STATE[state].tone}>{STATE[state].label}</Badge>
                      {admin && onboarding.progress[m.id]?.check && (
                        <span className="ml-2 font-mono text-xs text-muted">
                          check {onboarding.progress[m.id]!.check!.grade.score}
                        </span>
                      )}
                    </span>
                  </Link>
                </li>
              );
            })}
          </ol>
        </nav>

        {selected && (
          <div className="min-w-0 space-y-6">
            <Card className="p-5">
              <div className="label-mono text-faint">
                Module {index + 1} · {selected.kind === "company" ? "The company" : "Workflow"}
              </div>
              <h2 className="mt-1 font-display text-2xl font-medium">{selected.title}</h2>
              <div className="mt-4 space-y-5">
                {selected.lessons.map((l) => (
                  <section key={l.title}>
                    <h3 className="font-medium">{l.title}</h3>
                    <div className="mt-1">
                      <Prose>{l.body}</Prose>
                    </div>
                  </section>
                ))}
              </div>
            </Card>

            <Card className="p-5">
              <PanelTitle>Practice</PanelTitle>
              <Prose>{selected.practice.task}</Prose>
              {canWork && !mine?.doneAt ? (
                <ActionForm
                  action={practiceAction}
                  label={mine?.practice ? "Hand in again" : "Hand in"}
                  pendingLabel="Persuna is reading it…"
                  className="mt-3 space-y-3"
                >
                  <input type="hidden" name="onboardingId" value={onboarding.id} />
                  <input type="hidden" name="moduleId" value={selected.id} />
                  <textarea
                    name="answer"
                    rows={8}
                    required
                    maxLength={8000}
                    defaultValue={mine?.practice?.answer}
                    aria-label="Your answer"
                    className={inputClass}
                  />
                </ActionForm>
              ) : (
                mine?.practice && (
                  <div className="mt-3 rounded-md bg-card text-sm">
                    <Prose>{mine.practice.answer}</Prose>
                  </div>
                )
              )}
              {mine?.practice && <GradeView grade={mine.practice.grade} />}
            </Card>

            <Card className="p-5">
              <PanelTitle>Check</PanelTitle>
              {canWork && !mine?.doneAt ? (
                <ActionForm
                  action={checkAction}
                  label={mine?.check ? "Check again" : "Check my answers"}
                  pendingLabel="Persuna is marking…"
                  className="space-y-3"
                >
                  <input type="hidden" name="onboardingId" value={onboarding.id} />
                  <input type="hidden" name="moduleId" value={selected.id} />
                  {selected.check.map((q, i) => (
                    <Field key={i} label={`${i + 1}. ${q.question}`}>
                      <textarea
                        name={`a${i}`}
                        rows={3}
                        maxLength={4000}
                        defaultValue={mine?.check?.answers[i]}
                        className={inputClass}
                      />
                    </Field>
                  ))}
                </ActionForm>
              ) : (
                <ol className="list-decimal space-y-1 pl-5 text-sm">
                  {selected.check.map((q, i) => (
                    <li key={i}>{q.question}</li>
                  ))}
                </ol>
              )}
              {mine?.check && <GradeView grade={mine.check.grade} />}
            </Card>

            {canWork && !mine?.doneAt && (
              <Card className="p-5">
                {canCompleteModule(mine).ok ? (
                  <ActionForm
                    action={completeModuleAction}
                    label="Mark this module done"
                    pendingLabel="Saving…"
                  >
                    <input type="hidden" name="onboardingId" value={onboarding.id} />
                    <input type="hidden" name="moduleId" value={selected.id} />
                  </ActionForm>
                ) : (
                  <p className="text-sm text-muted">
                    Hand in the practice task and pass the check ({PASS_SCORE}% or more) to finish
                    this module.
                  </p>
                )}
              </Card>
            )}
          </div>
        )}
      </div>

      {onboarding.status === "active" && (
        <Card className="p-5">
          <PanelTitle>Questions about the job</PanelTitle>
          <AskBox onboardingId={onboarding.id} />
          <p className="mt-2 text-xs text-muted">
            Persuna answers only from the {role.title} playbook and the {org.name} handbook, and
            says when it doesn&apos;t know. Questions aren&apos;t saved.
          </p>
        </Card>
      )}

      {admin && onboarding.status === "active" && (
        <ActionForm
          action={cancelOnboardingAction}
          label="Cancel this onboarding"
          pendingLabel="Cancelling…"
          variant="danger"
        >
          <input type="hidden" name="onboardingId" value={onboarding.id} />
          <input type="hidden" name="back" value={`/team?org=${org.slug}`} />
        </ActionForm>
      )}
    </div>
  );
}
