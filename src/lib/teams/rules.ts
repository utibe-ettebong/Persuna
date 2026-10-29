/**
 * Business rules for teams: invite tokens and expiry, who may do what in an
 * organisation, and what keeps company know-how confidential. Pure.
 */
import { createHash, randomBytes } from "node:crypto";

export class TeamRuleError extends Error {
  override name = "TeamRuleError";
}

/* ---------- Invitations ---------- */

/** How long an invitation link works. */
export const INVITE_DAYS = 14;

/** A fresh invitation token. Only its hash is stored; the link is shown once. */
export function newInviteToken(): string {
  return randomBytes(24).toString("base64url");
}

export function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

/** Whether a string could be a token we issued (so junk never reaches the database). */
export function looksLikeToken(token: string): boolean {
  return /^[A-Za-z0-9_-]{32}$/.test(token);
}

export function inviteExpiry(now: Date, days = INVITE_DAYS): Date {
  return new Date(now.getTime() + days * 86_400_000);
}

export function normaliseEmail(email: string): string {
  return email.trim().toLowerCase();
}

export function isEmail(email: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim()) && email.length <= 254;
}

export interface InviteFacts {
  email: string;
  expiresAt: Date;
  acceptedAt: Date | null;
  revokedAt: Date | null;
}

export type InviteState = "pending" | "accepted" | "revoked" | "expired";

export function inviteState(invite: InviteFacts, now: Date): InviteState {
  if (invite.acceptedAt) return "accepted";
  if (invite.revokedAt) return "revoked";
  if (invite.expiresAt.getTime() <= now.getTime()) return "expired";
  return "pending";
}

type Allowed = { ok: true } | { ok: false; reason: string };

/** The signed-in person may accept only a pending invitation sent to their own email. */
export function canAcceptInvite(invite: InviteFacts, userEmail: string, now: Date): Allowed {
  const state = inviteState(invite, now);
  if (state === "accepted") return { ok: false, reason: "This invitation has already been used" };
  if (state === "revoked") return { ok: false, reason: "This invitation was withdrawn" };
  if (state === "expired") {
    return { ok: false, reason: "This invitation has expired. Ask for a new one." };
  }
  if (normaliseEmail(invite.email) !== normaliseEmail(userEmail)) {
    // The address isn't repeated: whoever holds the link may not be the person it was sent to.
    return {
      ok: false,
      reason:
        "This invitation was sent to a different email address. Sign in with that email to accept it.",
    };
  }
  return { ok: true };
}

/* ---------- Membership and permissions ---------- */

/** Someone's place in an organisation, or null when they aren't in it. */
export type Membership = {
  id: string;
  admin: boolean;
  status: "active" | "left";
  roleId: string | null;
} | null;

const active = (m: Membership): m is NonNullable<Membership> => m !== null && m.status === "active";

/** Admins manage members, roles, invitations, the handbook, playbooks and onboarding. */
export function canManage(m: Membership): boolean {
  return active(m) && m.admin;
}

/** Any current member sees the organisation's overview and handbook. */
export function canSeeOrg(m: Membership): boolean {
  return active(m);
}

/**
 * A role's skills and playbook are visible to admins and to the people in
 * that role, nobody else.
 */
export function canSeeRole(m: Membership, roleId: string): boolean {
  return active(m) && (m.admin || m.roleId === roleId);
}

/** Members attach their own skills to their own role; admins may attach theirs to any role. */
export function canAttachSkill(
  m: Membership,
  input: { userId: string; skillOwnerId: string | null; roleId: string },
): Allowed {
  if (!active(m)) return { ok: false, reason: "You're not a member of this organisation" };
  if (input.skillOwnerId !== input.userId) {
    return { ok: false, reason: "You can only attach your own skills" };
  }
  if (!m.admin && m.roleId !== input.roleId) {
    return { ok: false, reason: "You can attach skills to your own role only" };
  }
  return { ok: true };
}

/**
 * Detaching makes a skill personal again (and listable). Admins may detach
 * any; a member may detach a skill they attached themselves, while they're
 * still at the company. Starter skills made from the company's playbook are
 * the company's method, so only an admin can release them.
 */
export function canDetachSkill(
  m: Membership,
  input: { userId: string; skillOwnerId: string | null; origin: "member" | "playbook" },
): Allowed {
  if (!active(m)) return { ok: false, reason: "Only current members can change this" };
  if (m.admin) return { ok: true };
  if (input.skillOwnerId !== input.userId) {
    return { ok: false, reason: "Only the skill's owner or an admin can detach it" };
  }
  if (input.origin === "playbook") {
    return {
      ok: false,
      reason: "This skill was made from the company's playbook; only an admin can release it",
    };
  }
  return { ok: true };
}

/** The recruit sees their own onboarding; admins see everyone's. */
export function canSeeOnboarding(m: Membership, onboardingMemberId: string): boolean {
  return active(m) && (m.admin || m.id === onboardingMemberId);
}

/** Only the recruit works through their onboarding. */
export function canWorkOnboarding(m: Membership, onboardingMemberId: string): boolean {
  return active(m) && m.id === onboardingMemberId;
}

/**
 * An organisation always keeps at least one admin: the last one can't be
 * removed, leave, or lose admin.
 */
export function keepsAnAdmin(input: {
  activeAdmins: number;
  targetIsAdmin: boolean;
  change: "remove" | "demote";
}): Allowed {
  if (input.targetIsAdmin && input.activeAdmins <= 1) {
    return {
      ok: false,
      reason:
        input.change === "remove"
          ? "Make someone else an admin before the last admin leaves"
          : "The organisation needs at least one admin",
    };
  }
  return { ok: true };
}

/* ---------- Confidentiality (the marketplace's own gate is in market/rules) ---------- */

/** What the public may see of a skill's name: nothing, when it's company know-how. */
export function publicSkillName(name: string | null, confidential: boolean): string | null {
  return confidential ? null : name;
}

/** Drops confidential skills from anything public. */
export function withoutConfidential<T>(
  items: T[],
  skillIdOf: (item: T) => string | null,
  confidential: ReadonlySet<string> | ReadonlyMap<string, unknown>,
): T[] {
  return items.filter((item) => {
    const id = skillIdOf(item);
    return !id || !confidential.has(id);
  });
}
