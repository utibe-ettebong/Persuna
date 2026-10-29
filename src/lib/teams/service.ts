/**
 * Persuna for teams. A company's people join an organisation, each in a role.
 * They attach the skills that are part of their job, which makes those skills
 * company know-how: confidential, never listed or shown in public. Admins
 * write a handbook of how the company works. For each role Persuna builds a
 * playbook from the method of its skills (rule sheets, never examples or job
 * text) and the handbook; admins edit and publish it. When the company hires,
 * Persuna turns the playbook into an onboarding plan and takes the recruit
 * through it: lessons, practice, checks, and questions answered from the
 * playbook. At the end the recruit can take starter skills made from it.
 *
 * Who may do what is decided by ./rules; every change is audited.
 */
import { and, asc, desc, eq, isNull, ne } from "drizzle-orm";
import { db, schema } from "@/db/client";
import type { Onboarding, Organisation, OrgMember, OrgRole } from "@/db/schema";
import { audit, type Actor } from "@/lib/audit";
import { slugify } from "@/lib/action-state";
import type { ModelClient } from "@/lib/models/gateway";
import { renderSheet } from "@/lib/skill/sheet";
import { NotFoundError, createSkill, createVersion, getVersion } from "@/lib/skill/service";
import { normalizeText } from "@/lib/text";
import { answerQuestion, buildOnboardingPlan, buildPlaybook, gradeAnswers } from "./brain";
import {
  canCompleteModule,
  moduleMaterial,
  onboardingNote,
  onboardingProgress,
  playbookProblem,
  renderHandbook,
  renderPlaybook,
  starterSheet,
} from "./onboarding";
import {
  TeamRuleError,
  canAcceptInvite,
  canAttachSkill,
  canDetachSkill,
  canManage,
  canSeeOnboarding,
  canSeeOrg,
  canSeeRole,
  canWorkOnboarding,
  hashToken,
  inviteExpiry,
  inviteState,
  isEmail,
  keepsAnAdmin,
  looksLikeToken,
  newInviteToken,
  normaliseEmail,
  type Membership,
} from "./rules";
import {
  playbookSchema,
  type ModuleProgress,
  type OnboardingProgress,
  type Playbook,
} from "./types";

const {
  organisations,
  orgRoles,
  orgMembers,
  orgInvites,
  orgRoleSkills,
  orgHandbookNotes,
  rolePlaybooks,
  onboardings,
  skills,
  listings,
  authUsers,
} = schema;

/** The signed-in person acting. */
export interface TeamUser {
  id: string;
  email: string;
  name: string;
}

const actorOf = (user: { email: string }): Actor => `user:${user.email}`;

export const HANDBOOK_KINDS = ["values", "tools", "process", "other"] as const;
export type HandbookKind = (typeof HANDBOOK_KINDS)[number];

/* ---------- Loading and permission checks ---------- */

async function loadOrg(orgId: string) {
  const org = await db().query.organisations.findFirst({ where: eq(organisations.id, orgId) });
  if (!org) throw new NotFoundError("No such organisation");
  return org;
}

async function memberRow(orgId: string, userId: string) {
  return (
    (await db().query.orgMembers.findFirst({
      where: and(eq(orgMembers.orgId, orgId), eq(orgMembers.userId, userId)),
    })) ?? null
  );
}

const asMembership = (m: OrgMember | null): Membership =>
  m ? { id: m.id, admin: m.admin, status: m.status, roleId: m.roleId } : null;

/** The person's membership in this organisation; anyone outside it is told it doesn't exist. */
async function requireMember(orgId: string, user: TeamUser) {
  const org = await loadOrg(orgId);
  const me = await memberRow(orgId, user.id);
  if (!canSeeOrg(asMembership(me))) throw new NotFoundError("No such organisation");
  return { org, me: me! };
}

async function requireAdmin(orgId: string, user: TeamUser) {
  const found = await requireMember(orgId, user);
  if (!canManage(asMembership(found.me))) {
    throw new TeamRuleError("Only the organisation's admins can do that");
  }
  return found;
}

async function loadRole(roleId: string) {
  const role = await db().query.orgRoles.findFirst({ where: eq(orgRoles.id, roleId) });
  if (!role) throw new NotFoundError("No such role");
  return role;
}

async function activeAdmins(orgId: string) {
  return db()
    .select({ id: orgMembers.id })
    .from(orgMembers)
    .where(
      and(eq(orgMembers.orgId, orgId), eq(orgMembers.admin, true), eq(orgMembers.status, "active")),
    );
}

/* ---------- Organisations ---------- */

/** The organisations this person is in (active), with their place in each. */
export async function membershipsOf(userId: string) {
  return db()
    .select({ org: organisations, member: orgMembers, role: orgRoles })
    .from(orgMembers)
    .innerJoin(organisations, eq(orgMembers.orgId, organisations.id))
    .leftJoin(orgRoles, eq(orgMembers.roleId, orgRoles.id))
    .where(and(eq(orgMembers.userId, userId), eq(orgMembers.status, "active")))
    .orderBy(asc(organisations.name));
}

/** Someone starts an organisation: they become its first admin, in the role they name. */
export async function createOrganisation(
  user: TeamUser,
  input: { name: string; roleTitle: string },
) {
  const name = normalizeText(input.name).slice(0, 120);
  const roleTitle = normalizeText(input.roleTitle).slice(0, 80);
  if (name.length < 2) throw new TeamRuleError("Name the organisation");
  if (roleTitle.length < 2) throw new TeamRuleError("Say what your role is (e.g. Founder)");
  const base = slugify(name) || "team";
  return db().transaction(async (tx) => {
    let org: Organisation | undefined;
    for (let n = 1; !org && n <= 50; n++) {
      [org] = await tx
        .insert(organisations)
        .values({ name, slug: n === 1 ? base : `${base}-${n}`, createdBy: user.id })
        .onConflictDoNothing({ target: organisations.slug })
        .returning();
    }
    if (!org) throw new TeamRuleError("Couldn't find a free address for this name; try another");
    const [role] = await tx
      .insert(orgRoles)
      .values({ orgId: org.id, title: roleTitle })
      .returning();
    const [member] = await tx
      .insert(orgMembers)
      .values({ orgId: org.id, userId: user.id, roleId: role.id, admin: true })
      .returning();
    const actor = actorOf(user);
    await audit(
      { actor, action: "organisation.created", entityType: "organisation", entityId: org.id },
      tx,
    );
    await audit(
      { actor, action: "org_role.created", entityType: "org_role", entityId: role.id },
      tx,
    );
    await audit(
      {
        actor,
        action: "org_member.joined",
        entityType: "org_member",
        entityId: member.id,
        details: { orgId: org.id, admin: true },
      },
      tx,
    );
    return org;
  });
}

/**
 * The /team overview: the person's organisations, the one chosen (by slug,
 * else the first), its roles and people, onboarding in progress, and their
 * own skills to attach. Admins see everyone's onboarding; members their own.
 */
export async function teamOverview(user: TeamUser, slug?: string | null) {
  const memberships = await membershipsOf(user.id);
  const invites = await pendingInvitesFor(user.email);
  const current = memberships.find((m) => m.org.slug === slug) ?? memberships[0] ?? null;
  if (!current) return { memberships, invites, current: null };

  const { org, member: me } = current;
  const admin = canManage(asMembership(me));
  const roles = await db()
    .select()
    .from(orgRoles)
    .where(eq(orgRoles.orgId, org.id))
    .orderBy(asc(orgRoles.title));
  const people = await db()
    .select({ member: orgMembers, name: authUsers.name, email: authUsers.email })
    .from(orgMembers)
    .innerJoin(authUsers, eq(orgMembers.userId, authUsers.id))
    .where(and(eq(orgMembers.orgId, org.id), eq(orgMembers.status, "active")))
    .orderBy(asc(authUsers.name));
  const attached = await db()
    .select({ link: orgRoleSkills, skill: { id: skills.id, name: skills.name, slug: skills.slug } })
    .from(orgRoleSkills)
    .innerJoin(skills, eq(orgRoleSkills.skillId, skills.id))
    .where(eq(orgRoleSkills.orgId, org.id));
  const running = await onboardingsIn(org.id, admin ? null : me.id);

  return {
    memberships,
    invites,
    current: {
      org,
      me,
      myRole: current.role,
      admin,
      roles: roles.map((r) => ({
        ...r,
        people: people.filter((p) => p.member.roleId === r.id).length,
        skills: attached.filter((a) => a.link.roleId === r.id).length,
        visible: canSeeRole(asMembership(me), r.id),
      })),
      people: people.map((p) => ({
        id: p.member.id,
        name: p.name,
        email: p.email,
        admin: p.member.admin,
        role: roles.find((r) => r.id === p.member.roleId)?.title ?? null,
      })),
      onboardings: running,
      mySkills: attached
        .filter((a) => a.link.memberId === me.id)
        .map((a) => ({
          linkId: a.link.id,
          origin: a.link.origin,
          roleId: a.link.roleId,
          ...a.skill,
        })),
      attachable: me.roleId ? await attachableSkills(user.id) : [],
    },
  };
}

/** Onboardings in progress (and recently finished) at an organisation, optionally for one member. */
async function onboardingsIn(orgId: string, memberId: string | null) {
  const rows = await db()
    .select({ onboarding: onboardings, role: orgRoles, name: authUsers.name })
    .from(onboardings)
    .innerJoin(orgRoles, eq(onboardings.roleId, orgRoles.id))
    .innerJoin(orgMembers, eq(onboardings.memberId, orgMembers.id))
    .innerJoin(authUsers, eq(orgMembers.userId, authUsers.id))
    .where(
      and(
        eq(onboardings.orgId, orgId),
        ne(onboardings.status, "cancelled"),
        memberId ? eq(onboardings.memberId, memberId) : undefined,
      ),
    )
    .orderBy(desc(onboardings.createdAt));
  return rows.map((r) => ({
    id: r.onboarding.id,
    status: r.onboarding.status,
    role: r.role.title,
    name: r.name,
    startedAt: r.onboarding.createdAt,
    ...onboardingProgress(r.onboarding.plan, r.onboarding.progress),
  }));
}

/* ---------- Roles ---------- */

export async function createRole(
  user: TeamUser,
  orgId: string,
  input: { title: string; description: string },
) {
  await requireAdmin(orgId, user);
  const title = normalizeText(input.title).slice(0, 80);
  if (title.length < 2) throw new TeamRuleError("Give the role a title");
  const [role] = await db()
    .insert(orgRoles)
    .values({ orgId, title, description: normalizeText(input.description).slice(0, 2000) })
    .onConflictDoNothing()
    .returning();
  if (!role) throw new TeamRuleError(`There's already a role called ${title}`);
  await audit({
    actor: actorOf(user),
    action: "org_role.created",
    entityType: "org_role",
    entityId: role.id,
    details: { orgId },
  });
  return role;
}

export async function updateRole(
  user: TeamUser,
  roleId: string,
  input: { title: string; description: string },
) {
  const role = await loadRole(roleId);
  await requireAdmin(role.orgId, user);
  const title = normalizeText(input.title).slice(0, 80);
  if (title.length < 2) throw new TeamRuleError("Give the role a title");
  const clash = await db().query.orgRoles.findFirst({
    where: and(eq(orgRoles.orgId, role.orgId), eq(orgRoles.title, title), ne(orgRoles.id, roleId)),
  });
  if (clash) throw new TeamRuleError(`There's already a role called ${title}`);
  await db()
    .update(orgRoles)
    .set({ title, description: normalizeText(input.description).slice(0, 2000) })
    .where(eq(orgRoles.id, roleId));
  await audit({
    actor: actorOf(user),
    action: "org_role.updated",
    entityType: "org_role",
    entityId: roleId,
  });
}

/** A role's page: who holds it, its skills (method), its playbook versions and onboardings. */
export async function roleView(user: TeamUser, roleId: string) {
  const role = await loadRole(roleId);
  const { org, me } = await requireMember(role.orgId, user);
  const membership = asMembership(me);
  if (!canSeeRole(membership, roleId)) throw new NotFoundError("No such role");
  const admin = canManage(membership);

  const holders = await db()
    .select({ member: orgMembers, name: authUsers.name })
    .from(orgMembers)
    .innerJoin(authUsers, eq(orgMembers.userId, authUsers.id))
    .where(eq(orgMembers.roleId, roleId))
    .orderBy(asc(authUsers.name));
  const attached = await roleSkills(roleId);
  const versions = await db()
    .select()
    .from(rolePlaybooks)
    .where(eq(rolePlaybooks.roleId, roleId))
    .orderBy(desc(rolePlaybooks.version));
  const published = versions.find((v) => v.status === "published") ?? null;
  // Admins work on the newest version; members read the published one.
  const playbook = admin ? (versions[0] ?? null) : published;
  const members = admin
    ? await db()
        .select({ id: orgMembers.id, name: authUsers.name, roleId: orgMembers.roleId })
        .from(orgMembers)
        .innerJoin(authUsers, eq(orgMembers.userId, authUsers.id))
        .where(and(eq(orgMembers.orgId, org.id), eq(orgMembers.status, "active")))
        .orderBy(asc(authUsers.name))
    : [];
  const running = admin
    ? (await onboardingsIn(org.id, null)).filter((o) => o.role === role.title)
    : [];

  return {
    org,
    role,
    me,
    admin,
    holders: holders.map((h) => ({
      id: h.member.id,
      name: h.name,
      status: h.member.status,
      admin: h.member.admin,
    })),
    skills: attached.map((a) => ({
      ...a,
      canDetach: canDetachSkill(membership, {
        userId: user.id,
        skillOwnerId: a.ownerId,
        origin: a.origin,
      }).ok,
    })),
    playbook,
    published,
    versions: versions.map((v) => ({
      id: v.id,
      version: v.version,
      status: v.status,
      createdAt: v.createdAt,
      publishedAt: v.publishedAt,
    })),
    members,
    onboardings: running,
    attachable: me.roleId === roleId || admin ? await attachableSkills(user.id) : [],
  };
}

/** Skills attached to a role, with their method (rule sheet) and who attached them. */
async function roleSkills(roleId: string) {
  const rows = await db()
    .select({
      link: orgRoleSkills,
      skill: skills,
      holder: authUsers.name,
    })
    .from(orgRoleSkills)
    .innerJoin(skills, eq(orgRoleSkills.skillId, skills.id))
    .leftJoin(orgMembers, eq(orgRoleSkills.memberId, orgMembers.id))
    .leftJoin(authUsers, eq(orgMembers.userId, authUsers.id))
    .where(eq(orgRoleSkills.roleId, roleId))
    .orderBy(asc(skills.name));
  return Promise.all(
    rows.map(async ({ link, skill, holder }) => {
      const versionId = skill.publishedVersionId ?? skill.currentVersionId;
      const version = versionId ? await getVersion(versionId).catch(() => null) : null;
      return {
        id: link.id,
        skillId: skill.id,
        slug: skill.slug,
        name: skill.name,
        task: skill.taskDescription,
        ownerId: skill.ownerId,
        holder: holder ?? "A former member",
        origin: link.origin,
        sheet: version?.sheet ?? null,
      };
    }),
  );
}

/* ---------- Members ---------- */

export async function membersView(user: TeamUser, orgId: string) {
  const { org, me } = await requireMember(orgId, user);
  const admin = canManage(asMembership(me));
  const roles = await db()
    .select()
    .from(orgRoles)
    .where(eq(orgRoles.orgId, orgId))
    .orderBy(asc(orgRoles.title));
  const people = await db()
    .select({ member: orgMembers, name: authUsers.name, email: authUsers.email })
    .from(orgMembers)
    .innerJoin(authUsers, eq(orgMembers.userId, authUsers.id))
    .where(eq(orgMembers.orgId, orgId))
    .orderBy(asc(orgMembers.status), asc(authUsers.name));
  const now = new Date();
  const invites = admin
    ? (
        await db()
          .select({ invite: orgInvites, role: orgRoles.title })
          .from(orgInvites)
          .leftJoin(orgRoles, eq(orgInvites.roleId, orgRoles.id))
          .where(eq(orgInvites.orgId, orgId))
          .orderBy(desc(orgInvites.createdAt))
          .limit(50)
      ).map((r) => ({
        id: r.invite.id,
        email: r.invite.email,
        role: r.role,
        admin: r.invite.admin,
        onboard: r.invite.onboard,
        state: inviteState(r.invite, now),
        expiresAt: r.invite.expiresAt,
      }))
    : [];
  return {
    org,
    me,
    admin,
    roles,
    people: people
      // Members see who's here now; admins also see who has left.
      .filter((p) => admin || p.member.status === "active")
      .map((p) => ({
        id: p.member.id,
        userId: p.member.userId,
        name: p.name,
        email: p.email,
        admin: p.member.admin,
        status: p.member.status,
        roleId: p.member.roleId,
        role: roles.find((r) => r.id === p.member.roleId)?.title ?? null,
        joinedAt: p.member.joinedAt,
      })),
    invites,
  };
}

async function loadMember(memberId: string) {
  const member = await db().query.orgMembers.findFirst({ where: eq(orgMembers.id, memberId) });
  if (!member) throw new NotFoundError("No such member");
  return member;
}

export async function setMemberRole(user: TeamUser, memberId: string, roleId: string | null) {
  const member = await loadMember(memberId);
  await requireAdmin(member.orgId, user);
  if (roleId && (await loadRole(roleId)).orgId !== member.orgId) {
    throw new NotFoundError("No such role");
  }
  await db().update(orgMembers).set({ roleId }).where(eq(orgMembers.id, memberId));
  await audit({
    actor: actorOf(user),
    action: "org_member.role_changed",
    entityType: "org_member",
    entityId: memberId,
    details: { from: member.roleId, to: roleId },
  });
}

export async function setMemberAdmin(user: TeamUser, memberId: string, admin: boolean) {
  const member = await loadMember(memberId);
  await requireAdmin(member.orgId, user);
  if (member.status !== "active") throw new TeamRuleError("They've left the organisation");
  if (!admin) {
    const allowed = keepsAnAdmin({
      activeAdmins: (await activeAdmins(member.orgId)).length,
      targetIsAdmin: member.admin,
      change: "demote",
    });
    if (!allowed.ok) throw new TeamRuleError(allowed.reason);
  }
  await db().update(orgMembers).set({ admin }).where(eq(orgMembers.id, memberId));
  await audit({
    actor: actorOf(user),
    action: admin ? "org_member.made_admin" : "org_member.admin_removed",
    entityType: "org_member",
    entityId: memberId,
  });
}

/**
 * An admin removes someone, or someone leaves. The row stays (as "left") so
 * their attached skills still inform the role's playbook and stay confidential.
 */
export async function removeMember(user: TeamUser, memberId: string) {
  const member = await loadMember(memberId);
  const self = member.userId === user.id;
  if (self) await requireMember(member.orgId, user);
  else await requireAdmin(member.orgId, user);
  if (member.status !== "active") throw new TeamRuleError("They've already left");
  const allowed = keepsAnAdmin({
    activeAdmins: (await activeAdmins(member.orgId)).length,
    targetIsAdmin: member.admin,
    change: "remove",
  });
  if (!allowed.ok) throw new TeamRuleError(allowed.reason);
  await db().transaction(async (tx) => {
    await tx
      .update(orgMembers)
      .set({ status: "left", admin: false, leftAt: new Date() })
      .where(eq(orgMembers.id, memberId));
    await tx
      .update(onboardings)
      .set({ status: "cancelled", updatedAt: new Date() })
      .where(and(eq(onboardings.memberId, memberId), eq(onboardings.status, "active")));
    await audit(
      {
        actor: actorOf(user),
        action: self ? "org_member.left" : "org_member.removed",
        entityType: "org_member",
        entityId: memberId,
        details: { orgId: member.orgId },
      },
      tx,
    );
  });
}

/* ---------- Invitations ---------- */

/**
 * An admin invites someone by email to a role. The link (shown once) is
 * /team/join/<token>; only its hash is kept. Inviting the same email again
 * replaces the earlier invitation.
 */
export async function createInvite(
  user: TeamUser,
  orgId: string,
  input: { email: string; roleId: string | null; admin: boolean; onboard: boolean },
) {
  await requireAdmin(orgId, user);
  const email = normaliseEmail(input.email);
  if (!isEmail(email)) throw new TeamRuleError("Enter a valid email address");
  if (input.roleId && (await loadRole(input.roleId)).orgId !== orgId) {
    throw new NotFoundError("No such role");
  }
  if (input.onboard && !input.roleId) {
    throw new TeamRuleError("Choose the role they're joining to onboard them");
  }
  const [already] = await db()
    .select({ id: orgMembers.id })
    .from(orgMembers)
    .innerJoin(authUsers, eq(orgMembers.userId, authUsers.id))
    .where(
      and(eq(orgMembers.orgId, orgId), eq(orgMembers.status, "active"), eq(authUsers.email, email)),
    );
  if (already) throw new TeamRuleError("They're already a member");

  const token = newInviteToken();
  const now = new Date();
  const invite = await db().transaction(async (tx) => {
    await tx
      .update(orgInvites)
      .set({ revokedAt: now })
      .where(
        and(
          eq(orgInvites.orgId, orgId),
          eq(orgInvites.email, email),
          isNull(orgInvites.acceptedAt),
          isNull(orgInvites.revokedAt),
        ),
      );
    const [row] = await tx
      .insert(orgInvites)
      .values({
        orgId,
        email,
        roleId: input.roleId,
        admin: input.admin,
        onboard: input.onboard,
        tokenHash: hashToken(token),
        invitedBy: user.id,
        expiresAt: inviteExpiry(now),
      })
      .returning();
    await audit(
      {
        actor: actorOf(user),
        action: "org_invite.created",
        entityType: "org_invite",
        entityId: row.id,
        details: { orgId, roleId: input.roleId, admin: input.admin, onboard: input.onboard },
      },
      tx,
    );
    return row;
  });
  return { invite, path: `/team/join/${token}` };
}

export async function revokeInvite(user: TeamUser, inviteId: string) {
  const invite = await db().query.orgInvites.findFirst({ where: eq(orgInvites.id, inviteId) });
  if (!invite) throw new NotFoundError("No such invitation");
  await requireAdmin(invite.orgId, user);
  if (inviteState(invite, new Date()) !== "pending") {
    throw new TeamRuleError("This invitation is no longer pending");
  }
  await db().update(orgInvites).set({ revokedAt: new Date() }).where(eq(orgInvites.id, inviteId));
  await audit({
    actor: actorOf(user),
    action: "org_invite.revoked",
    entityType: "org_invite",
    entityId: inviteId,
  });
}

/** Pending invitations to this email (shown on /team so they can accept there too). */
export async function pendingInvitesFor(email: string) {
  const rows = await db()
    .select({ invite: orgInvites, org: organisations.name, role: orgRoles.title })
    .from(orgInvites)
    .innerJoin(organisations, eq(orgInvites.orgId, organisations.id))
    .leftJoin(orgRoles, eq(orgInvites.roleId, orgRoles.id))
    .where(and(eq(orgInvites.email, normaliseEmail(email)), isNull(orgInvites.acceptedAt)))
    .orderBy(desc(orgInvites.createdAt));
  const now = new Date();
  return rows
    .filter((r) => inviteState(r.invite, now) === "pending")
    .map((r) => ({ id: r.invite.id, org: r.org, role: r.role, expiresAt: r.invite.expiresAt }));
}

async function inviteFromToken(token: string) {
  if (!looksLikeToken(token)) throw new NotFoundError("This invitation link isn't valid");
  const invite = await db().query.orgInvites.findFirst({
    where: eq(orgInvites.tokenHash, hashToken(token)),
  });
  if (!invite) throw new NotFoundError("This invitation link isn't valid");
  return invite;
}

/** What the join page shows the signed-in person about an invitation link. */
export async function inviteForJoinPage(token: string, user: TeamUser) {
  const invite = await inviteFromToken(token);
  const org = await loadOrg(invite.orgId);
  const role = invite.roleId ? await loadRole(invite.roleId).catch(() => null) : null;
  const allowed = canAcceptInvite(invite, user.email, new Date());
  return {
    org: org.name,
    role: role?.title ?? null,
    onboard: invite.onboard,
    // The address is only confirmed to the person it was sent to.
    allowed,
  };
}

export async function acceptInviteByToken(client: ModelClient, user: TeamUser, token: string) {
  return accept(client, user, await inviteFromToken(token));
}

export async function acceptInviteById(client: ModelClient, user: TeamUser, inviteId: string) {
  const invite = await db().query.orgInvites.findFirst({ where: eq(orgInvites.id, inviteId) });
  if (!invite || normaliseEmail(invite.email) !== normaliseEmail(user.email)) {
    throw new NotFoundError("No such invitation");
  }
  return accept(client, user, invite);
}

/**
 * Joins the organisation in the invited role. When the invitation was for a
 * new hire, their onboarding starts at once if the role's playbook is published.
 */
async function accept(
  client: ModelClient,
  user: TeamUser,
  invite: typeof orgInvites.$inferSelect,
): Promise<{ orgSlug: string; onboardingId: string | null; note: string | null }> {
  const allowed = canAcceptInvite(invite, user.email, new Date());
  if (!allowed.ok) throw new TeamRuleError(allowed.reason);
  const org = await loadOrg(invite.orgId);
  const member = await db().transaction(async (tx) => {
    const [used] = await tx
      .update(orgInvites)
      .set({ acceptedAt: new Date(), acceptedBy: user.id })
      .where(and(eq(orgInvites.id, invite.id), isNull(orgInvites.acceptedAt)))
      .returning();
    if (!used) throw new TeamRuleError("This invitation has already been used");
    const [row] = await tx
      .insert(orgMembers)
      .values({ orgId: org.id, userId: user.id, roleId: invite.roleId, admin: invite.admin })
      .onConflictDoUpdate({
        target: [orgMembers.orgId, orgMembers.userId],
        // Someone who left and comes back rejoins in the invited role.
        set: {
          roleId: invite.roleId,
          admin: invite.admin,
          status: "active",
          joinedAt: new Date(),
          leftAt: null,
        },
      })
      .returning();
    await audit(
      {
        actor: actorOf(user),
        action: "org_invite.accepted",
        entityType: "org_invite",
        entityId: invite.id,
      },
      tx,
    );
    await audit(
      {
        actor: actorOf(user),
        action: "org_member.joined",
        entityType: "org_member",
        entityId: row.id,
        details: { orgId: org.id, roleId: invite.roleId, admin: invite.admin },
      },
      tx,
    );
    return row;
  });

  if (!invite.onboard || !invite.roleId)
    return { orgSlug: org.slug, onboardingId: null, note: null };
  const published = await publishedPlaybook(invite.roleId);
  if (!published) {
    return {
      orgSlug: org.slug,
      onboardingId: null,
      note: "Your onboarding will start once the role's playbook is ready.",
    };
  }
  try {
    const onboarding = await createOnboarding(client, {
      org,
      memberId: member.id,
      role: await loadRole(invite.roleId),
      playbook: published,
      startedBy: invite.invitedBy,
      actor: "system",
    });
    return { orgSlug: org.slug, onboardingId: onboarding.id, note: null };
  } catch (error) {
    // They've joined either way; an admin can start the onboarding from the role's page.
    console.error("Onboarding didn't start on joining", error);
    return {
      orgSlug: org.slug,
      onboardingId: null,
      note: "You've joined. Your onboarding couldn't be prepared just now; an admin can start it.",
    };
  }
}

/* ---------- Confidential skills ---------- */

/** The person's skills that aren't part of any company role yet. */
export async function attachableSkills(userId: string) {
  const rows = await db()
    .select({ id: skills.id, slug: skills.slug, name: skills.name, linked: orgRoleSkills.id })
    .from(skills)
    .leftJoin(orgRoleSkills, eq(orgRoleSkills.skillId, skills.id))
    .where(eq(skills.ownerId, userId))
    .orderBy(asc(skills.name));
  return rows.filter((r) => !r.linked).map(({ id, slug, name }) => ({ id, slug, name }));
}

/**
 * "This skill is part of my job here." It becomes confidential at once: a
 * live listing is taken down, and it can't be listed again while attached.
 */
export async function attachSkill(user: TeamUser, roleId: string, skillSlug: string) {
  const role = await loadRole(roleId);
  const { me } = await requireMember(role.orgId, user);
  const skill = await db().query.skills.findFirst({ where: eq(skills.slug, skillSlug) });
  if (!skill) throw new NotFoundError("No such skill");
  const allowed = canAttachSkill(asMembership(me), {
    userId: user.id,
    skillOwnerId: skill.ownerId,
    roleId,
  });
  if (!allowed.ok) throw new TeamRuleError(allowed.reason);
  return linkSkill({ role, skillId: skill.id, memberId: me.id, origin: "member", user });
}

async function linkSkill(input: {
  role: OrgRole;
  skillId: string;
  memberId: string;
  origin: "member" | "playbook";
  user: TeamUser;
}) {
  return db().transaction(async (t) => {
    const [link] = await t
      .insert(orgRoleSkills)
      .values({
        orgId: input.role.orgId,
        roleId: input.role.id,
        skillId: input.skillId,
        memberId: input.memberId,
        origin: input.origin,
      })
      .onConflictDoNothing({ target: orgRoleSkills.skillId })
      .returning();
    if (!link) throw new TeamRuleError("This skill is already part of a company role");
    await audit(
      {
        actor: actorOf(input.user),
        action: "org_skill.attached",
        entityType: "org_skill",
        entityId: link.id,
        skillId: input.skillId,
        details: { orgId: input.role.orgId, roleId: input.role.id, origin: input.origin },
      },
      t,
    );
    const [taken] = await t
      .update(listings)
      .set({
        active: false,
        pausedAt: new Date(),
        pausedReason: "Part of a company role: company know-how stays confidential",
        updatedAt: new Date(),
      })
      .where(and(eq(listings.skillId, input.skillId), eq(listings.active, true)))
      .returning();
    if (taken) {
      await audit(
        {
          actor: "system",
          action: "listing.deactivated",
          entityType: "listing",
          entityId: taken.id,
          skillId: input.skillId,
          details: { reason: "confidential", orgId: input.role.orgId },
        },
        t,
      );
    }
    return link;
  });
}

export async function detachSkill(user: TeamUser, linkId: string) {
  const link = await db().query.orgRoleSkills.findFirst({ where: eq(orgRoleSkills.id, linkId) });
  if (!link) throw new NotFoundError("No such skill");
  const me = await memberRow(link.orgId, user.id);
  const skill = await db().query.skills.findFirst({ where: eq(skills.id, link.skillId) });
  const allowed = canDetachSkill(asMembership(me), {
    userId: user.id,
    skillOwnerId: skill?.ownerId ?? null,
    origin: link.origin,
  });
  if (!allowed.ok) throw new TeamRuleError(allowed.reason);
  await db().transaction(async (t) => {
    await t.delete(orgRoleSkills).where(eq(orgRoleSkills.id, linkId));
    await audit(
      {
        actor: actorOf(user),
        action: "org_skill.detached",
        entityType: "org_skill",
        entityId: linkId,
        skillId: link.skillId,
        details: { orgId: link.orgId, roleId: link.roleId },
      },
      t,
    );
  });
  return link;
}

/* ---------- Handbook ---------- */

export async function handbookView(user: TeamUser, orgId: string) {
  const { org, me } = await requireMember(orgId, user);
  return { org, admin: canManage(asMembership(me)), notes: await handbookNotes(orgId) };
}

async function handbookNotes(orgId: string) {
  return db()
    .select()
    .from(orgHandbookNotes)
    .where(eq(orgHandbookNotes.orgId, orgId))
    .orderBy(asc(orgHandbookNotes.position), asc(orgHandbookNotes.createdAt));
}

export async function saveHandbookNote(
  user: TeamUser,
  orgId: string,
  input: { id?: string | null; kind: HandbookKind; title: string; body: string },
) {
  await requireAdmin(orgId, user);
  const title = normalizeText(input.title).slice(0, 120);
  const body = normalizeText(input.body).slice(0, 10_000);
  if (!title || !body) throw new TeamRuleError("Give the note a title and some text");
  const values = { kind: input.kind, title, body, updatedBy: user.id, updatedAt: new Date() };
  let id = input.id ?? null;
  if (id) {
    const [row] = await db()
      .update(orgHandbookNotes)
      .set(values)
      .where(and(eq(orgHandbookNotes.id, id), eq(orgHandbookNotes.orgId, orgId)))
      .returning();
    if (!row) throw new NotFoundError("No such note");
  } else {
    const count = (await handbookNotes(orgId)).length;
    if (count >= 50) throw new TeamRuleError("The handbook holds up to 50 notes");
    const [row] = await db()
      .insert(orgHandbookNotes)
      .values({ ...values, orgId, position: count })
      .returning();
    id = row.id;
  }
  // The handbook is confidential: the log records which note, never what it says.
  await audit({
    actor: actorOf(user),
    action: input.id ? "handbook.updated" : "handbook.added",
    entityType: "handbook_note",
    entityId: id,
    details: { orgId, kind: input.kind },
  });
}

export async function deleteHandbookNote(user: TeamUser, noteId: string) {
  const note = await db().query.orgHandbookNotes.findFirst({
    where: eq(orgHandbookNotes.id, noteId),
  });
  if (!note) throw new NotFoundError("No such note");
  await requireAdmin(note.orgId, user);
  await db().delete(orgHandbookNotes).where(eq(orgHandbookNotes.id, noteId));
  await audit({
    actor: actorOf(user),
    action: "handbook.removed",
    entityType: "handbook_note",
    entityId: noteId,
    details: { orgId: note.orgId },
  });
}

/* ---------- Playbooks ---------- */

/** The newest published playbook of a role, or null. */
export async function publishedPlaybook(roleId: string) {
  const [row] = await db()
    .select()
    .from(rolePlaybooks)
    .where(and(eq(rolePlaybooks.roleId, roleId), eq(rolePlaybooks.status, "published")))
    .orderBy(desc(rolePlaybooks.version))
    .limit(1);
  return row ?? null;
}

async function nextPlaybookVersion(roleId: string) {
  const [latest] = await db()
    .select({ version: rolePlaybooks.version })
    .from(rolePlaybooks)
    .where(eq(rolePlaybooks.roleId, roleId))
    .orderBy(desc(rolePlaybooks.version))
    .limit(1);
  return (latest?.version ?? 0) + 1;
}

/**
 * Persuna writes a new draft of the role's playbook from the rule sheets of
 * every skill attached to it (by current and former holders) and the handbook.
 */
export async function generatePlaybook(client: ModelClient, user: TeamUser, roleId: string) {
  const role = await loadRole(roleId);
  const { org } = await requireAdmin(role.orgId, user);
  const attached = (await roleSkills(roleId)).filter((s) => s.sheet);
  const notes = await handbookNotes(org.id);
  if (!attached.length && !notes.length) {
    throw new TeamRuleError(
      "Attach at least one trained skill to this role, or write the handbook, first",
    );
  }
  const { playbook, model } = await buildPlaybook(client, {
    org: org.name,
    role: role.title,
    description: role.description,
    handbook: renderHandbook(notes),
    // Method only: the rule sheets, never examples or job text.
    skills: attached.map((s) => ({ name: s.name, task: s.task, sheet: renderSheet(s.sheet!) })),
  });
  const [row] = await db()
    .insert(rolePlaybooks)
    .values({
      roleId,
      version: await nextPlaybookVersion(roleId),
      content: playbook,
      sourceSkillIds: attached.map((s) => s.skillId),
      model,
      createdBy: user.id,
    })
    .returning();
  await audit({
    actor: actorOf(user),
    action: "playbook.generated",
    entityType: "playbook",
    entityId: row.id,
    details: { roleId, version: row.version, skills: attached.length, model },
  });
  return row;
}

async function loadPlaybook(playbookId: string) {
  const row = await db().query.rolePlaybooks.findFirst({
    where: eq(rolePlaybooks.id, playbookId),
  });
  if (!row) throw new NotFoundError("No such playbook");
  return row;
}

/**
 * An admin's edits. A draft changes in place; editing a published version
 * makes a new draft, so recruits keep the published one until it's replaced.
 */
export async function editPlaybook(user: TeamUser, playbookId: string, content: Playbook) {
  const current = await loadPlaybook(playbookId);
  const role = await loadRole(current.roleId);
  await requireAdmin(role.orgId, user);
  const parsed = playbookSchema.parse(content);
  const problem = playbookProblem(parsed);
  if (problem) throw new TeamRuleError(problem);
  let row;
  if (current.status === "draft") {
    [row] = await db()
      .update(rolePlaybooks)
      .set({ content: parsed, updatedAt: new Date() })
      .where(eq(rolePlaybooks.id, playbookId))
      .returning();
  } else {
    [row] = await db()
      .insert(rolePlaybooks)
      .values({
        roleId: role.id,
        version: await nextPlaybookVersion(role.id),
        content: parsed,
        sourceSkillIds: current.sourceSkillIds,
        model: "edit",
        createdBy: user.id,
      })
      .returning();
  }
  await audit({
    actor: actorOf(user),
    action: "playbook.edited",
    entityType: "playbook",
    entityId: row.id,
    details: { roleId: role.id, version: row.version, from: current.version },
  });
  return row;
}

export async function publishPlaybook(user: TeamUser, playbookId: string) {
  const current = await loadPlaybook(playbookId);
  const role = await loadRole(current.roleId);
  await requireAdmin(role.orgId, user);
  if (current.status === "published") throw new TeamRuleError("This version is already published");
  const problem = playbookProblem(current.content);
  if (problem) throw new TeamRuleError(problem);
  await db()
    .update(rolePlaybooks)
    .set({ status: "published", publishedAt: new Date(), updatedAt: new Date() })
    .where(eq(rolePlaybooks.id, playbookId));
  await audit({
    actor: actorOf(user),
    action: "playbook.published",
    entityType: "playbook",
    entityId: playbookId,
    details: { roleId: role.id, version: current.version },
  });
}

/* ---------- Onboarding ---------- */

/** An admin starts onboarding a member (a new hire) into a role. */
export async function startOnboarding(
  client: ModelClient,
  user: TeamUser,
  input: { memberId: string; roleId: string },
) {
  const role = await loadRole(input.roleId);
  const { org } = await requireAdmin(role.orgId, user);
  const member = await loadMember(input.memberId);
  if (member.orgId !== org.id || member.status !== "active") {
    throw new NotFoundError("No such member");
  }
  const playbook = await publishedPlaybook(role.id);
  if (!playbook) throw new TeamRuleError("Publish the role's playbook first");
  return createOnboarding(client, {
    org,
    memberId: member.id,
    role,
    playbook,
    startedBy: user.id,
    actor: actorOf(user),
  });
}

async function createOnboarding(
  client: ModelClient,
  input: {
    org: Organisation;
    memberId: string;
    role: OrgRole;
    playbook: typeof rolePlaybooks.$inferSelect;
    startedBy: string | null;
    actor: Actor;
  },
) {
  const running = await db().query.onboardings.findFirst({
    where: and(eq(onboardings.memberId, input.memberId), eq(onboardings.status, "active")),
  });
  if (running) throw new TeamRuleError("They already have an onboarding in progress");
  const plan = await buildOnboardingPlan(client, {
    org: input.org.name,
    role: input.role.title,
    playbook: input.playbook.content,
    handbook: renderHandbook(await handbookNotes(input.org.id)),
  });
  return db().transaction(async (t) => {
    // Onboarding into a role means holding it.
    await t
      .update(orgMembers)
      .set({ roleId: input.role.id })
      .where(eq(orgMembers.id, input.memberId));
    const [row] = await t
      .insert(onboardings)
      .values({
        orgId: input.org.id,
        memberId: input.memberId,
        roleId: input.role.id,
        playbookId: input.playbook.id,
        plan,
        startedBy: input.startedBy,
      })
      .returning();
    await audit(
      {
        actor: input.actor,
        action: "onboarding.started",
        entityType: "onboarding",
        entityId: row.id,
        details: {
          orgId: input.org.id,
          roleId: input.role.id,
          memberId: input.memberId,
          playbookVersion: input.playbook.version,
          modules: plan.modules.length,
        },
      },
      t,
    );
    return row;
  });
}

async function loadOnboarding(onboardingId: string) {
  const row = await db().query.onboardings.findFirst({ where: eq(onboardings.id, onboardingId) });
  if (!row) throw new NotFoundError("No such onboarding");
  return row;
}

/** An onboarding with what it's built from, for the recruit or an admin. */
export async function onboardingView(user: TeamUser, onboardingId: string) {
  const onboarding = await loadOnboarding(onboardingId);
  const me = await memberRow(onboarding.orgId, user.id);
  const membership = asMembership(me);
  if (!canSeeOnboarding(membership, onboarding.memberId)) {
    throw new NotFoundError("No such onboarding");
  }
  const org = await loadOrg(onboarding.orgId);
  const role = await loadRole(onboarding.roleId);
  const recruit = await db()
    .select({ name: authUsers.name })
    .from(orgMembers)
    .innerJoin(authUsers, eq(orgMembers.userId, authUsers.id))
    .where(eq(orgMembers.id, onboarding.memberId));
  return {
    onboarding,
    org,
    role,
    recruit: recruit[0]?.name ?? "The recruit",
    canWork: canWorkOnboarding(membership, onboarding.memberId) && onboarding.status === "active",
    isRecruit: canWorkOnboarding(membership, onboarding.memberId),
    admin: canManage(membership),
    progress: onboardingProgress(onboarding.plan, onboarding.progress),
  };
}

async function workable(user: TeamUser, onboardingId: string) {
  const view = await onboardingView(user, onboardingId);
  if (!view.canWork) {
    throw new TeamRuleError(
      view.onboarding.status === "active"
        ? "Only the person being onboarded can do this"
        : "This onboarding is finished",
    );
  }
  return view;
}

function moduleOf(onboarding: Onboarding, moduleId: string) {
  const unit = onboarding.plan.modules.find((m) => m.id === moduleId);
  if (!unit) throw new NotFoundError("No such module");
  return unit;
}

/** What Persuna may draw on for an onboarding: the playbook it was built from and the handbook. */
async function materialFor(onboarding: Onboarding) {
  const playbook = onboarding.playbookId
    ? await db().query.rolePlaybooks.findFirst({
        where: eq(rolePlaybooks.id, onboarding.playbookId),
      })
    : await publishedPlaybook(onboarding.roleId);
  if (!playbook) throw new TeamRuleError("The role's playbook is no longer available");
  const notes = await handbookNotes(onboarding.orgId);
  return { playbook: playbook.content, handbook: renderHandbook(notes) };
}

/** Changes one module's progress under a row lock, so two tabs can't overwrite each other. */
async function updateModule(
  onboardingId: string,
  moduleId: string,
  change: (current: ModuleProgress | undefined) => ModuleProgress,
  finish: (progress: OnboardingProgress) => boolean = () => false,
) {
  return db().transaction(async (t) => {
    const [row] = await t
      .select()
      .from(onboardings)
      .where(eq(onboardings.id, onboardingId))
      .for("update");
    if (!row || row.status !== "active") throw new TeamRuleError("This onboarding is finished");
    const progress = { ...row.progress, [moduleId]: change(row.progress[moduleId]) };
    const done = finish(progress);
    const [updated] = await t
      .update(onboardings)
      .set({
        progress,
        updatedAt: new Date(),
        ...(done ? { status: "completed" as const, completedAt: new Date() } : {}),
      })
      .where(eq(onboardings.id, onboardingId))
      .returning();
    return { row: updated, completed: done };
  });
}

/** The recruit hands in a practice task; Persuna marks it against the rubric with feedback. */
export async function submitPractice(
  client: ModelClient,
  user: TeamUser,
  onboardingId: string,
  moduleId: string,
  answer: string,
) {
  const { onboarding } = await workable(user, onboardingId);
  const unit = moduleOf(onboarding, moduleId);
  const text = normalizeText(answer).slice(0, 8000);
  if (text.length < 10) throw new TeamRuleError("Write your answer first");
  const material = await materialFor(onboarding);
  const grade = await gradeAnswers(client, {
    module: unit.title,
    material: moduleMaterial(unit, material.playbook, material.handbook),
    items: [{ prompt: unit.practice.task, rubric: unit.practice.rubric, answer: text }],
    now: new Date(),
  });
  await updateModule(onboardingId, moduleId, (p) => ({
    ...p,
    practice: { answer: text, grade },
  }));
  await audit({
    actor: actorOf(user),
    action: "onboarding.practice_marked",
    entityType: "onboarding",
    entityId: onboardingId,
    details: { module: moduleId, score: grade.score, passed: grade.passed },
  });
  return grade;
}

/** The recruit answers the module's check; Persuna marks each answer against its rubric. */
export async function submitCheck(
  client: ModelClient,
  user: TeamUser,
  onboardingId: string,
  moduleId: string,
  answers: string[],
) {
  const { onboarding } = await workable(user, onboardingId);
  const unit = moduleOf(onboarding, moduleId);
  const texts = unit.check.map((_, i) => normalizeText(answers[i] ?? "").slice(0, 4000));
  if (texts.every((t) => !t)) throw new TeamRuleError("Answer the questions first");
  const material = await materialFor(onboarding);
  const grade = await gradeAnswers(client, {
    module: unit.title,
    material: moduleMaterial(unit, material.playbook, material.handbook),
    items: unit.check.map((q, i) => ({ prompt: q.question, rubric: q.rubric, answer: texts[i] })),
    now: new Date(),
  });
  await updateModule(onboardingId, moduleId, (p) => ({ ...p, check: { answers: texts, grade } }));
  await audit({
    actor: actorOf(user),
    action: "onboarding.check_marked",
    entityType: "onboarding",
    entityId: onboardingId,
    details: { module: moduleId, score: grade.score, passed: grade.passed },
  });
  return grade;
}

/** The recruit marks a module done (practice handed in, check passed). The last one finishes it. */
export async function completeModule(user: TeamUser, onboardingId: string, moduleId: string) {
  const { onboarding } = await workable(user, onboardingId);
  moduleOf(onboarding, moduleId);
  const allowed = canCompleteModule(onboarding.progress[moduleId]);
  if (!allowed.ok) throw new TeamRuleError(allowed.reason);
  const { completed } = await updateModule(
    onboardingId,
    moduleId,
    (p) => ({ ...p, doneAt: new Date().toISOString() }),
    (progress) => onboardingProgress(onboarding.plan, progress).finished,
  );
  await audit({
    actor: actorOf(user),
    action: "onboarding.module_done",
    entityType: "onboarding",
    entityId: onboardingId,
    details: { module: moduleId },
  });
  if (completed) {
    await audit({
      actor: actorOf(user),
      action: "onboarding.completed",
      entityType: "onboarding",
      entityId: onboardingId,
      details: { orgId: onboarding.orgId, roleId: onboarding.roleId },
    });
  }
  return { completed };
}

/** The recruit's question, answered only from the playbook and the handbook. Nothing is stored. */
export async function askOnboarding(
  client: ModelClient,
  user: TeamUser,
  onboardingId: string,
  question: string,
) {
  const { onboarding, org, role } = await onboardingView(user, onboardingId);
  const text = normalizeText(question).slice(0, 1000);
  if (text.length < 3) throw new TeamRuleError("Ask a question");
  const material = await materialFor(onboarding);
  return answerQuestion(client, {
    org: org.name,
    role: role.title,
    material: [renderPlaybook(material.playbook), material.handbook].filter(Boolean).join("\n\n"),
    question: text,
  });
}

export async function cancelOnboarding(user: TeamUser, onboardingId: string) {
  const onboarding = await loadOnboarding(onboardingId);
  await requireAdmin(onboarding.orgId, user);
  if (onboarding.status !== "active") throw new TeamRuleError("This onboarding is finished");
  await db()
    .update(onboardings)
    .set({ status: "cancelled", updatedAt: new Date() })
    .where(eq(onboardings.id, onboardingId));
  await audit({
    actor: actorOf(user),
    action: "onboarding.cancelled",
    entityType: "onboarding",
    entityId: onboardingId,
  });
}

/**
 * When a recruit finishes, Persuna offers them starter skills: one per
 * workflow in the playbook, with its steps, standards and mistakes as rules.
 * Method only. They're attached to the role, so they stay confidential.
 */
export async function createStarterSkills(user: TeamUser, onboardingId: string) {
  const { onboarding, org, role, isRecruit } = await onboardingView(user, onboardingId);
  if (!isRecruit) throw new TeamRuleError("Only the person onboarded can take these");
  if (onboarding.status !== "completed") throw new TeamRuleError("Finish the onboarding first");
  // Claim first, so a double click can't make two sets.
  const [claimed] = await db()
    .update(onboardings)
    .set({ starterSkillsAt: new Date() })
    .where(and(eq(onboardings.id, onboardingId), isNull(onboardings.starterSkillsAt)))
    .returning();
  if (!claimed) throw new TeamRuleError("You've already taken the starter skills");
  const { playbook } = await materialFor(onboarding);
  const actor = actorOf(user);
  const made: { slug: string; name: string }[] = [];
  for (const workflow of playbook.workflows) {
    const skill = await createSkill(
      {
        slug: slugify(`${org.slug} ${workflow.title}`) || "team-skill",
        name: `${workflow.title} (${org.name})`.slice(0, 120),
        taskDescription:
          `${workflow.title} at ${org.name}, the team's way.${workflow.when ? ` ${workflow.when}` : ""}`.slice(
            0,
            1000,
          ),
        inputType: "The work as it comes in",
        outputType: "The finished work",
      },
      user.id,
      actor,
    );
    await createVersion(
      skill.id,
      starterSheet(workflow, playbook),
      "extract",
      "playbook",
      null,
      actor,
    );
    await linkSkill({
      role,
      skillId: skill.id,
      memberId: onboarding.memberId,
      origin: "playbook",
      user,
    });
    made.push({ slug: skill.slug, name: skill.name });
  }
  await audit({
    actor,
    action: "onboarding.starter_skills",
    entityType: "onboarding",
    entityId: onboardingId,
    details: { skills: made.length },
  });
  return made;
}

/** The note Persuna's chat gets when this person is onboarding somewhere, or null. */
export async function activeOnboardingNote(userId: string) {
  const [row] = await db()
    .select({ onboarding: onboardings, org: organisations.name, role: orgRoles.title })
    .from(onboardings)
    .innerJoin(orgMembers, eq(onboardings.memberId, orgMembers.id))
    .innerJoin(organisations, eq(onboardings.orgId, organisations.id))
    .innerJoin(orgRoles, eq(onboardings.roleId, orgRoles.id))
    .where(
      and(
        eq(orgMembers.userId, userId),
        eq(orgMembers.status, "active"),
        eq(onboardings.status, "active"),
      ),
    )
    .orderBy(desc(onboardings.createdAt))
    .limit(1);
  if (!row) return null;
  return onboardingNote({
    org: row.org,
    role: row.role,
    plan: row.onboarding.plan,
    progress: row.onboarding.progress,
  });
}

/** An organisation's address, for sending people back to its pages. */
export async function orgSlugOf(orgId: string) {
  return (await loadOrg(orgId)).slug;
}
