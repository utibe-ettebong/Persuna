import type { Metadata } from "next";
import Link from "next/link";
import {
  attachSkillAction,
  detachSkillAction,
  editPlaybookAction,
  generatePlaybookAction,
  publishPlaybookAction,
  startOnboardingAction,
  updateRoleAction,
} from "@/app/actions/teams";
import { ActionForm } from "@/components/action-form";
import { Markdown } from "@/components/markdown";
import { ConfidentialNote, PlaybookView, Progress } from "@/components/team";
import { Badge, Card, Field, inputClass, PageHeader, PanelTitle } from "@/components/ui";
import { requireUser } from "@/lib/auth/session";
import { orNotFound } from "@/lib/load";
import { renderSheet } from "@/lib/skill/sheet";
import { roleView } from "@/lib/teams/service";
import type { Playbook, PlaybookWorkflow } from "@/lib/teams/types";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Role" };

type Props = { params: Promise<{ id: string }> };

const date = (d: Date) => d.toLocaleDateString("en-GB", { dateStyle: "medium" });
const joined = (items: string[]) => items.join("\n");

const BLANK: PlaybookWorkflow = {
  title: "",
  when: "",
  steps: [],
  tools: [],
  qualityBar: [],
  mistakes: [],
};

function PlaybookEditor({ id, playbook }: { id: string; playbook: Playbook }) {
  const workflows = [...playbook.workflows, ...(playbook.workflows.length < 8 ? [BLANK] : [])];
  return (
    <ActionForm
      action={editPlaybookAction}
      pendingLabel="Saving…"
      buttons={[
        { label: "Save", intent: "save", variant: "secondary" },
        { label: "Save and publish", intent: "publish" },
      ]}
      className="space-y-4"
    >
      <input type="hidden" name="playbookId" value={id} />
      <Field label="Summary">
        <textarea
          name="summary"
          rows={3}
          defaultValue={playbook.summary}
          required
          className={inputClass}
        />
      </Field>
      <div className="grid gap-3 sm:grid-cols-3">
        <Field label="Tools" hint="one per line">
          <textarea
            name="tools"
            rows={4}
            defaultValue={joined(playbook.tools)}
            className={inputClass}
          />
        </Field>
        <Field label="Quality bar" hint="one per line">
          <textarea
            name="quality"
            rows={4}
            defaultValue={joined(playbook.qualityBar)}
            className={inputClass}
          />
        </Field>
        <Field label="Common mistakes" hint="one per line">
          <textarea
            name="mistakes"
            rows={4}
            defaultValue={joined(playbook.mistakes)}
            className={inputClass}
          />
        </Field>
      </div>
      {workflows.map((w, i) => (
        <fieldset key={i} className="space-y-3 rounded-md border border-line p-4">
          <legend className="label-mono px-1 text-muted">
            {w.title ? `Workflow ${i + 1}` : "Add a workflow"}
          </legend>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Title">
              <input
                name={`w${i}_title`}
                defaultValue={w.title}
                maxLength={120}
                className={inputClass}
              />
            </Field>
            <Field label="When it runs">
              <input
                name={`w${i}_when`}
                defaultValue={w.when}
                maxLength={300}
                className={inputClass}
              />
            </Field>
          </div>
          <Field label="Steps" hint="one per line, in order">
            <textarea
              name={`w${i}_steps`}
              rows={5}
              defaultValue={joined(w.steps)}
              className={inputClass}
            />
          </Field>
          <div className="grid gap-3 sm:grid-cols-3">
            <Field label="Tools">
              <textarea
                name={`w${i}_tools`}
                rows={3}
                defaultValue={joined(w.tools)}
                className={inputClass}
              />
            </Field>
            <Field label="Quality bar">
              <textarea
                name={`w${i}_quality`}
                rows={3}
                defaultValue={joined(w.qualityBar)}
                className={inputClass}
              />
            </Field>
            <Field label="Common mistakes">
              <textarea
                name={`w${i}_mistakes`}
                rows={3}
                defaultValue={joined(w.mistakes)}
                className={inputClass}
              />
            </Field>
          </div>
        </fieldset>
      ))}
      <p className="text-xs text-muted">
        Clear a workflow&apos;s title and steps to remove it. Editing a published version saves a
        new draft; recruits keep the published one until you publish again.
      </p>
    </ActionForm>
  );
}

export default async function RolePage({ params }: Props) {
  const user = await requireUser();
  const { id } = await params;
  const view = await orNotFound(() => roleView(user, id), id);
  const { org, role, admin, holders, skills, playbook, published, versions, members, onboardings } =
    view;
  const back = `/team/roles/${role.id}`;
  const current = holders.filter((h) => h.status === "active");
  const former = holders.filter((h) => h.status === "left");

  return (
    <div className="space-y-6">
      <PageHeader
        back={{ href: `/team?org=${org.slug}`, label: org.name }}
        title={role.title}
        description={role.description || undefined}
      />

      <div className="grid gap-6 lg:grid-cols-[1fr_20rem]">
        <Card className="p-5">
          <PanelTitle>Skills in this role</PanelTitle>
          <p className="mb-3 text-sm text-muted">
            The method of these skills, from current and former {role.title}s, is what the playbook
            is built from. Examples and job text are never used.
          </p>
          {skills.length === 0 && <p className="text-sm text-muted">None attached yet.</p>}
          <ul className="space-y-3">
            {skills.map((s) => (
              <li key={s.id} className="rounded-md border border-line p-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="text-sm">
                    <span className="font-medium">{s.name}</span>{" "}
                    <span className="text-muted">by {s.holder}</span>{" "}
                    {s.origin === "playbook" && <Badge>From the playbook</Badge>}
                  </div>
                  {s.canDetach && (
                    <ActionForm
                      action={detachSkillAction}
                      label="Detach"
                      pendingLabel="Detaching…"
                      variant="secondary"
                    >
                      <input type="hidden" name="linkId" value={s.id} />
                      <input type="hidden" name="back" value={back} />
                    </ActionForm>
                  )}
                </div>
                {s.sheet ? (
                  <details className="mt-2">
                    <summary className="label-mono cursor-pointer text-muted">Method</summary>
                    <div className="mt-2 text-sm">
                      <Markdown text={renderSheet(s.sheet)} />
                    </div>
                  </details>
                ) : (
                  <p className="mt-1 text-xs text-muted">Not trained yet: no rules to use.</p>
                )}
              </li>
            ))}
          </ul>
          {view.attachable.length > 0 && (
            <ActionForm
              action={attachSkillAction}
              label="Attach"
              pendingLabel="Attaching…"
              className="mt-4 flex flex-wrap items-end gap-2"
            >
              <input type="hidden" name="roleId" value={role.id} />
              <input type="hidden" name="back" value={back} />
              <div className="min-w-48 flex-1">
                <Field label="Attach one of your skills">
                  <select name="skill" className={inputClass}>
                    {view.attachable.map((s) => (
                      <option key={s.id} value={s.slug}>
                        {s.name}
                      </option>
                    ))}
                  </select>
                </Field>
              </div>
            </ActionForm>
          )}
          <div className="mt-4">
            <ConfidentialNote />
          </div>
        </Card>

        <div className="space-y-6">
          <Card className="p-5">
            <PanelTitle>People</PanelTitle>
            <ul className="space-y-1 text-sm">
              {current.map((h) => (
                <li key={h.id}>
                  {h.name} {h.admin && <Badge>Admin</Badge>}
                </li>
              ))}
              {current.length === 0 && <li className="text-muted">Nobody yet.</li>}
            </ul>
            {former.length > 0 && (
              <p className="mt-2 text-xs text-muted">
                Formerly: {former.map((h) => h.name).join(", ")}
              </p>
            )}
          </Card>
          {admin && (
            <Card className="p-5">
              <PanelTitle>Edit role</PanelTitle>
              <ActionForm
                action={updateRoleAction}
                label="Save"
                pendingLabel="Saving…"
                variant="secondary"
                className="space-y-3"
              >
                <input type="hidden" name="roleId" value={role.id} />
                <Field label="Title">
                  <input
                    name="title"
                    required
                    defaultValue={role.title}
                    maxLength={80}
                    className={inputClass}
                  />
                </Field>
                <Field label="What the role does">
                  <textarea
                    name="description"
                    rows={3}
                    defaultValue={role.description}
                    maxLength={2000}
                    className={inputClass}
                  />
                </Field>
              </ActionForm>
            </Card>
          )}
        </div>
      </div>

      <Card className="p-5">
        <div id="playbook" className="flex flex-wrap items-center justify-between gap-3">
          <PanelTitle>Playbook</PanelTitle>
          {playbook && (
            <span className="text-sm text-muted">
              Version {playbook.version} · {playbook.status === "published" ? "published" : "draft"}{" "}
              · {date(playbook.updatedAt)}
            </span>
          )}
        </div>
        {!playbook && (
          <p className="mb-4 text-sm text-muted">
            {admin
              ? "Persuna writes the playbook from the skills above and the handbook: the workflows this role runs, step by step, the tools, the quality bar and common mistakes. You review and edit it before new hires see it."
              : "No playbook has been published for this role yet."}
          </p>
        )}
        {playbook && !admin && <PlaybookView playbook={playbook.content} />}
        {playbook && admin && (
          <div className="space-y-4">
            {playbook.status === "draft" && (
              <p className="text-sm text-warn">
                This draft isn&apos;t visible to recruits until you publish it.
                {published ? ` They see version ${published.version} for now.` : ""}
              </p>
            )}
            <details open={playbook.status === "draft"}>
              <summary className="label-mono cursor-pointer text-muted">Read</summary>
              <div className="mt-3">
                <PlaybookView playbook={playbook.content} />
              </div>
            </details>
            <details>
              <summary className="label-mono cursor-pointer text-muted">Edit</summary>
              <div className="mt-3">
                <PlaybookEditor id={playbook.id} playbook={playbook.content} />
              </div>
            </details>
            {playbook.status === "draft" && (
              <ActionForm
                action={publishPlaybookAction}
                label="Publish to recruits"
                pendingLabel="Publishing…"
              >
                <input type="hidden" name="playbookId" value={playbook.id} />
                <input type="hidden" name="back" value={`${back}#playbook`} />
              </ActionForm>
            )}
          </div>
        )}
        {admin && (
          <ActionForm
            action={generatePlaybookAction}
            label={playbook ? "Rebuild from the latest skills" : "Build the playbook"}
            pendingLabel="Persuna is writing the playbook…"
            variant={playbook ? "secondary" : "primary"}
            className="mt-4"
          >
            <input type="hidden" name="roleId" value={role.id} />
          </ActionForm>
        )}
        {admin && versions.length > 1 && (
          <p className="mt-3 text-xs text-muted">
            Versions:{" "}
            {versions
              .map(
                (v) => `v${v.version} ${v.status}${v.publishedAt ? ` ${date(v.publishedAt)}` : ""}`,
              )
              .join(" · ")}
          </p>
        )}
      </Card>

      {admin && (
        <Card className="p-5">
          <PanelTitle>Onboarding</PanelTitle>
          {onboardings.length > 0 && (
            <ul className="mb-4 divide-y divide-line">
              {onboardings.map((o) => (
                <li
                  key={o.id}
                  className="grid gap-2 py-2.5 sm:grid-cols-[1fr_14rem] sm:items-center"
                >
                  <span className="text-sm">
                    <Link href={`/team/onboarding/${o.id}`} className="font-medium hover:underline">
                      {o.name}
                    </Link>{" "}
                    {o.status === "completed" && <Badge tone="good">Finished</Badge>}
                  </span>
                  <Progress done={o.done} total={o.total} />
                </li>
              ))}
            </ul>
          )}
          {published ? (
            <ActionForm
              action={startOnboardingAction}
              label="Start onboarding"
              pendingLabel="Persuna is planning the onboarding…"
              className="flex flex-wrap items-end gap-2"
            >
              <input type="hidden" name="roleId" value={role.id} />
              <div className="min-w-48 flex-1">
                <Field label="New hire" hint="invite them first from People">
                  <select name="memberId" className={inputClass}>
                    {members.map((m) => (
                      <option key={m.id} value={m.id}>
                        {m.name}
                      </option>
                    ))}
                  </select>
                </Field>
              </div>
            </ActionForm>
          ) : (
            <p className="text-sm text-muted">
              Publish the playbook to onboard new hires into this role. Invite them from People with
              &quot;New hire&quot; ticked and their onboarding starts when they join.
            </p>
          )}
        </Card>
      )}
    </div>
  );
}
