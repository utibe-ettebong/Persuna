import { sql } from "drizzle-orm";
import {
  type AnyPgColumn,
  boolean,
  check,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  real,
  text,
  timestamp,
  unique,
  uuid,
} from "drizzle-orm/pg-core";
import type { GroundingReport } from "@/lib/jobs/grounding";
import type { JobFlag } from "@/lib/jobs/self-check";
import type { Tone } from "@/lib/persona/tone";
import type { InterviewAnswers } from "@/lib/skill/interview";
import type { RuleOp, ScoreBreakdown, SkillSheet } from "@/lib/skill/types";

const id = () => uuid("id").primaryKey().defaultRandom();
const createdAt = () => timestamp("created_at", { withTimezone: true }).notNull().defaultNow();

export const exampleSplit = pgEnum("example_split", ["train", "test"]);
export const versionSource = pgEnum("version_source", ["extract", "correction", "edit"]);
export const runStatus = pgEnum("run_status", ["running", "complete", "failed"]);
export const correctionStatus = pgEnum("correction_status", ["pending", "accepted", "rejected"]);
export const proposalSource = pgEnum("proposal_source", [
  "test",
  "job",
  "interview",
  "walkthrough",
  "screen",
  "companion",
]);
export const jobOrigin = pgEnum("job_origin", ["owner", "renter"]);
export const jobStatus = pgEnum("job_status", [
  "awaiting_payment",
  "review",
  "approved",
  "rejected",
]);
export const editSize = pgEnum("edit_size", ["none", "minor", "major", "rejected"]);
export const approvedBy = pgEnum("approved_by", ["owner", "auto"]);
export const ownerType = pgEnum("owner_type", ["freelancer", "employee", "organisation"]);
export const employerDecision = pgEnum("employer_decision", ["pending", "approved", "declined"]);
export const escrowStatus = pgEnum("escrow_status", ["pending", "held", "released", "refunded"]);
export const paymentProvider = pgEnum("payment_provider", ["mock", "paystack"]);

/* ---------- Accounts (Better Auth). Columns follow Better Auth's core schema. ---------- */

const authTimestamps = () => ({
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const authUsers = pgTable("auth_user", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  email: text("email").notNull().unique(),
  emailVerified: boolean("email_verified").notNull().default(false),
  image: text("image"),
  ...authTimestamps(),
});

export const authSessions = pgTable(
  "auth_session",
  {
    id: text("id").primaryKey(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    token: text("token").notNull().unique(),
    ipAddress: text("ip_address"),
    userAgent: text("user_agent"),
    userId: text("user_id")
      .notNull()
      .references(() => authUsers.id, { onDelete: "cascade" }),
    ...authTimestamps(),
  },
  (t) => [index().on(t.userId)],
);

export const authAccounts = pgTable(
  "auth_account",
  {
    id: text("id").primaryKey(),
    accountId: text("account_id").notNull(),
    providerId: text("provider_id").notNull(),
    userId: text("user_id")
      .notNull()
      .references(() => authUsers.id, { onDelete: "cascade" }),
    accessToken: text("access_token"),
    refreshToken: text("refresh_token"),
    idToken: text("id_token"),
    accessTokenExpiresAt: timestamp("access_token_expires_at", { withTimezone: true }),
    refreshTokenExpiresAt: timestamp("refresh_token_expires_at", { withTimezone: true }),
    scope: text("scope"),
    password: text("password"),
    ...authTimestamps(),
  },
  (t) => [index().on(t.userId)],
);

export const authVerifications = pgTable(
  "auth_verification",
  {
    id: text("id").primaryKey(),
    identifier: text("identifier").notNull(),
    value: text("value").notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    ...authTimestamps(),
  },
  (t) => [index().on(t.identifier)],
);

/** The listable unit: one specific task done one owner's way. */
export const skills = pgTable("skills", {
  id: id(),
  /** The account that trained the skill. Null only for rows created before accounts existed. */
  ownerId: text("owner_id").references(() => authUsers.id, { onDelete: "set null" }),
  slug: text("slug").notNull().unique(),
  name: text("name").notNull(),
  taskDescription: text("task_description").notNull(),
  inputType: text("input_type").notNull(),
  outputType: text("output_type").notNull(),
  /** The working version: what test runs, rule edits and corrections build on. */
  currentVersionId: uuid("current_version_id").references((): AnyPgColumn => skillVersions.id, {
    onDelete: "set null",
  }),
  /** The version real jobs use. Only changes through an explicit publish. */
  publishedVersionId: uuid("published_version_id").references((): AnyPgColumn => skillVersions.id, {
    onDelete: "set null",
  }),
  /** 0 review all, 1 auto-approve unflagged jobs, 2 spot-check. Reset to 0 on publish. */
  trustLevel: integer("trust_level").notNull().default(0),
  /** Answers from the guided interview: the owner's own description of the method. */
  interview: jsonb("interview").$type<InterviewAnswers>(),
  createdAt: createdAt(),
});

/** Immutable once written. Rolling back means moving skills.current_version_id. */
export const skillVersions = pgTable(
  "skill_versions",
  {
    id: id(),
    skillId: uuid("skill_id")
      .notNull()
      .references(() => skills.id, { onDelete: "cascade" }),
    version: integer("version").notNull(),
    sheet: jsonb("sheet").$type<SkillSheet>().notNull(),
    source: versionSource("source").notNull(),
    parentVersionId: uuid("parent_version_id").references((): AnyPgColumn => skillVersions.id),
    model: text("model").notNull(),
    publishedAt: timestamp("published_at", { withTimezone: true }),
    createdAt: createdAt(),
  },
  (t) => [unique().on(t.skillId, t.version)],
);

/** Before/after pairs. Method only: anonymised, owner-approved text. */
export const examples = pgTable(
  "examples",
  {
    id: id(),
    skillId: uuid("skill_id")
      .notNull()
      .references(() => skills.id, { onDelete: "cascade" }),
    slug: text("slug").notNull(),
    split: exampleSplit("split").notNull(),
    input: text("input").notNull(),
    output: text("output").notNull(),
    createdAt: createdAt(),
  },
  (t) => [unique().on(t.skillId, t.slug)],
);

/** One pass of a skill version over every held-back test example. */
export const evalRuns = pgTable(
  "eval_runs",
  {
    id: id(),
    skillVersionId: uuid("skill_version_id")
      .notNull()
      .references(() => skillVersions.id, { onDelete: "cascade" }),
    status: runStatus("status").notNull().default("running"),
    meanScore: real("mean_score"),
    error: text("error"),
    createdAt: createdAt(),
    completedAt: timestamp("completed_at", { withTimezone: true }),
  },
  (t) => [index().on(t.skillVersionId)],
);

export const testResults = pgTable(
  "test_results",
  {
    id: id(),
    evalRunId: uuid("eval_run_id")
      .notNull()
      .references(() => evalRuns.id, { onDelete: "cascade" }),
    exampleId: uuid("example_id")
      .notNull()
      .references(() => examples.id, { onDelete: "cascade" }),
    draft: text("draft").notNull(),
    score: real("score").notNull(),
    breakdown: jsonb("breakdown").$type<ScoreBreakdown>().notNull(),
    shotExampleIds: uuid("shot_example_ids")
      .array()
      .notNull()
      .default(sql`'{}'::uuid[]`),
    draftModel: text("draft_model").notNull(),
    evalModel: text("eval_model").notNull(),
    promptTokens: integer("prompt_tokens").notNull().default(0),
    completionTokens: integer("completion_tokens").notNull().default(0),
    createdAt: createdAt(),
  },
  (t) => [index().on(t.evalRunId)],
);

/**
 * An owner edit turned into proposed rule changes. Nothing changes until the
 * owner accepts; accepting creates a new version. Edits made on client jobs
 * keep only the rule changes and reason, never the client's text.
 */
export const corrections = pgTable(
  "corrections",
  {
    id: id(),
    skillId: uuid("skill_id")
      .notNull()
      .references(() => skills.id, { onDelete: "cascade" }),
    testResultId: uuid("test_result_id").references(() => testResults.id, {
      onDelete: "set null",
    }),
    jobId: uuid("job_id").references((): AnyPgColumn => jobs.id, { onDelete: "set null" }),
    fromVersionId: uuid("from_version_id")
      .notNull()
      .references(() => skillVersions.id),
    toVersionId: uuid("to_version_id").references(() => skillVersions.id),
    status: correctionStatus("status").notNull().default("pending"),
    source: proposalSource("source").notNull().default("test"),
    reason: text("reason").notNull(),
    explanation: text("explanation").notNull(),
    editedOutput: text("edited_output"),
    ruleOps: jsonb("rule_ops").$type<RuleOp[]>().notNull(),
    proposedSheet: jsonb("proposed_sheet").$type<SkillSheet>().notNull(),
    createdAt: createdAt(),
    decidedAt: timestamp("decided_at", { withTimezone: true }),
  },
  (t) => [index().on(t.skillId, t.status)],
);

/** One task run through a published skill version. Material: deleted after retention. */
export const jobs = pgTable(
  "jobs",
  {
    id: id(),
    skillId: uuid("skill_id")
      .notNull()
      .references(() => skills.id, { onDelete: "cascade" }),
    skillVersionId: uuid("skill_version_id")
      .notNull()
      .references(() => skillVersions.id),
    origin: jobOrigin("origin").notNull(),
    /** The renter's account, for renter jobs. */
    requesterUserId: text("requester_user_id").references(() => authUsers.id, {
      onDelete: "set null",
    }),
    requesterName: text("requester_name").notNull(),
    input: text("input").notNull(),
    draft: text("draft").notNull(),
    finalOutput: text("final_output"),
    status: jobStatus("status").notNull().default("review"),
    editSize: editSize("edit_size"),
    approvedBy: approvedBy("approved_by"),
    /** The skill's trust level when the job was drafted. */
    trustLevel: integer("trust_level").notNull().default(0),
    /** Problems the self-check found. Flagged jobs always go to the owner. */
    flags: jsonb("flags").$type<JobFlag[]>().notNull().default([]),
    /** Each statement in the draft checked against the input (null for older jobs). */
    grounding: jsonb("grounding").$type<GroundingReport>(),
    /** Renter paid for guaranteed owner review, whatever the trust level. */
    ownerReviewRequired: boolean("owner_review_required").notNull().default(false),
    complaint: text("complaint"),
    complainedAt: timestamp("complained_at", { withTimezone: true }),
    shotExampleIds: uuid("shot_example_ids")
      .array()
      .notNull()
      .default(sql`'{}'::uuid[]`),
    model: text("model").notNull(),
    promptTokens: integer("prompt_tokens").notNull().default(0),
    completionTokens: integer("completion_tokens").notNull().default(0),
    rating: integer("rating"),
    ratingComment: text("rating_comment"),
    createdAt: createdAt(),
    reviewedAt: timestamp("reviewed_at", { withTimezone: true }),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  },
  (t) => [
    index().on(t.status),
    index().on(t.expiresAt),
    check("rating_range", sql`${t.rating} is null or ${t.rating} between 1 and 5`),
  ],
);

/** Marketplace listing for a skill. One per skill. */
export const listings = pgTable(
  "listings",
  {
    id: id(),
    skillId: uuid("skill_id")
      .notNull()
      .unique()
      .references(() => skills.id, { onDelete: "cascade" }),
    title: text("title").notNull(),
    description: text("description").notNull(),
    priceNgn: integer("price_ngn").notNull(),
    turnaroundHours: integer("turnaround_hours").notNull(),
    sampleOutput: text("sample_output").notNull(),
    ownerType: ownerType("owner_type").notNull(),
    ownershipDeclaredAt: timestamp("ownership_declared_at", { withTimezone: true }),
    /** Extra a renter pays for guaranteed owner review. Null: not offered. */
    premiumReviewNgn: integer("premium_review_ngn"),
    employerName: text("employer_name"),
    employerEmail: text("employer_email"),
    /** Employer's share of the owner's earnings, set by the employer when approving. */
    employerSharePercent: integer("employer_share_percent"),
    /** Secret for the employer's approval link. */
    employerToken: text("employer_token").unique(),
    employerDecision: employerDecision("employer_decision"),
    employerDecidedAt: timestamp("employer_decided_at", { withTimezone: true }),
    active: boolean("active").notNull().default(false),
    createdAt: createdAt(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [check("price_positive", sql`${t.priceNgn} > 0`)],
);

/** Escrow for one rented job. Amounts are whole naira. Kept after the job is purged. */
export const transactions = pgTable("transactions", {
  id: id(),
  jobId: uuid("job_id")
    .unique()
    .references(() => jobs.id, { onDelete: "set null" }),
  listingId: uuid("listing_id")
    .notNull()
    .references(() => listings.id),
  renterUserId: text("renter_user_id").references(() => authUsers.id, { onDelete: "set null" }),
  renterName: text("renter_name").notNull(),
  renterEmail: text("renter_email"),
  amountNgn: integer("amount_ngn").notNull(),
  platformFeeNgn: integer("platform_fee_ngn").notNull(),
  ownerShareNgn: integer("owner_share_ngn").notNull(),
  employerShareNgn: integer("employer_share_ngn").notNull().default(0),
  premiumReview: boolean("premium_review").notNull().default(false),
  provider: paymentProvider("provider").notNull().default("mock"),
  providerReference: text("provider_reference").unique(),
  status: escrowStatus("status").notNull().default("held"),
  createdAt: createdAt(),
  settledAt: timestamp("settled_at", { withTimezone: true }),
});

/**
 * Who did what, when. Kept independent of the rows it describes (no foreign
 * keys), so the record survives deletions and retention purges. Holds ids and
 * small facts only, never job text.
 */
export const auditEvents = pgTable(
  "audit_events",
  {
    id: id(),
    at: timestamp("at", { withTimezone: true }).notNull().defaultNow(),
    actor: text("actor").notNull(),
    action: text("action").notNull(),
    entityType: text("entity_type").notNull(),
    entityId: uuid("entity_id"),
    skillId: uuid("skill_id"),
    details: jsonb("details").$type<Record<string, unknown>>().notNull().default({}),
  },
  (t) => [index().on(t.at), index().on(t.skillId)],
);

/* ---------- Persona: the personal assistant that learns from its user ---------- */

/** One per user: what Persona is called, what it knows about them, today's focus. */
export const personaProfiles = pgTable("persona_profiles", {
  userId: text("user_id")
    .primaryKey()
    .references(() => authUsers.id, { onDelete: "cascade" }),
  name: text("name").notNull().default("Persuna"),
  /** The companion's look, a key of LOOKS in lib/persona/looks (older rows hold an emoji). */
  avatar: text("avatar").notNull().default("plum"),
  /** Set once the first-meeting setup (name, avatar, first task) is done or skipped. */
  setupDone: boolean("setup_done").notNull().default(false),
  /** Public profile address: /personas/<handle>. */
  handle: text("handle").unique(),
  /** Short facts the user asked Persona to remember, newest last. */
  memory: jsonb("memory").$type<string[]>().notNull().default([]),
  focus: text("focus"),
  focusSkillId: uuid("focus_skill_id").references(() => skills.id, { onDelete: "set null" }),
  /** The user's local day (YYYY-MM-DD) Persona last asked what you're working on. */
  checkinDay: text("checkin_day"),
  /** The local day of the last end-of-day wrap-up. */
  wrapupDay: text("wrapup_day"),
  /** How the user likes to be spoken to (see lib/persona/tone). */
  tone: jsonb("tone").$type<Tone>().notNull().default({}),
  /** Keys of notices Persona already raised, newest last, so each is said once. */
  noticeKeys: jsonb("notice_keys").$type<string[]>().notNull().default([]),
  createdAt: createdAt(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const personaMessages = pgTable(
  "persona_messages",
  {
    id: id(),
    userId: text("user_id")
      .notNull()
      .references(() => authUsers.id, { onDelete: "cascade" }),
    role: text("role", { enum: ["user", "assistant"] }).notNull(),
    /** chat, checkin, or observation (said while watching the screen). */
    kind: text("kind").notNull().default("chat"),
    content: text("content").notNull(),
    skillId: uuid("skill_id").references(() => skills.id, { onDelete: "set null" }),
    /** For interview turns: which question Persona just asked. */
    askedKey: text("asked_key"),
    /** A job Persona ran from the chat. The job's text stays in `jobs`, never here. */
    jobId: uuid("job_id").references(() => jobs.id, { onDelete: "set null" }),
    createdAt: createdAt(),
  },
  (t) => [index().on(t.userId, t.createdAt)],
);

export const personaNotes = pgTable(
  "persona_notes",
  {
    id: id(),
    userId: text("user_id")
      .notNull()
      .references(() => authUsers.id, { onDelete: "cascade" }),
    title: text("title").notNull(),
    body: text("body").notNull(),
    /** chat or screen. */
    source: text("source").notNull().default("chat"),
    skillId: uuid("skill_id").references(() => skills.id, { onDelete: "set null" }),
    createdAt: createdAt(),
  },
  (t) => [index().on(t.userId, t.createdAt)],
);

/** To-dos, and reminders when they have a due time. */
export const personaReminders = pgTable(
  "persona_reminders",
  {
    id: id(),
    userId: text("user_id")
      .notNull()
      .references(() => authUsers.id, { onDelete: "cascade" }),
    text: text("text").notNull(),
    dueAt: timestamp("due_at", { withTimezone: true }),
    notifiedAt: timestamp("notified_at", { withTimezone: true }),
    doneAt: timestamp("done_at", { withTimezone: true }),
    createdAt: createdAt(),
  },
  (t) => [index().on(t.userId, t.doneAt)],
);

/** One live model call by a user, for the daily per-user limit. */
export const modelUsage = pgTable(
  "model_usage",
  {
    id: id(),
    userId: text("user_id")
      .notNull()
      .references(() => authUsers.id, { onDelete: "cascade" }),
    role: text("role").notNull(),
    at: timestamp("at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index().on(t.userId, t.at)],
);

export type Skill = typeof skills.$inferSelect;
export type SkillVersion = typeof skillVersions.$inferSelect;
export type Example = typeof examples.$inferSelect;
export type EvalRun = typeof evalRuns.$inferSelect;
export type TestResult = typeof testResults.$inferSelect;
export type Correction = typeof corrections.$inferSelect;
export type Job = typeof jobs.$inferSelect;
export type Listing = typeof listings.$inferSelect;
export type Transaction = typeof transactions.$inferSelect;
export type AuditEvent = typeof auditEvents.$inferSelect;
export type AuthUser = typeof authUsers.$inferSelect;
export type PersonaProfile = typeof personaProfiles.$inferSelect;
export type PersonaMessage = typeof personaMessages.$inferSelect;
export type PersonaNote = typeof personaNotes.$inferSelect;
export type PersonaReminder = typeof personaReminders.$inferSelect;

/**
 * Apps Persona may use for the user (Google for Gmail and Calendar, Notion),
 * connected by OAuth. Tokens are encrypted at rest (CONNECTIONS_KEY) and
 * never leave the server.
 */
export const appConnections = pgTable(
  "app_connections",
  {
    id: id(),
    userId: text("user_id")
      .notNull()
      .references(() => authUsers.id, { onDelete: "cascade" }),
    /** google or notion. */
    provider: text("provider").notNull(),
    /** Which account it is (an email, a workspace name), to show the user. */
    account: text("account").notNull(),
    scopes: text("scopes").notNull().default(""),
    accessToken: text("access_token").notNull(),
    refreshToken: text("refresh_token"),
    expiresAt: timestamp("expires_at", { withTimezone: true }),
    createdAt: createdAt(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [unique().on(t.userId, t.provider)],
);
export type AppConnection = typeof appConnections.$inferSelect;
