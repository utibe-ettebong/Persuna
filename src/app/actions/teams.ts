"use server";

import { revalidatePath } from "next/cache";
import { unstable_rethrow } from "next/navigation";
import { z } from "zod";
import { attempt, uuidField, type ActionState } from "@/lib/action-state";
import { requireUser } from "@/lib/auth/session";
import { createModelClient } from "@/lib/models";
import {
  HANDBOOK_KINDS,
  acceptInviteById,
  acceptInviteByToken,
  askOnboarding,
  attachSkill,
  cancelOnboarding,
  completeModule,
  createInvite,
  createOrganisation,
  createRole,
  createStarterSkills,
  deleteHandbookNote,
  detachSkill,
  editPlaybook,
  generatePlaybook,
  orgSlugOf,
  publishPlaybook,
  removeMember,
  revokeInvite,
  saveHandbookNote,
  setMemberAdmin,
  setMemberRole,
  startOnboarding,
  submitCheck,
  submitPractice,
  updateRole,
} from "@/lib/teams/service";
import type { Playbook } from "@/lib/teams/types";

const field = (form: FormData, key: string) => String(form.get(key) ?? "");
const lines = (text: string) =>
  text
    .split(/\r?\n/)
    .map((l) => l.replace(/^\s*(?:[-*•]|\d+[.)])\s*/, "").trim())
    .filter(Boolean);
/** Where to go back to: only team pages. */
const back = (form: FormData, fallback = "/team") => {
  const to = field(form, "back");
  return /^\/team(\/[\w/-]*)?(\?[\w=&-]*)?$/.test(to) ? to : fallback;
};
const done = (path: string) => {
  revalidatePath("/team", "layout");
  return path;
};
const optionalUuid = (value: FormDataEntryValue | null) => (value ? uuidField.parse(value) : null);

export async function createOrgAction(_: ActionState, form: FormData): Promise<ActionState> {
  return attempt(async () => {
    const user = await requireUser("/team");
    const org = await createOrganisation(user, {
      name: field(form, "name"),
      roleTitle: field(form, "roleTitle"),
    });
    return done(`/team?org=${org.slug}`);
  });
}

export async function createRoleAction(_: ActionState, form: FormData): Promise<ActionState> {
  return attempt(async () => {
    const user = await requireUser();
    const role = await createRole(user, uuidField.parse(form.get("orgId")), {
      title: field(form, "title"),
      description: field(form, "description"),
    });
    return done(`/team/roles/${role.id}`);
  });
}

export async function updateRoleAction(_: ActionState, form: FormData): Promise<ActionState> {
  return attempt(async () => {
    const user = await requireUser();
    const roleId = uuidField.parse(form.get("roleId"));
    await updateRole(user, roleId, {
      title: field(form, "title"),
      description: field(form, "description"),
    });
    return done(`/team/roles/${roleId}`);
  });
}

/* ---------- Invitations ---------- */

export type InviteFormState = { error: string | null; path: string | null; email: string | null };

/** Creates an invitation and returns its link once, for the admin to send. */
export async function inviteAction(_: InviteFormState, form: FormData): Promise<InviteFormState> {
  try {
    const user = await requireUser();
    const email = field(form, "email");
    const { path } = await createInvite(user, uuidField.parse(form.get("orgId")), {
      email,
      roleId: optionalUuid(form.get("roleId")),
      admin: form.get("admin") === "on",
      onboard: form.get("onboard") === "on",
    });
    revalidatePath("/team", "layout");
    return { error: null, path, email: email.trim().toLowerCase() };
  } catch (error) {
    unstable_rethrow(error);
    const message =
      error instanceof z.ZodError ? "Check the form and try again" : (error as Error).message;
    return { error: message, path: null, email: null };
  }
}

export async function revokeInviteAction(_: ActionState, form: FormData): Promise<ActionState> {
  return attempt(async () => {
    const user = await requireUser();
    await revokeInvite(user, uuidField.parse(form.get("inviteId")));
    return done(back(form));
  });
}

export async function acceptInviteAction(_: ActionState, form: FormData): Promise<ActionState> {
  return attempt(async () => {
    const token = field(form, "token");
    const user = await requireUser(`/team/join/${token}`);
    const result = await acceptInviteByToken(createModelClient(user), user, token);
    return done(
      result.onboardingId
        ? `/team/onboarding/${result.onboardingId}`
        : `/team?org=${result.orgSlug}`,
    );
  });
}

export async function acceptInviteByIdAction(_: ActionState, form: FormData): Promise<ActionState> {
  return attempt(async () => {
    const user = await requireUser("/team");
    const result = await acceptInviteById(
      createModelClient(user),
      user,
      uuidField.parse(form.get("inviteId")),
    );
    return done(
      result.onboardingId
        ? `/team/onboarding/${result.onboardingId}`
        : `/team?org=${result.orgSlug}`,
    );
  });
}

/* ---------- Members ---------- */

export async function setMemberRoleAction(_: ActionState, form: FormData): Promise<ActionState> {
  return attempt(async () => {
    const user = await requireUser();
    await setMemberRole(
      user,
      uuidField.parse(form.get("memberId")),
      optionalUuid(form.get("roleId")),
    );
    return done(back(form));
  });
}

export async function setMemberAdminAction(_: ActionState, form: FormData): Promise<ActionState> {
  return attempt(async () => {
    const user = await requireUser();
    await setMemberAdmin(user, uuidField.parse(form.get("memberId")), form.get("admin") === "true");
    return done(back(form));
  });
}

export async function removeMemberAction(_: ActionState, form: FormData): Promise<ActionState> {
  return attempt(async () => {
    const user = await requireUser();
    await removeMember(user, uuidField.parse(form.get("memberId")));
    return done(back(form));
  });
}

/* ---------- Skills ---------- */

export async function attachSkillAction(_: ActionState, form: FormData): Promise<ActionState> {
  return attempt(async () => {
    const user = await requireUser();
    const slug = z
      .string()
      .regex(/^[a-z0-9-]+$/, "Choose one of your skills")
      .parse(field(form, "skill"));
    await attachSkill(user, uuidField.parse(form.get("roleId")), slug);
    revalidatePath("/skills", "layout");
    return done(back(form));
  });
}

export async function detachSkillAction(_: ActionState, form: FormData): Promise<ActionState> {
  return attempt(async () => {
    const user = await requireUser();
    await detachSkill(user, uuidField.parse(form.get("linkId")));
    revalidatePath("/skills", "layout");
    return done(back(form));
  });
}

/* ---------- Handbook ---------- */

export async function saveHandbookNoteAction(_: ActionState, form: FormData): Promise<ActionState> {
  return attempt(async () => {
    const user = await requireUser();
    const orgId = uuidField.parse(form.get("orgId"));
    await saveHandbookNote(user, orgId, {
      id: optionalUuid(form.get("noteId")),
      kind: z.enum(HANDBOOK_KINDS).catch("other").parse(field(form, "kind")),
      title: field(form, "title"),
      body: field(form, "body"),
    });
    return done(`/team/handbook?org=${await orgSlugOf(orgId)}`);
  });
}

export async function deleteHandbookNoteAction(
  _: ActionState,
  form: FormData,
): Promise<ActionState> {
  return attempt(async () => {
    const user = await requireUser();
    await deleteHandbookNote(user, uuidField.parse(form.get("noteId")));
    return done(back(form));
  });
}

/* ---------- Playbooks ---------- */

export async function generatePlaybookAction(_: ActionState, form: FormData): Promise<ActionState> {
  return attempt(async () => {
    const user = await requireUser();
    const roleId = uuidField.parse(form.get("roleId"));
    await generatePlaybook(createModelClient(user), user, roleId);
    return done(`/team/roles/${roleId}#playbook`);
  });
}

/** The playbook form: role-wide lists, then up to MAX workflows (blank ones are dropped). */
function playbookFrom(form: FormData): Playbook {
  const workflows = Array.from({ length: 8 }, (_, i) => ({
    title: field(form, `w${i}_title`).trim(),
    when: field(form, `w${i}_when`).trim(),
    steps: lines(field(form, `w${i}_steps`)),
    tools: lines(field(form, `w${i}_tools`)),
    qualityBar: lines(field(form, `w${i}_quality`)),
    mistakes: lines(field(form, `w${i}_mistakes`)),
  })).filter((w) => w.title || w.steps.length);
  return {
    summary: field(form, "summary").trim(),
    tools: lines(field(form, "tools")),
    qualityBar: lines(field(form, "quality")),
    mistakes: lines(field(form, "mistakes")),
    workflows,
  };
}

export async function editPlaybookAction(_: ActionState, form: FormData): Promise<ActionState> {
  return attempt(async () => {
    const user = await requireUser();
    const playbookId = uuidField.parse(form.get("playbookId"));
    const row = await editPlaybook(user, playbookId, playbookFrom(form));
    if (form.get("intent") === "publish") await publishPlaybook(user, row.id);
    return done(`/team/roles/${row.roleId}#playbook`);
  });
}

export async function publishPlaybookAction(_: ActionState, form: FormData): Promise<ActionState> {
  return attempt(async () => {
    const user = await requireUser();
    await publishPlaybook(user, uuidField.parse(form.get("playbookId")));
    return done(back(form));
  });
}

/* ---------- Onboarding ---------- */

export async function startOnboardingAction(_: ActionState, form: FormData): Promise<ActionState> {
  return attempt(async () => {
    const user = await requireUser();
    const onboarding = await startOnboarding(createModelClient(user), user, {
      memberId: uuidField.parse(form.get("memberId")),
      roleId: uuidField.parse(form.get("roleId")),
    });
    return done(`/team/onboarding/${onboarding.id}`);
  });
}

const moduleField = z.string().regex(/^m\d{1,2}$/);
const onboardingPage = (id: string, moduleId?: string) =>
  `/team/onboarding/${id}${moduleId ? `?module=${moduleId}` : ""}`;

export async function practiceAction(_: ActionState, form: FormData): Promise<ActionState> {
  return attempt(async () => {
    const user = await requireUser();
    const id = uuidField.parse(form.get("onboardingId"));
    const moduleId = moduleField.parse(form.get("moduleId"));
    await submitPractice(createModelClient(user), user, id, moduleId, field(form, "answer"));
    return done(onboardingPage(id, moduleId));
  });
}

export async function checkAction(_: ActionState, form: FormData): Promise<ActionState> {
  return attempt(async () => {
    const user = await requireUser();
    const id = uuidField.parse(form.get("onboardingId"));
    const moduleId = moduleField.parse(form.get("moduleId"));
    const answers = Array.from({ length: 5 }, (_, i) => field(form, `a${i}`));
    await submitCheck(createModelClient(user), user, id, moduleId, answers);
    return done(onboardingPage(id, moduleId));
  });
}

export async function completeModuleAction(_: ActionState, form: FormData): Promise<ActionState> {
  return attempt(async () => {
    const user = await requireUser();
    const id = uuidField.parse(form.get("onboardingId"));
    const moduleId = moduleField.parse(form.get("moduleId"));
    await completeModule(user, id, moduleId);
    return done(onboardingPage(id));
  });
}

export async function cancelOnboardingAction(_: ActionState, form: FormData): Promise<ActionState> {
  return attempt(async () => {
    const user = await requireUser();
    const id = uuidField.parse(form.get("onboardingId"));
    await cancelOnboarding(user, id);
    return done(back(form));
  });
}

export async function starterSkillsAction(_: ActionState, form: FormData): Promise<ActionState> {
  return attempt(async () => {
    const user = await requireUser();
    await createStarterSkills(user, uuidField.parse(form.get("onboardingId")));
    revalidatePath("/skills", "layout");
    return "/skills";
  });
}

export type AskState = {
  error: string | null;
  question: string | null;
  answer: string | null;
  known: boolean;
  from: string[];
};

/** A question about the job, answered from the playbook and handbook. Nothing is saved. */
export async function askAction(_: AskState, form: FormData): Promise<AskState> {
  const question = field(form, "question").trim();
  try {
    const user = await requireUser();
    const answer = await askOnboarding(
      createModelClient(user),
      user,
      uuidField.parse(form.get("onboardingId")),
      question,
    );
    return { error: null, question, ...answer };
  } catch (error) {
    unstable_rethrow(error);
    const message = error instanceof z.ZodError ? "Something went wrong" : (error as Error).message;
    return { error: message, question, answer: null, known: false, from: [] };
  }
}
