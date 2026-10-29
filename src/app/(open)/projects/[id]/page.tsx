import type { Metadata } from "next";
import Link from "next/link";
import { cache } from "react";
import {
  acceptProposalAction,
  approveMilestoneAction,
  cancelProjectAction,
  disputeAction,
  fundMilestoneAction,
  proposeAction,
  rateProjectAction,
  requestMilestoneChangesAction,
  resolveMilestoneAction,
  resumeProjectAction,
  savePlanAction,
  submitDeliveryAction,
} from "@/app/actions/projects";
import { ActionForm } from "@/components/action-form";
import { FairDealPanel } from "@/components/market";
import {
  CheckReport,
  FitReportView,
  MILESTONE_STATUS,
  PROJECT_STATUS,
  Timeline,
} from "@/components/projects";
import { Badge, buttonClass, Card, Field, inputClass, PageHeader, Prose } from "@/components/ui";
import { env } from "@/env";
import { getUser } from "@/lib/auth/session";
import { orNotFound } from "@/lib/load";
import { dollarsInput, formatUsd } from "@/lib/money";
import { HELD, MAX_CHANGE_ROUNDS, MAX_MILESTONES, daysLeft } from "@/lib/projects/rules";
import { getProject, listingsOf } from "@/lib/projects/service";

export const dynamic = "force-dynamic";

type Params = {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ payment?: string }>;
};

const load = cache(async (id: string) => {
  const viewer = await getUser();
  return { viewer, view: await orNotFound(() => getProject(id, viewer), id) };
});

export async function generateMetadata({ params }: Params): Promise<Metadata> {
  const { id } = await params;
  const { view } = await load(id);
  const description = `${formatUsd(view.project.budgetCents)} project. ${view.project.plan?.scope.slice(0, 200) ?? ""}`;
  return {
    title: view.project.title,
    description,
    robots:
      view.project.status === "open"
        ? { index: true, follow: true }
        : { index: false, follow: false },
    openGraph: { type: "website", siteName: "Persuna", title: view.project.title, description },
  };
}

const date = (d: Date) => d.toLocaleDateString("en-GB", { dateStyle: "medium" });

export default async function ProjectPage({ params, searchParams }: Params) {
  const { id } = await params;
  const { payment } = await searchParams;
  const { viewer, view } = await load(id);
  const { project, role, milestones, proposals, updates } = view;
  const plan = project.plan;
  const isPoster = role === "poster";
  const isSeller = role === "seller";
  const isAdmin = viewer?.isAdmin ?? false;
  const party = isPoster || isSeller || role === "admin";
  const status = PROJECT_STATUS[project.status];
  const left = daysLeft(project.deadline, new Date());
  const signIn = `/sign-in?next=${encodeURIComponent(`/projects/${project.id}`)}`;
  const canPropose =
    project.status === "open" &&
    viewer &&
    !isPoster &&
    !proposals.some((p) => p.sellerId === viewer.id);
  const myListings = canPropose && viewer ? await listingsOf(viewer.id) : [];
  const paystack = env().PAYMENTS_PROVIDER === "paystack";

  return (
    <div className="space-y-8">
      <PageHeader
        back={{ href: "/projects", label: "Projects" }}
        title={project.title}
        description={
          <span className="flex flex-wrap items-center gap-2">
            <Badge tone={status.tone}>{status.label}</Badge>
            <span>
              {formatUsd(project.budgetCents)} budget · due {date(project.deadline)}
              {project.status === "open" || project.status === "in_progress"
                ? ` (${left > 0 ? `${left} day(s) left` : "due now"})`
                : ""}{" "}
              · posted by <PersonLink person={view.poster} />
              {view.seller && (
                <>
                  {" "}
                  · seller <PersonLink person={view.seller} />
                </>
              )}
            </span>
          </span>
        }
      />

      {payment === "unconfirmed" && (
        <p role="alert" className="rounded-md bg-warn/10 p-3 text-sm text-warn">
          We couldn&apos;t confirm that payment yet. If you were charged, it&apos;s picked up
          automatically within a few minutes; refresh to check.
        </p>
      )}

      {isPoster && project.status === "draft" && plan && (
        <DraftEditor projectId={project.id} budgetCents={project.budgetCents} plan={plan} />
      )}

      <div className="grid gap-6 lg:grid-cols-[1fr_20rem]">
        <div className="space-y-6">
          {plan && (
            <Card className="space-y-3 p-5">
              <h2 className="font-display text-lg font-medium tracking-[-0.02em]">Scope</h2>
              <p className="text-sm leading-relaxed">{plan.scope}</p>
              {plan.criteria.length > 0 && (
                <>
                  <h3 className="label-mono text-muted">Acceptance criteria</h3>
                  <ul className="list-disc space-y-1 pl-5 text-sm">
                    {plan.criteria.map((c) => (
                      <li key={c}>{c}</li>
                    ))}
                  </ul>
                </>
              )}
              {project.brief ? (
                <details className="text-sm">
                  <summary className="cursor-pointer font-medium">The poster&apos;s brief</summary>
                  <div className="mt-2 rounded-md bg-subtle p-3">
                    <Prose>{project.brief}</Prose>
                  </div>
                </details>
              ) : (
                <p className="text-sm text-muted">
                  <Link href={signIn} className="text-accent hover:underline">
                    Sign in
                  </Link>{" "}
                  to read the full brief.
                </p>
              )}
            </Card>
          )}

          {milestones.length > 0 && (
            <section className="space-y-3">
              <h2 className="font-display text-2xl font-medium tracking-[-0.02em]">Milestones</h2>
              <ol className="space-y-3">
                {milestones.map((m) => {
                  const ms = MILESTONE_STATUS[m.status];
                  const awaitingPayment = m.status === "pending" && m.provider === "paystack";
                  return (
                    <li key={m.id}>
                      <Card className="space-y-3 p-5">
                        <div className="flex flex-wrap items-center justify-between gap-2">
                          <p className="font-medium">
                            {m.position}. {m.title}
                          </p>
                          <span className="flex items-center gap-2">
                            <Badge tone={ms.tone}>
                              {awaitingPayment ? "awaiting payment" : ms.label}
                            </Badge>
                            <span className="font-display text-lg tabular-nums">
                              {formatUsd(m.amountCents)}
                            </span>
                          </span>
                        </div>
                        <ul className="list-disc space-y-1 pl-5 text-sm text-muted">
                          {m.criteria.map((c) => (
                            <li key={c}>{c}</li>
                          ))}
                        </ul>
                        {m.rounds > 0 && (
                          <p className="text-xs text-muted">
                            Changes requested {m.rounds} of {MAX_CHANGE_ROUNDS} time(s).
                          </p>
                        )}
                        {m.status === "released" && m.sellerShareCents !== null && (
                          <p className="text-xs text-muted">
                            Paid {formatUsd(m.sellerShareCents)} to the seller after a{" "}
                            {formatUsd(m.platformFeeCents ?? 0)} platform fee.
                          </p>
                        )}

                        {party && m.delivery && (
                          <details className="text-sm" open={m.status === "submitted"}>
                            <summary className="cursor-pointer font-medium">
                              Latest delivery
                            </summary>
                            <div className="mt-2 rounded-md bg-subtle p-3">
                              <Prose>{m.delivery}</Prose>
                            </div>
                          </details>
                        )}
                        {party && m.check && <CheckReport check={m.check} />}

                        {isPoster && project.status === "in_progress" && m.status === "pending" && (
                          <ActionForm
                            action={fundMilestoneAction}
                            label={`Fund ${formatUsd(m.amountCents)} into escrow`}
                            pendingLabel="Starting payment…"
                            variant="accent"
                          >
                            <input type="hidden" name="projectId" value={project.id} />
                            <input type="hidden" name="milestoneId" value={m.id} />
                            <p className="mb-2 text-xs text-muted">
                              {paystack
                                ? "You pay through Paystack in US dollars. It's held until you approve the work."
                                : "Mock payments: no real money moves."}
                            </p>
                          </ActionForm>
                        )}

                        {isSeller &&
                          project.status === "in_progress" &&
                          (m.status === "funded" || m.status === "changes_requested") && (
                            <ActionForm
                              action={submitDeliveryAction}
                              label="Deliver for checking"
                              pendingLabel="Persuna is checking your delivery…"
                              className="space-y-3 border-t border-line pt-3"
                            >
                              <input type="hidden" name="projectId" value={project.id} />
                              <input type="hidden" name="milestoneId" value={m.id} />
                              <Field
                                label="Your delivery"
                                hint="paste the work, or describe it with links"
                              >
                                <textarea
                                  name="delivery"
                                  required
                                  minLength={10}
                                  maxLength={20_000}
                                  rows={8}
                                  className={inputClass}
                                />
                              </Field>
                            </ActionForm>
                          )}

                        {isPoster &&
                          project.status === "in_progress" &&
                          m.status === "submitted" && (
                            <div className="space-y-3 border-t border-line pt-3">
                              <ActionForm
                                action={approveMilestoneAction}
                                label={`Approve and release ${formatUsd(m.amountCents)}`}
                                pendingLabel="Releasing…"
                                variant="accent"
                              >
                                <input type="hidden" name="projectId" value={project.id} />
                                <input type="hidden" name="milestoneId" value={m.id} />
                              </ActionForm>
                              {m.rounds < MAX_CHANGE_ROUNDS ? (
                                <details>
                                  <summary className="cursor-pointer text-sm font-medium">
                                    Ask for changes ({MAX_CHANGE_ROUNDS - m.rounds} left)
                                  </summary>
                                  <ActionForm
                                    action={requestMilestoneChangesAction}
                                    label="Ask for these changes"
                                    pendingLabel="Sending…"
                                    variant="secondary"
                                    className="mt-2 space-y-2"
                                  >
                                    <input type="hidden" name="projectId" value={project.id} />
                                    <input type="hidden" name="milestoneId" value={m.id} />
                                    <Field label="What should change?" hint="stick to the criteria">
                                      <textarea
                                        name="note"
                                        required
                                        minLength={5}
                                        maxLength={2000}
                                        rows={3}
                                        className={inputClass}
                                      />
                                    </Field>
                                  </ActionForm>
                                </details>
                              ) : (
                                <p className="text-sm text-muted">
                                  No rounds of changes left: approve it, or raise a dispute below.
                                </p>
                              )}
                            </div>
                          )}

                        {isAdmin && project.status === "disputed" && HELD.includes(m.status) && (
                          <ActionForm
                            action={resolveMilestoneAction}
                            pendingLabel="Settling…"
                            className="border-t border-line pt-3"
                            buttons={[
                              { label: "Release to seller", intent: "release" },
                              { label: "Refund poster", intent: "refund", variant: "danger" },
                            ]}
                          >
                            <input type="hidden" name="projectId" value={project.id} />
                            <input type="hidden" name="milestoneId" value={m.id} />
                          </ActionForm>
                        )}
                      </Card>
                    </li>
                  );
                })}
              </ol>
            </section>
          )}

          {proposals.length > 0 && (
            <section className="space-y-3">
              <h2 className="font-display text-2xl font-medium tracking-[-0.02em]">
                {isPoster || role === "admin" ? `Proposals (${proposals.length})` : "Your proposal"}
              </h2>
              <ul className="space-y-3">
                {proposals.map((p) => (
                  <li key={p.id}>
                    <Card className="space-y-3 p-5">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <p className="font-medium">
                          <PersonLink person={{ name: p.sellerName, handle: p.sellerHandle }} /> ·{" "}
                          {formatUsd(p.priceCents)} · {p.days} day(s)
                        </p>
                        <Badge
                          tone={
                            p.status === "accepted"
                              ? "good"
                              : p.status === "declined"
                                ? "neutral"
                                : "accent"
                          }
                        >
                          {p.status}
                        </Badge>
                      </div>
                      <Prose>{p.message}</Prose>
                      {p.listingId && (
                        <Link
                          href={`/market/${p.listingId}`}
                          className="label-mono text-accent hover:underline"
                        >
                          Their listed skill →
                        </Link>
                      )}
                      {p.fit && <FitReportView fit={p.fit} />}
                      {isPoster && project.status === "open" && p.status === "pending" && (
                        <ActionForm
                          action={acceptProposalAction}
                          label={`Accept at ${formatUsd(p.priceCents)}`}
                          pendingLabel="Accepting…"
                          variant="accent"
                        >
                          <input type="hidden" name="projectId" value={project.id} />
                          <input type="hidden" name="proposalId" value={p.id} />
                          <p className="mb-2 text-xs text-muted">
                            Milestone amounts are rescaled to this price, in the same proportions.
                          </p>
                        </ActionForm>
                      )}
                    </Card>
                  </li>
                ))}
              </ul>
            </section>
          )}

          {project.status === "open" && !viewer && (
            <Card className="p-5 text-sm">
              <p className="mb-3">Want to do this work? Sign in to send a proposal.</p>
              <Link href={signIn} className={buttonClass("primary")}>
                Sign in to propose
              </Link>
            </Card>
          )}

          {canPropose && (
            <Card className="p-5">
              <h2 className="font-display text-lg font-medium tracking-[-0.02em]">
                Send a proposal
              </h2>
              <p className="mt-1 text-sm text-muted">
                Persuna writes the poster a short fit report on your proposal, using your verified
                skills. You&apos;ll see it too.
              </p>
              <ActionForm
                action={proposeAction}
                label="Send proposal"
                pendingLabel="Persuna is reading your proposal…"
                className="mt-4 space-y-4"
              >
                <input type="hidden" name="projectId" value={project.id} />
                <Field label="How you'd do it">
                  <textarea
                    name="message"
                    required
                    minLength={20}
                    maxLength={4000}
                    rows={6}
                    className={inputClass}
                  />
                </Field>
                <div className="grid gap-4 sm:grid-cols-2">
                  <Field label="Your price (US$)">
                    <input
                      name="price"
                      inputMode="decimal"
                      required
                      defaultValue={dollarsInput(project.budgetCents)}
                      className={inputClass}
                    />
                  </Field>
                  <Field label="Days to finish">
                    <input
                      name="days"
                      type="number"
                      min={1}
                      max={365}
                      required
                      defaultValue={Math.max(1, left)}
                      className={inputClass}
                    />
                  </Field>
                </div>
                {myListings.length > 0 && (
                  <Field label="Draw on one of your listed skills" hint="optional">
                    <select name="listingId" defaultValue="" className={inputClass}>
                      <option value="">None</option>
                      {myListings.map((l) => (
                        <option key={l.id} value={l.id}>
                          {l.title}
                        </option>
                      ))}
                    </select>
                  </Field>
                )}
              </ActionForm>
            </Card>
          )}

          {project.status === "completed" &&
            ((isPoster && !project.posterRating) || (isSeller && !project.sellerRating)) && (
              <Card className="p-5">
                <h2 className="font-display text-lg font-medium tracking-[-0.02em]">
                  Rate the {isPoster ? "seller" : "poster"}
                </h2>
                <ActionForm
                  action={rateProjectAction}
                  label="Save rating"
                  pendingLabel="Saving…"
                  className="mt-3 space-y-3"
                >
                  <input type="hidden" name="projectId" value={project.id} />
                  <div className="flex gap-3">
                    {[1, 2, 3, 4, 5].map((n) => (
                      <label key={n} className="flex items-center gap-1 text-sm">
                        <input
                          type="radio"
                          name="rating"
                          value={n}
                          required
                          defaultChecked={n === 5}
                        />{" "}
                        {n}
                      </label>
                    ))}
                  </div>
                  <Field label="Comment" hint="optional">
                    <input name="review" maxLength={1000} className={inputClass} />
                  </Field>
                </ActionForm>
              </Card>
            )}

          {party && (
            <section className="space-y-3">
              <h2 className="font-display text-2xl font-medium tracking-[-0.02em]">Timeline</h2>
              <Timeline updates={updates} />
            </section>
          )}
          {role === "proposer" && updates.length > 0 && (
            <section className="space-y-3">
              <h2 className="font-display text-2xl font-medium tracking-[-0.02em]">
                About your proposal
              </h2>
              <Timeline updates={updates} />
            </section>
          )}
        </div>

        <aside className="space-y-4">
          <FairDealPanel kind="project" revisions={MAX_CHANGE_ROUNDS} />
          {(isPoster || isSeller) && project.status === "in_progress" && (
            <Card className="p-4">
              <details>
                <summary className="cursor-pointer text-sm font-medium">Raise a dispute</summary>
                <p className="mt-2 text-sm text-muted">
                  Persuna writes a neutral assessment for both of you, held money stays in escrow,
                  and a person at Persuna decides.
                </p>
                <ActionForm
                  action={disputeAction}
                  label="Raise dispute"
                  pendingLabel="Persuna is assessing…"
                  variant="danger"
                  className="mt-3 space-y-3"
                >
                  <input type="hidden" name="projectId" value={project.id} />
                  <Field label="What's wrong?">
                    <textarea
                      name="reason"
                      required
                      minLength={10}
                      maxLength={2000}
                      rows={4}
                      className={inputClass}
                    />
                  </Field>
                </ActionForm>
              </details>
            </Card>
          )}
          {isPoster && ["draft", "open", "in_progress"].includes(project.status) && (
            <Card className="p-4">
              <details>
                <summary className="cursor-pointer text-sm font-medium">Cancel the project</summary>
                <p className="mt-2 text-sm text-muted">
                  Possible until work is delivered. Funded milestones are refunded.
                </p>
                <ActionForm
                  action={cancelProjectAction}
                  label="Cancel project"
                  pendingLabel="Cancelling…"
                  variant="danger"
                  className="mt-3"
                >
                  <input type="hidden" name="projectId" value={project.id} />
                </ActionForm>
              </details>
            </Card>
          )}
          {isAdmin && project.status === "disputed" && (
            <Card className="space-y-2 p-4 text-sm">
              <p className="font-medium">Reviewer</p>
              <p className="text-muted">
                Settle each held milestone above, or end the dispute and let the work carry on.
              </p>
              <ActionForm
                action={resumeProjectAction}
                label="End dispute, resume"
                pendingLabel="…"
                variant="secondary"
              >
                <input type="hidden" name="projectId" value={project.id} />
              </ActionForm>
            </Card>
          )}
          {project.status === "completed" && (project.posterRating || project.sellerRating) && (
            <Card className="space-y-1 p-4 text-sm">
              <p className="font-medium">Ratings</p>
              {project.posterRating && <p>Poster rated the seller {project.posterRating}/5</p>}
              {project.sellerRating && <p>Seller rated the poster {project.sellerRating}/5</p>}
            </Card>
          )}
        </aside>
      </div>
    </div>
  );
}

/** The poster reviews Persuna's plan, edits it, and opens the project. */
function DraftEditor({
  projectId,
  budgetCents,
  plan,
}: {
  projectId: string;
  budgetCents: number;
  plan: NonNullable<Awaited<ReturnType<typeof getProject>>["project"]["plan"]>;
}) {
  const slots = Array.from({ length: MAX_MILESTONES }, (_, i) => plan.milestones[i] ?? null);
  return (
    <Card className="space-y-4 border-accent/50 p-5">
      <h2 className="font-display text-xl font-medium tracking-[-0.02em]">
        Persuna&apos;s plan: check it, then open the project
      </h2>
      {plan.flags.length > 0 ? (
        <ul className="space-y-2">
          {plan.flags.map((f) => (
            <li key={f.message} className="flex items-start gap-2 text-sm">
              <Badge tone="warn">{f.kind.replace("_", " ")}</Badge>
              <span>{f.message}</span>
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-sm text-good">Nothing vague or one-sided stood out.</p>
      )}
      <ActionForm
        action={savePlanAction}
        pendingLabel="Saving…"
        className="space-y-4"
        buttons={[
          { label: "Save draft", intent: "save", variant: "secondary" },
          { label: "Open for proposals", intent: "open", variant: "accent" },
        ]}
      >
        <input type="hidden" name="projectId" value={projectId} />
        <Field label="Scope">
          <textarea
            name="scope"
            required
            rows={4}
            defaultValue={plan.scope}
            className={inputClass}
          />
        </Field>
        <Field label="Acceptance criteria" hint="one per line">
          <textarea
            name="criteria"
            rows={4}
            defaultValue={plan.criteria.join("\n")}
            className={inputClass}
          />
        </Field>
        <div className="max-w-48">
          <Field label="Budget (US$)">
            <input
              name="budget"
              inputMode="decimal"
              required
              defaultValue={dollarsInput(budgetCents)}
              className={inputClass}
            />
          </Field>
        </div>
        <p className="text-sm text-muted">
          Milestones must add up to the budget. Leave a slot empty to drop it (up to{" "}
          {MAX_MILESTONES}).
        </p>
        {slots.map((m, i) => (
          <fieldset
            key={i}
            className="grid gap-3 rounded-md border border-line p-3 sm:grid-cols-[1fr_8rem]"
          >
            <legend className="px-1 text-xs text-muted">Milestone {i + 1}</legend>
            <Field label="Title">
              <input name={`m${i}_title`} defaultValue={m?.title ?? ""} className={inputClass} />
            </Field>
            <Field label="Amount (US$)">
              <input
                name={`m${i}_amount`}
                inputMode="decimal"
                defaultValue={m ? dollarsInput(m.amountCents) : ""}
                className={inputClass}
              />
            </Field>
            <div className="sm:col-span-2">
              <Field label="Acceptance criteria" hint="one per line">
                <textarea
                  name={`m${i}_criteria`}
                  rows={3}
                  defaultValue={m?.criteria.join("\n") ?? ""}
                  className={inputClass}
                />
              </Field>
            </div>
          </fieldset>
        ))}
      </ActionForm>
    </Card>
  );
}

/** A person's name, linking to their public profile when they have one. */
function PersonLink({ person }: { person: { name: string; handle: string | null } }) {
  return person.handle ? (
    <Link href={`/persunas/${person.handle}`} className="text-accent hover:underline">
      {person.name}
    </Link>
  ) : (
    <>{person.name}</>
  );
}
