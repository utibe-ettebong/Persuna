import { describe, expect, it } from "vitest";
import { createMockClient } from "@/lib/models/mock";
import { renderSheet } from "@/lib/skill/sheet";
import { skillSheet } from "@/lib/skill/types";
import { answerQuestion, buildOnboardingPlan, buildPlaybook, gradeAnswers } from "./brain";
import {
  canCompleteModule,
  finishGrade,
  gradeOutcome,
  moduleState,
  normalisePlan,
  onboardingNote,
  onboardingProgress,
  planProblem,
  playbookProblem,
  renderHandbook,
  renderPlaybook,
  starterSheet,
} from "./onboarding";
import {
  canAcceptInvite,
  canAttachSkill,
  canDetachSkill,
  canManage,
  canSeeOnboarding,
  canSeeRole,
  canWorkOnboarding,
  hashToken,
  inviteExpiry,
  inviteState,
  isEmail,
  keepsAnAdmin,
  looksLikeToken,
  newInviteToken,
  publicSkillName,
  sharedTeamSkills,
  withoutConfidential,
  type Membership,
} from "./rules";
import type { Grade, OnboardingPlan, Playbook } from "./types";

const now = new Date("2026-10-29T12:00:00Z");

describe("invitations", () => {
  const invite = {
    email: "Ada@Example.com",
    expiresAt: inviteExpiry(now),
    acceptedAt: null,
    revokedAt: null,
  };

  it("issues tokens we can recognise, storing only a stable hash", () => {
    const token = newInviteToken();
    expect(looksLikeToken(token)).toBe(true);
    expect(looksLikeToken("../etc/passwd")).toBe(false);
    expect(hashToken(token)).toBe(hashToken(token));
    expect(hashToken(token)).not.toContain(token);
    expect(newInviteToken()).not.toBe(token);
  });

  it("expires after the invite period", () => {
    expect(inviteState(invite, now)).toBe("pending");
    expect(inviteState(invite, new Date(now.getTime() + 14 * 86_400_000))).toBe("expired");
    expect(inviteState({ ...invite, revokedAt: now }, now)).toBe("revoked");
    expect(inviteState({ ...invite, acceptedAt: now }, now)).toBe("accepted");
  });

  it("is accepted only by the invited email, ignoring case and spaces", () => {
    expect(canAcceptInvite(invite, " ada@example.COM ", now)).toEqual({ ok: true });
    const other = canAcceptInvite(invite, "eve@example.com", now);
    expect(other.ok).toBe(false);
    expect(!other.ok && other.reason).toMatch(/different email/);
    expect(!other.ok && other.reason).not.toMatch(/example/i);
    expect(canAcceptInvite({ ...invite, acceptedAt: now }, "ada@example.com", now).ok).toBe(false);
    const late = canAcceptInvite(invite, "ada@example.com", new Date("2027-01-01"));
    expect(!late.ok && late.reason).toMatch(/expired/);
  });

  it("checks email addresses", () => {
    expect(isEmail("ada@example.com")).toBe(true);
    expect(isEmail("ada@example")).toBe(false);
    expect(isEmail("not an email")).toBe(false);
  });
});

describe("membership permissions", () => {
  const admin: Membership = { id: "a", admin: true, status: "active", roleId: "r1" };
  const designer: Membership = { id: "d", admin: false, status: "active", roleId: "r1" };
  const writer: Membership = { id: "w", admin: false, status: "active", roleId: "r2" };
  const gone: Membership = { id: "g", admin: true, status: "left", roleId: "r1" };

  it("lets only active admins manage", () => {
    expect(canManage(admin)).toBe(true);
    expect(canManage(designer)).toBe(false);
    expect(canManage(gone)).toBe(false);
    expect(canManage(null)).toBe(false);
  });

  it("shows a role to admins and the people in it only", () => {
    expect(canSeeRole(admin, "r2")).toBe(true);
    expect(canSeeRole(designer, "r1")).toBe(true);
    expect(canSeeRole(writer, "r1")).toBe(false);
    expect(canSeeRole(gone, "r1")).toBe(false);
    expect(canSeeRole(null, "r1")).toBe(false);
  });

  it("attaches only your own skill, to your own role unless you're an admin", () => {
    expect(canAttachSkill(designer, { userId: "u", skillOwnerId: "u", roleId: "r1" }).ok).toBe(
      true,
    );
    expect(canAttachSkill(designer, { userId: "u", skillOwnerId: "u", roleId: "r2" }).ok).toBe(
      false,
    );
    expect(canAttachSkill(designer, { userId: "u", skillOwnerId: "x", roleId: "r1" }).ok).toBe(
      false,
    );
    expect(canAttachSkill(admin, { userId: "u", skillOwnerId: "u", roleId: "r2" }).ok).toBe(true);
    expect(canAttachSkill(gone, { userId: "u", skillOwnerId: "u", roleId: "r1" }).ok).toBe(false);
  });

  it("keeps playbook starter skills confidential unless an admin releases them", () => {
    const own = { userId: "u", skillOwnerId: "u" };
    expect(canDetachSkill(designer, { ...own, origin: "member" }).ok).toBe(true);
    expect(canDetachSkill(designer, { ...own, origin: "playbook" }).ok).toBe(false);
    expect(canDetachSkill(admin, { ...own, skillOwnerId: "x", origin: "playbook" }).ok).toBe(true);
    expect(canDetachSkill(writer, { ...own, skillOwnerId: "x", origin: "member" }).ok).toBe(false);
    // Former members can't make company know-how listable on the way out.
    expect(canDetachSkill({ ...designer!, status: "left" }, { ...own, origin: "member" }).ok).toBe(
      false,
    );
  });

  it("shows an onboarding to the recruit and admins; only the recruit works on it", () => {
    expect(canSeeOnboarding(designer, "d")).toBe(true);
    expect(canSeeOnboarding(admin, "d")).toBe(true);
    expect(canSeeOnboarding(writer, "d")).toBe(false);
    expect(canWorkOnboarding(designer, "d")).toBe(true);
    expect(canWorkOnboarding(admin, "d")).toBe(false);
  });

  it("never leaves an organisation without an admin", () => {
    expect(keepsAnAdmin({ activeAdmins: 1, targetIsAdmin: true, change: "remove" }).ok).toBe(false);
    expect(keepsAnAdmin({ activeAdmins: 1, targetIsAdmin: true, change: "demote" }).ok).toBe(false);
    expect(keepsAnAdmin({ activeAdmins: 2, targetIsAdmin: true, change: "remove" }).ok).toBe(true);
    expect(keepsAnAdmin({ activeAdmins: 1, targetIsAdmin: false, change: "remove" }).ok).toBe(true);
  });
});

describe("confidentiality", () => {
  it("drops company skills from anything public", () => {
    const items = [{ skillId: "s1" }, { skillId: "s2" }, { skillId: null }];
    const confidential = new Map([["s2", "Acme"]]);
    expect(withoutConfidential(items, (i) => i.skillId, confidential)).toEqual([
      { skillId: "s1" },
      { skillId: null },
    ]);
  });

  it("never names a confidential skill in public", () => {
    expect(publicSkillName("Brand reviews", true)).toBeNull();
    expect(publicSkillName("Brand reviews", false)).toBe("Brand reviews");
  });

  it("shares team-visible skills, except ones attached to a role", () => {
    const memberSkills = [
      { id: "s1", teamVisible: true },
      { id: "s2", teamVisible: false },
      { id: "s3", teamVisible: true },
    ];
    expect(sharedTeamSkills(memberSkills, new Set(["s3"]))).toEqual([
      { id: "s1", teamVisible: true },
    ]);
    expect(sharedTeamSkills(memberSkills, new Set())).toHaveLength(2);
  });
});

const playbook: Playbook = {
  summary: "Designers turn briefs into reviewed designs.",
  workflows: [
    {
      title: "Design review",
      when: "A draft design is ready",
      steps: ["Share the draft in the review channel", "Collect comments for a day", "Revise"],
      tools: ["Figma"],
      qualityBar: ["Every comment answered"],
      mistakes: ["Skipping accessibility checks"],
    },
  ],
  tools: ["Figma", "Slack"],
  qualityBar: ["Matches the brand guide"],
  mistakes: ["Shipping without review"],
};

const makeModule = (id: string, kind: "company" | "workflow", title = "T") => ({
  id,
  kind,
  title,
  lessons: [{ title: "L", body: "Body" }],
  practice: { task: "Do it", rubric: ["Covers it"] },
  check: [{ question: "Q?", rubric: ["A"] }],
});

const grade = (passed: boolean): Grade => ({
  results: [],
  summary: "",
  score: passed ? 100 : 0,
  passed,
  at: now.toISOString(),
});

describe("onboarding plans", () => {
  it("puts the company module first and numbers the modules", () => {
    const plan = normalisePlan({
      welcome: "Hi",
      modules: [makeModule("", "workflow", "Design review"), makeModule("", "company", "Acme")],
    });
    expect(plan.modules.map((m) => [m.id, m.kind])).toEqual([
      ["m1", "company"],
      ["m2", "workflow"],
    ]);
    expect(planProblem(plan)).toBeNull();
  });

  it("rejects plans a recruit couldn't work through", () => {
    const ok: OnboardingPlan = {
      welcome: "",
      modules: [makeModule("m1", "company"), makeModule("m2", "workflow")],
    };
    expect(planProblem(ok)).toBeNull();
    expect(planProblem({ welcome: "", modules: [] })).toMatch(/no modules/);
    expect(planProblem({ welcome: "", modules: [makeModule("m1", "workflow")] })).toMatch(
      /company/,
    );
    expect(planProblem({ welcome: "", modules: [makeModule("m1", "company")] })).toMatch(
      /workflow/,
    );
    expect(
      planProblem({
        welcome: "",
        modules: [makeModule("m1", "company"), makeModule("m1", "workflow")],
      }),
    ).toMatch(/unique/);
    expect(
      planProblem({
        welcome: "",
        modules: [makeModule("m1", "company"), { ...makeModule("m2", "workflow"), check: [] }],
      }),
    ).toMatch(/check/);
  });

  it("validates edited playbooks", () => {
    expect(playbookProblem(playbook)).toBeNull();
    expect(playbookProblem({ ...playbook, workflows: [] })).toMatch(/workflow/);
    expect(
      playbookProblem({ ...playbook, workflows: [{ ...playbook.workflows[0], steps: [" "] }] }),
    ).toMatch(/step/);
  });
});

describe("marking and progress", () => {
  it("scores met as 1 and partly as a half, passing at 70", () => {
    expect(gradeOutcome(["met", "met", "partly"])).toEqual({ score: 83, passed: true });
    expect(gradeOutcome(["met", "partly", "not_met"])).toEqual({ score: 50, passed: false });
    expect(gradeOutcome([])).toEqual({ score: 0, passed: false });
  });

  it("fills in results the model left out as not met", () => {
    const g = finishGrade(
      ["Q1", "Q2"],
      { results: [{ verdict: "met", feedback: "Good" }], summary: "S" },
      now,
    );
    expect(g.results.map((r) => r.verdict)).toEqual(["met", "not_met"]);
    expect(g.passed).toBe(false);
  });

  it("completes a module only after practice and a passed check", () => {
    expect(canCompleteModule(undefined).ok).toBe(false);
    const practice = { answer: "a", grade: grade(false) };
    expect(canCompleteModule({ practice }).ok).toBe(false);
    expect(canCompleteModule({ practice, check: { answers: [], grade: grade(false) } }).ok).toBe(
      false,
    );
    const ready = { practice, check: { answers: [], grade: grade(true) } };
    expect(canCompleteModule(ready)).toEqual({ ok: true });
    expect(moduleState(ready)).toBe("ready");
    expect(canCompleteModule({ ...ready, doneAt: now.toISOString() }).ok).toBe(false);
    expect(moduleState({ ...ready, doneAt: now.toISOString() })).toBe("done");
    expect(moduleState({ practice })).toBe("in_progress");
  });

  it("tracks how far the recruit has got and what's next", () => {
    const plan: OnboardingPlan = {
      welcome: "",
      modules: [makeModule("m1", "company", "Acme"), makeModule("m2", "workflow", "Design review")],
    };
    const progress = { m1: { doneAt: now.toISOString() } };
    expect(onboardingProgress(plan, progress)).toMatchObject({
      done: 1,
      total: 2,
      percent: 50,
      nextNumber: 2,
      finished: false,
    });
    expect(onboardingNote({ org: "Acme", role: "Designer", plan, progress })).toEqual({
      org: "Acme",
      role: "Designer",
      next: "Module 2: Design review",
      done: 1,
      total: 2,
    });
    const all = { ...progress, m2: { doneAt: now.toISOString() } };
    expect(onboardingProgress(plan, all).finished).toBe(true);
    expect(onboardingNote({ org: "Acme", role: "Designer", plan, progress: all }).next).toBeNull();
  });
});

describe("starter skills", () => {
  it("turns a workflow into a valid rule sheet, method only", () => {
    const sheet = skillSheet.parse(starterSheet(playbook.workflows[0], playbook));
    expect(sheet.rules[0]).toEqual({
      id: "R1",
      category: "structure",
      text: "Step 1: Share the draft in the review channel",
    });
    expect(sheet.rules.some((r) => r.text === "Avoid: Skipping accessibility checks")).toBe(true);
    expect(sheet.rules.some((r) => r.text === "Work in: Figma")).toBe(true);
    expect(new Set(sheet.rules.map((r) => r.id)).size).toBe(sheet.rules.length);
  });
});

describe("the mock models run the team flow through the real prompts", () => {
  const client = createMockClient();
  const handbook = renderHandbook([
    { kind: "values", title: "How we work", body: "We always review designs before shipping." },
    { kind: "tools", title: "Tools", body: "We use Figma for design and Slack for reviews." },
  ]);

  it("builds a playbook, a plan, marks answers and answers questions", async () => {
    const sheet = {
      summary: "Brand-safe social posts.",
      rules: [
        { id: "R1", category: "structure" as const, text: "Open with the hook." },
        { id: "R2", category: "cut" as const, text: "Drop internal jargon." },
      ],
      template: "Hook / Body / Call to action",
    };
    const { playbook: built } = await buildPlaybook(client, {
      org: "Acme",
      role: "Designer",
      description: "",
      handbook,
      skills: [{ name: "Social posts", task: "Brief to post", sheet: renderSheet(sheet) }],
    });
    expect(built.workflows[0].title).toBe("Social posts");
    expect(built.workflows[0].steps).toContain("Open with the hook.");
    expect(built.workflows[0].mistakes).toContain("Drop internal jargon.");

    const plan = await buildOnboardingPlan(client, {
      org: "Acme",
      role: "Designer",
      playbook: built,
      handbook,
    });
    expect(plan.modules[0].kind).toBe("company");
    expect(plan.modules.map((m) => m.title)).toContain("Social posts");
    expect(planProblem(plan)).toBeNull();

    const strong = await gradeAnswers(client, {
      module: "Social posts",
      material: renderPlaybook(built),
      items: [
        {
          prompt: "Steps?",
          rubric: ["Open with the hook."],
          answer: "I open with the hook first.",
        },
      ],
      now,
    });
    expect(strong.passed).toBe(true);
    const weak = await gradeAnswers(client, {
      module: "Social posts",
      material: renderPlaybook(built),
      items: [{ prompt: "Steps?", rubric: ["Open with the hook."], answer: "No idea" }],
      now,
    });
    expect(weak.passed).toBe(false);

    const material = `${renderPlaybook(built)}\n\n${handbook}`;
    const known = await answerQuestion(client, {
      org: "Acme",
      role: "Designer",
      material,
      question: "Which tool do we use for design?",
    });
    expect(known.known).toBe(true);
    expect(known.answer).toMatch(/Figma/);
    const unknown = await answerQuestion(client, {
      org: "Acme",
      role: "Designer",
      material,
      question: "What's the parking policy?",
    });
    expect(unknown.known).toBe(false);
  });
});
