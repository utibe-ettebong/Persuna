import type { Metadata } from "next";
import Link from "next/link";
import {
  acceptInviteByIdAction,
  attachSkillAction,
  createOrgAction,
  createRoleAction,
  detachSkillAction,
} from "@/app/actions/teams";
import { ActionForm } from "@/components/action-form";
import { ConfidentialNote, Progress, TeamTabs } from "@/components/team";
import { Badge, Card, Field, inputClass, PageHeader, PanelTitle } from "@/components/ui";
import { requireUser } from "@/lib/auth/session";
import { teamOverview } from "@/lib/teams/service";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Team" };

type Props = { searchParams: Promise<{ org?: string }> };

function CreateOrgForm() {
  return (
    <ActionForm
      action={createOrgAction}
      label="Create organisation"
      pendingLabel="Creating…"
      className="space-y-3"
    >
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Company name">
          <input name="name" required minLength={2} maxLength={120} className={inputClass} />
        </Field>
        <Field label="Your role there" hint="e.g. Founder, Head of Design">
          <input name="roleTitle" required minLength={2} maxLength={80} className={inputClass} />
        </Field>
      </div>
    </ActionForm>
  );
}

export default async function TeamPage({ searchParams }: Props) {
  const user = await requireUser("/team");
  const { org: slug } = await searchParams;
  const { memberships, invites, current } = await teamOverview(user, slug);

  const inviteList = invites.length > 0 && (
    <Card className="p-5">
      <PanelTitle>Invitations for you</PanelTitle>
      <ul className="space-y-3">
        {invites.map((i) => (
          <li key={i.id} className="flex flex-wrap items-center justify-between gap-3">
            <span className="text-sm">
              <strong>{i.org}</strong>
              {i.role ? ` as ${i.role}` : ""}
            </span>
            <ActionForm action={acceptInviteByIdAction} label="Join" pendingLabel="Joining…">
              <input type="hidden" name="inviteId" value={i.id} />
            </ActionForm>
          </li>
        ))}
      </ul>
    </Card>
  );

  if (!current) {
    return (
      <div className="max-w-3xl space-y-6">
        <PageHeader
          eyebrow="Persuna for teams"
          title="Team"
          description="Give everyone at your company a Persuna that learns their role and the way your company works, privately. When you hire, Persuna takes the new person through how the job is done here: the workflows, the tools, the quality bar."
        />
        {inviteList}
        <Card className="p-5">
          <PanelTitle>Start an organisation</PanelTitle>
          <CreateOrgForm />
        </Card>
        <ConfidentialNote />
      </div>
    );
  }

  const { org, admin, myRole, roles, people, onboardings, mySkills, attachable, shared } = current;
  const back = `/team?org=${org.slug}`;
  const active = onboardings.filter((o) => o.status === "active");
  const finished = onboardings.filter((o) => o.status === "completed");

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Team"
        title={org.name}
        description={
          myRole
            ? `You're ${admin ? "an admin and " : ""}${myRole.title} here.`
            : admin
              ? "You're an admin here."
              : "You don't have a role here yet."
        }
      >
        {memberships.length > 1 &&
          memberships
            .filter((m) => m.org.id !== org.id)
            .map((m) => (
              <Link key={m.org.id} href={`/team?org=${m.org.slug}`} className="text-sm underline">
                {m.org.name}
              </Link>
            ))}
      </PageHeader>
      <TeamTabs slug={org.slug} active="Overview" />
      {inviteList}

      {active.length > 0 && (
        <Card className="p-5">
          <PanelTitle>Onboarding in progress</PanelTitle>
          <ul className="divide-y divide-line">
            {active.map((o) => (
              <li key={o.id} className="grid gap-2 py-3 sm:grid-cols-[1fr_14rem] sm:items-center">
                <div>
                  <Link href={`/team/onboarding/${o.id}`} className="font-medium hover:underline">
                    {o.name}
                  </Link>{" "}
                  <span className="text-sm text-muted">
                    as {o.role}
                    {o.next ? ` · next: ${o.next.title}` : ""}
                  </span>
                </div>
                <Progress done={o.done} total={o.total} />
              </li>
            ))}
          </ul>
        </Card>
      )}

      <div className="grid gap-6 lg:grid-cols-2">
        <Card className="p-5">
          <PanelTitle>Roles</PanelTitle>
          <ul className="divide-y divide-line">
            {roles.map((r) => (
              <li key={r.id} className="flex items-center justify-between gap-3 py-2.5">
                {r.visible ? (
                  <Link href={`/team/roles/${r.id}`} className="font-medium hover:underline">
                    {r.title}
                  </Link>
                ) : (
                  <span className="font-medium">{r.title}</span>
                )}
                <span className="text-sm text-muted">
                  {r.people} {r.people === 1 ? "person" : "people"} · {r.skills}{" "}
                  {r.skills === 1 ? "skill" : "skills"}
                </span>
              </li>
            ))}
          </ul>
          {admin && (
            <details className="mt-4">
              <summary className="label-mono cursor-pointer text-muted">Add a role</summary>
              <ActionForm
                action={createRoleAction}
                label="Add role"
                pendingLabel="Adding…"
                className="mt-3 space-y-3"
              >
                <input type="hidden" name="orgId" value={org.id} />
                <Field label="Title">
                  <input
                    name="title"
                    required
                    minLength={2}
                    maxLength={80}
                    className={inputClass}
                  />
                </Field>
                <Field label="What the role does" hint="optional">
                  <textarea name="description" rows={3} maxLength={2000} className={inputClass} />
                </Field>
              </ActionForm>
            </details>
          )}
        </Card>

        <Card className="p-5">
          <PanelTitle>People</PanelTitle>
          <ul className="divide-y divide-line">
            {people.slice(0, 12).map((p) => (
              <li key={p.id} className="flex items-center justify-between gap-3 py-2.5 text-sm">
                <span>
                  {p.name} {p.admin && <Badge>Admin</Badge>}
                </span>
                <span className="text-muted">{p.role ?? "No role"}</span>
              </li>
            ))}
          </ul>
          <Link
            href={`/team/members?org=${org.slug}`}
            className="mt-3 inline-block text-sm underline"
          >
            {admin ? "Manage people and invite" : "Everyone"}
          </Link>
        </Card>
      </div>

      {myRole && (
        <Card className="p-5">
          <PanelTitle>Your skills in this job</PanelTitle>
          <p className="mb-3 text-sm text-muted">
            Attach the skills that are part of your work as {myRole.title}. Persuna uses their
            method (never your examples or jobs) to build the role&apos;s playbook for new hires.
          </p>
          {mySkills.length > 0 && (
            <ul className="mb-4 divide-y divide-line">
              {mySkills.map((s) => (
                <li key={s.linkId} className="flex items-center justify-between gap-3 py-2">
                  <span className="text-sm">
                    <Link href={`/skills/${s.slug}`} className="hover:underline">
                      {s.name}
                    </Link>{" "}
                    <Badge tone="accent">Confidential</Badge>{" "}
                    {s.origin === "playbook" && <Badge>From the playbook</Badge>}
                  </span>
                  {(s.origin === "member" || admin) && (
                    <ActionForm
                      action={detachSkillAction}
                      label="Detach"
                      pendingLabel="Detaching…"
                      variant="secondary"
                    >
                      <input type="hidden" name="linkId" value={s.linkId} />
                      <input type="hidden" name="back" value={back} />
                    </ActionForm>
                  )}
                </li>
              ))}
            </ul>
          )}
          {attachable.length > 0 ? (
            <ActionForm
              action={attachSkillAction}
              label="Attach to my role"
              pendingLabel="Attaching…"
              className="flex flex-wrap items-end gap-2"
            >
              <input type="hidden" name="roleId" value={myRole.id} />
              <input type="hidden" name="back" value={back} />
              <div className="min-w-48 flex-1">
                <Field label="Skill">
                  <select name="skill" className={inputClass}>
                    {attachable.map((s) => (
                      <option key={s.id} value={s.slug}>
                        {s.name}
                      </option>
                    ))}
                  </select>
                </Field>
              </div>
            </ActionForm>
          ) : (
            <p className="text-sm text-muted">
              {mySkills.length ? "All your skills are attached." : "You have no skills yet."}{" "}
              <Link href="/skills/new" className="underline">
                Teach Persuna a new one
              </Link>
              .
            </p>
          )}
          <div className="mt-4">
            <ConfidentialNote />
          </div>
        </Card>
      )}

      {shared.length > 0 && (
        <Card className="p-5">
          <PanelTitle>Shared by the team</PanelTitle>
          <p className="mb-3 text-sm text-muted">
            Teammates&apos; skills they&apos;ve shared. Shared skills stay theirs — still listable,
            never confidential.
          </p>
          <ul className="divide-y divide-line">
            {shared.map((s) => (
              <li key={s.id} className="flex items-center justify-between gap-3 py-2">
                <span className="text-sm">
                  <Link href={`/skills/${s.slug}`} className="hover:underline">
                    {s.name}
                  </Link>{" "}
                  <span className="text-muted">by {s.mine ? "you" : s.owner}</span>
                </span>
                {s.mine && <Badge>Yours</Badge>}
              </li>
            ))}
          </ul>
        </Card>
      )}

      {finished.length > 0 && (
        <Card className="p-5">
          <PanelTitle>Finished onboarding</PanelTitle>
          <ul className="space-y-1 text-sm">
            {finished.map((o) => (
              <li key={o.id}>
                <Link href={`/team/onboarding/${o.id}`} className="hover:underline">
                  {o.name}
                </Link>{" "}
                <span className="text-muted">as {o.role}</span>
              </li>
            ))}
          </ul>
        </Card>
      )}

      <details>
        <summary className="label-mono cursor-pointer text-muted">
          Start another organisation
        </summary>
        <Card className="mt-3 p-5">
          <CreateOrgForm />
        </Card>
      </details>
    </div>
  );
}
