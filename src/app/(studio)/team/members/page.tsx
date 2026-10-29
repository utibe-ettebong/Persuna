import type { Metadata } from "next";
import { notFound } from "next/navigation";
import {
  removeMemberAction,
  revokeInviteAction,
  setMemberAdminAction,
  setMemberRoleAction,
  startOnboardingAction,
} from "@/app/actions/teams";
import { ActionForm } from "@/components/action-form";
import { TeamTabs } from "@/components/team";
import { InviteForm } from "@/components/team-forms";
import { Badge, Card, inputClass, PageHeader, PanelTitle } from "@/components/ui";
import { requireUser } from "@/lib/auth/session";
import { orNotFound } from "@/lib/load";
import { membersView, membershipsOf } from "@/lib/teams/service";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "People" };

type Props = { searchParams: Promise<{ org?: string }> };

const date = (d: Date) => d.toLocaleDateString("en-GB", { dateStyle: "medium" });

const INVITE_TONE = {
  pending: "warn",
  accepted: "good",
  revoked: "neutral",
  expired: "neutral",
} as const;

export default async function MembersPage({ searchParams }: Props) {
  const user = await requireUser("/team");
  const { org: slug } = await searchParams;
  const memberships = await membershipsOf(user.id);
  const chosen = memberships.find((m) => m.org.slug === slug) ?? memberships[0];
  if (!chosen) notFound();
  const { org, me, admin, roles, people, invites } = await orNotFound(() =>
    membersView(user, chosen.org.id),
  );
  const back = `/team/members?org=${org.slug}`;

  return (
    <div className="space-y-6">
      <PageHeader eyebrow="Team" title={`People at ${org.name}`} />
      <TeamTabs slug={org.slug} active="People" />

      <Card className="p-5">
        <PanelTitle>People</PanelTitle>
        <ul className="divide-y divide-line">
          {people.map((p) => (
            <li key={p.id} className="space-y-2 py-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="text-sm">
                  <span className="font-medium">{p.name}</span>{" "}
                  <span className="text-muted">{p.email}</span> {p.admin && <Badge>Admin</Badge>}{" "}
                  {p.status === "left" && <Badge tone="neutral">Left</Badge>}
                </div>
                <span className="text-sm text-muted">
                  {p.role ?? "No role"} · joined {date(p.joinedAt)}
                </span>
              </div>
              {admin && p.status === "active" && (
                <div className="flex flex-wrap items-end gap-3">
                  <ActionForm
                    action={setMemberRoleAction}
                    label="Set role"
                    pendingLabel="Saving…"
                    variant="secondary"
                    className="flex items-end gap-2"
                  >
                    <input type="hidden" name="memberId" value={p.id} />
                    <input type="hidden" name="back" value={back} />
                    <select
                      name="roleId"
                      defaultValue={p.roleId ?? ""}
                      className={`${inputClass} mt-0 w-44`}
                      aria-label={`Role for ${p.name}`}
                    >
                      <option value="">No role</option>
                      {roles.map((r) => (
                        <option key={r.id} value={r.id}>
                          {r.title}
                        </option>
                      ))}
                    </select>
                  </ActionForm>
                  <ActionForm
                    action={setMemberAdminAction}
                    label={p.admin ? "Remove admin" : "Make admin"}
                    pendingLabel="Saving…"
                    variant="secondary"
                  >
                    <input type="hidden" name="memberId" value={p.id} />
                    <input type="hidden" name="admin" value={p.admin ? "false" : "true"} />
                    <input type="hidden" name="back" value={back} />
                  </ActionForm>
                  {p.roleId && p.id !== me.id && (
                    <ActionForm
                      action={startOnboardingAction}
                      label="Start onboarding"
                      pendingLabel="Persuna is planning it…"
                      variant="secondary"
                    >
                      <input type="hidden" name="memberId" value={p.id} />
                      <input type="hidden" name="roleId" value={p.roleId} />
                    </ActionForm>
                  )}
                  {p.id !== me.id && (
                    <ActionForm
                      action={removeMemberAction}
                      label="Remove"
                      pendingLabel="Removing…"
                      variant="danger"
                    >
                      <input type="hidden" name="memberId" value={p.id} />
                      <input type="hidden" name="back" value={back} />
                    </ActionForm>
                  )}
                </div>
              )}
            </li>
          ))}
        </ul>
        <div className="mt-4 border-t border-line pt-4">
          <ActionForm
            action={removeMemberAction}
            label={`Leave ${org.name}`}
            pendingLabel="Leaving…"
            variant="danger"
          >
            <input type="hidden" name="memberId" value={me.id} />
            <input type="hidden" name="back" value="/team" />
          </ActionForm>
          <p className="mt-2 text-xs text-muted">
            Skills you attached stay with the role as company know-how, and stay confidential.
          </p>
        </div>
      </Card>

      {admin && (
        <Card className="p-5">
          <PanelTitle>Invite someone</PanelTitle>
          <InviteForm orgId={org.id} roles={roles.map((r) => ({ id: r.id, title: r.title }))} />
        </Card>
      )}

      {admin && invites.length > 0 && (
        <Card className="p-5">
          <PanelTitle>Invitations</PanelTitle>
          <ul className="divide-y divide-line">
            {invites.map((i) => (
              <li key={i.id} className="flex flex-wrap items-center justify-between gap-3 py-2.5">
                <span className="text-sm">
                  {i.email} <span className="text-muted">{i.role ? `as ${i.role}` : ""}</span>{" "}
                  <Badge tone={INVITE_TONE[i.state]}>{i.state}</Badge>{" "}
                  {i.onboard && <Badge>New hire</Badge>}
                </span>
                {i.state === "pending" && (
                  <ActionForm
                    action={revokeInviteAction}
                    label="Withdraw"
                    pendingLabel="Withdrawing…"
                    variant="secondary"
                  >
                    <input type="hidden" name="inviteId" value={i.id} />
                    <input type="hidden" name="back" value={back} />
                  </ActionForm>
                )}
              </li>
            ))}
          </ul>
        </Card>
      )}
    </div>
  );
}
