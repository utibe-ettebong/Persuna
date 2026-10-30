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
import type { Tone } from "@/lib/persuna/tone";
import type { FitReport, MilestoneCheck, ProjectPlan } from "@/lib/projects/types";
import type { InterviewAnswers } from "@/lib/skill/interview";
import type { OnboardingPlan, OnboardingProgress, Playbook } from "@/lib/teams/types";
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
/** public: in the marketplace and on the owner's profile. unlisted: only people with the link. */
export const listingVisibility = pgEnum("listing_visibility", ["public", "unlisted"]);

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
  /** Set by a platform admin; suspended accounts read as signed out. Extra column beyond Better Auth's core schema. */
  suspended: boolean("suspended").notNull().default(false),
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
    /** Price per task in US cents. */
    priceCents: integer("price_cents").notNull(),
    turnaroundHours: integer("turnaround_hours").notNull(),
    sampleOutput: text("sample_output").notNull(),
    ownerType: ownerType("owner_type").notNull(),
    ownershipDeclaredAt: timestamp("ownership_declared_at", { withTimezone: true }),
    /** Extra a renter pays for guaranteed owner review, in US cents. Null: not offered. */
    premiumReviewCents: integer("premium_review_cents"),
    employerName: text("employer_name"),
    employerEmail: text("employer_email"),
    /** Employer's share of the owner's earnings, set by the employer when approving. */
    employerSharePercent: integer("employer_share_percent"),
    /** Secret for the employer's approval link. */
    employerToken: text("employer_token").unique(),
    employerDecision: employerDecision("employer_decision"),
    employerDecidedAt: timestamp("employer_decided_at", { withTimezone: true }),
    active: boolean("active").notNull().default(false),
    visibility: listingVisibility("visibility").notNull().default("public"),
    /** Set when Persuna took the listing down by itself (e.g. its score fell below the minimum). */
    pausedAt: timestamp("paused_at", { withTimezone: true }),
    pausedReason: text("paused_reason"),
    createdAt: createdAt(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    check("price_cents_positive", sql`${t.priceCents} > 0`),
    check(
      "premium_review_cents_not_negative",
      sql`${t.premiumReviewCents} is null or ${t.premiumReviewCents} >= 0`,
    ),
  ],
);

/**
 * Escrow for one rented job. Amounts are integer minor units of `currency`:
 * US cents for every payment since the switch to dollars, kobo for the naira
 * payments made before it. Kept after the job is purged.
 */
export const transactions = pgTable(
  "transactions",
  {
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
    amountCents: integer("amount_cents").notNull(),
    platformFeeCents: integer("platform_fee_cents").notNull(),
    ownerShareCents: integer("owner_share_cents").notNull(),
    employerShareCents: integer("employer_share_cents").notNull().default(0),
    /** ISO 4217 code: USD, or NGN for payments made before the switch to dollars. */
    currency: text("currency").notNull().default("USD"),
    premiumReview: boolean("premium_review").notNull().default(false),
    provider: paymentProvider("provider").notNull().default("mock"),
    providerReference: text("provider_reference").unique(),
    status: escrowStatus("status").notNull().default("held"),
    createdAt: createdAt(),
    settledAt: timestamp("settled_at", { withTimezone: true }),
    /**
     * The renter's rating when they accepted, copied from the job so the
     * listing's reviews outlive the job's retention period.
     */
    rating: integer("rating"),
    ratingComment: text("rating_comment"),
  },
  (t) => [
    check("amount_cents_positive", sql`${t.amountCents} > 0`),
    check("txn_rating_range", sql`${t.rating} is null or ${t.rating} between 1 and 5`),
    check("currency_known", sql`${t.currency} in ('USD', 'NGN')`),
  ],
);

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

/* ---------- Persuna: the personal assistant that learns from its user ---------- */

/** One per user: what Persuna is called, what it knows about them, today's focus. */
export const persunaProfiles = pgTable("persuna_profiles", {
  userId: text("user_id")
    .primaryKey()
    .references(() => authUsers.id, { onDelete: "cascade" }),
  name: text("name").notNull().default("Persuna"),
  /** The companion's look, a key of LOOKS in lib/persuna/looks (older rows hold an emoji). */
  avatar: text("avatar").notNull().default("plum"),
  /** Set once the first-meeting setup (name, avatar, first task) is done or skipped. */
  setupDone: boolean("setup_done").notNull().default(false),
  /** Public profile address: /persunas/<handle>. */
  handle: text("handle").unique(),
  /** Short facts the user asked Persuna to remember, newest last. */
  memory: jsonb("memory").$type<string[]>().notNull().default([]),
  focus: text("focus"),
  focusSkillId: uuid("focus_skill_id").references(() => skills.id, { onDelete: "set null" }),
  /** The user's local day (YYYY-MM-DD) Persuna last asked what you're working on. */
  checkinDay: text("checkin_day"),
  /** The local day of the last end-of-day wrap-up. */
  wrapupDay: text("wrapup_day"),
  /** How the user likes to be spoken to (see lib/persuna/tone). */
  tone: jsonb("tone").$type<Tone>().notNull().default({}),
  /** Keys of notices Persuna already raised, newest last, so each is said once. */
  noticeKeys: jsonb("notice_keys").$type<string[]>().notNull().default([]),
  /**
   * The person's public profile (at /persunas/<handle>), for clients posting
   * projects and for people renting their skills. Their own words; null until set.
   */
  publicName: text("public_name"),
  headline: text("headline"),
  bio: text("bio"),
  location: text("location"),
  website: text("website"),
  createdAt: createdAt(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const persunaMessages = pgTable(
  "persuna_messages",
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
    /** For interview turns: which question Persuna just asked. */
    askedKey: text("asked_key"),
    /** A job Persuna ran from the chat. The job's text stays in `jobs`, never here. */
    jobId: uuid("job_id").references(() => jobs.id, { onDelete: "set null" }),
    createdAt: createdAt(),
  },
  (t) => [index().on(t.userId, t.createdAt)],
);

export const persunaNotes = pgTable(
  "persuna_notes",
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
export const persunaReminders = pgTable(
  "persuna_reminders",
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
export type PersunaProfile = typeof persunaProfiles.$inferSelect;
export type PersunaMessage = typeof persunaMessages.$inferSelect;
export type PersunaNote = typeof persunaNotes.$inferSelect;
export type PersunaReminder = typeof persunaReminders.$inferSelect;

/**
 * Apps Persuna may use for the user (Google for Gmail and Calendar, Notion),
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

/** One tool a connected MCP server offers, cached at connect/refresh time. */
export interface McpToolInfo {
  name: string;
  description: string;
}

/**
 * Remote MCP servers the user connected for Persuna to use (Slack, Linear,
 * GitHub, Figma, databases…). The access token is sealed with CONNECTIONS_KEY
 * exactly like app-connection tokens and never leaves the server; v1 speaks
 * remote streamable HTTP only — no local/stdio servers.
 */
export const mcpServers = pgTable(
  "mcp_servers",
  {
    id: id(),
    userId: text("user_id")
      .notNull()
      .references(() => authUsers.id, { onDelete: "cascade" }),
    /** The user's label for this server, shown in chat and confirm cards. */
    name: text("name").notNull(),
    /** Streamable-HTTP MCP endpoint. */
    url: text("url").notNull(),
    /** Sealed bearer token, or empty when the server needs no auth. */
    token: text("token").notNull().default(""),
    /** Tools found at connect time; refreshed on demand. */
    tools: jsonb("tools").$type<McpToolInfo[]>().notNull().default([]),
    createdAt: createdAt(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [unique().on(t.userId, t.url)],
);
export type McpServer = typeof mcpServers.$inferSelect;

/**
 * Earlier versions of a renter's order and the changes they asked for, one row
 * per round. Job text like the rest of the job: deleted with it.
 */
export const jobRounds = pgTable(
  "job_rounds",
  {
    id: id(),
    jobId: uuid("job_id")
      .notNull()
      .references(() => jobs.id, { onDelete: "cascade" }),
    round: integer("round").notNull(),
    /** The version the renter had in front of them. */
    output: text("output").notNull(),
    /** What they asked to change. */
    request: text("request").notNull(),
    createdAt: createdAt(),
  },
  (t) => [unique().on(t.jobId, t.round)],
);
export type JobRound = typeof jobRounds.$inferSelect;

/* ---------- Agent imports: other AI agents hand Persuna what they learned ---------- */

export const agentImportStatus = pgEnum("agent_import_status", [
  "received",
  "training",
  "testing",
  "verified",
  "failed",
]);

/**
 * A key an outside agent (Grokbot, Musebot, Dot…) uses to send skills to one
 * person's account. Only the SHA-256 of the token is stored; the token is shown once.
 */
export const agentKeys = pgTable(
  "agent_keys",
  {
    id: id(),
    userId: text("user_id")
      .notNull()
      .references(() => authUsers.id, { onDelete: "cascade" }),
    agentName: text("agent_name").notNull(),
    tokenHash: text("token_hash").notNull().unique(),
    /** The token's last characters, so the person can tell keys apart. */
    tokenHint: text("token_hint").notNull(),
    createdAt: createdAt(),
    lastUsedAt: timestamp("last_used_at", { withTimezone: true }),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
  },
  (t) => [index().on(t.userId)],
);

/** What Persuna found while training and testing an imported skill. Counts and scores only. */
export interface ImportReport {
  examples?: number;
  train?: number;
  test?: number;
  methodSteps?: number;
  /** Names and identifiers replaced with placeholders before anything was kept. */
  redactions?: number;
  rules?: number;
  version?: number;
  score?: number | null;
  minScore?: number;
  outcome?: "verified" | "below_minimum" | "error";
  problems?: string[];
}

/** One skill sent by an agent (or uploaded as a file), and how training and testing went. */
export const agentImports = pgTable(
  "agent_imports",
  {
    id: id(),
    userId: text("user_id")
      .notNull()
      .references(() => authUsers.id, { onDelete: "cascade" }),
    /** Null for a file the person uploaded themselves. */
    agentKeyId: uuid("agent_key_id").references(() => agentKeys.id, { onDelete: "set null" }),
    agentName: text("agent_name").notNull(),
    status: agentImportStatus("status").notNull().default("received"),
    skillId: uuid("skill_id").references(() => skills.id, { onDelete: "set null" }),
    /**
     * The submission as received, held only until its examples are redacted and
     * saved to the skill (seconds), then cleared. Never shown or reported.
     */
    payload: jsonb("payload"),
    report: jsonb("report").$type<ImportReport>().notNull().default({}),
    /** Why it failed, in a sentence. */
    error: text("error"),
    createdAt: createdAt(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index().on(t.userId, t.createdAt), index().on(t.agentKeyId, t.createdAt)],
);
export type AgentKey = typeof agentKeys.$inferSelect;
export type AgentImport = typeof agentImports.$inferSelect;

/* ---------- Projects: posted work, with Persuna checking every stage ---------- */

export const projectStatus = pgEnum("project_status", [
  "draft",
  "open",
  "in_progress",
  "completed",
  "cancelled",
  "disputed",
]);
export const milestoneStatus = pgEnum("milestone_status", [
  "pending",
  "funded",
  "submitted",
  "changes_requested",
  "approved",
  "released",
  "refunded",
]);
export const proposalStatus = pgEnum("proposal_status", [
  "pending",
  "accepted",
  "declined",
  "withdrawn",
]);
export const updateAuthor = pgEnum("project_update_author", ["persuna", "poster", "seller"]);

/**
 * A piece of work someone posts. The brief is material: it stays here and is
 * blanked after the retention period, never copied into a skill.
 */
export const projects = pgTable(
  "projects",
  {
    id: id(),
    posterId: text("poster_id")
      .notNull()
      .references(() => authUsers.id, { onDelete: "cascade" }),
    title: text("title").notNull(),
    brief: text("brief").notNull(),
    budgetCents: integer("budget_cents").notNull(),
    deadline: timestamp("deadline", { withTimezone: true }).notNull(),
    status: projectStatus("status").notNull().default("draft"),
    chosenProposalId: uuid("chosen_proposal_id").references(
      (): AnyPgColumn => projectProposals.id,
      { onDelete: "set null" },
    ),
    /** Persuna's plan (scope, criteria, milestones, flags), as the poster confirmed it. */
    plan: jsonb("plan").$type<ProjectPlan>(),
    posterRating: integer("poster_rating"),
    posterReview: text("poster_review"),
    sellerRating: integer("seller_rating"),
    sellerReview: text("seller_review"),
    createdAt: createdAt(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
    completedAt: timestamp("completed_at", { withTimezone: true }),
    /** Set when the project ends; the material is blanked after this. */
    expiresAt: timestamp("expires_at", { withTimezone: true }),
    purgedAt: timestamp("purged_at", { withTimezone: true }),
  },
  (t) => [
    index().on(t.status, t.createdAt),
    index().on(t.posterId),
    index().on(t.expiresAt),
    check("budget_cents_positive", sql`${t.budgetCents} > 0`),
    check(
      "project_ratings_range",
      sql`(${t.posterRating} is null or ${t.posterRating} between 1 and 5) and (${t.sellerRating} is null or ${t.sellerRating} between 1 and 5)`,
    ),
  ],
);

/** One deliverable with its acceptance criteria and its own escrow. Amounts in US cents. */
export const projectMilestones = pgTable(
  "project_milestones",
  {
    id: id(),
    projectId: uuid("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    position: integer("position").notNull(),
    title: text("title").notNull(),
    criteria: text("criteria")
      .array()
      .notNull()
      .default(sql`'{}'::text[]`),
    amountCents: integer("amount_cents").notNull(),
    status: milestoneStatus("status").notNull().default("pending"),
    /** The seller's latest delivery. Material: blanked after retention. */
    delivery: text("delivery"),
    /** Persuna's check of the latest delivery against the criteria. */
    check: jsonb("check").$type<MilestoneCheck>(),
    /** Times the poster asked for changes. */
    rounds: integer("rounds").notNull().default(0),
    provider: paymentProvider("provider"),
    paymentReference: text("payment_reference").unique(),
    platformFeeCents: integer("platform_fee_cents"),
    sellerShareCents: integer("seller_share_cents"),
    fundedAt: timestamp("funded_at", { withTimezone: true }),
    submittedAt: timestamp("submitted_at", { withTimezone: true }),
    settledAt: timestamp("settled_at", { withTimezone: true }),
    createdAt: createdAt(),
  },
  (t) => [
    unique().on(t.projectId, t.position),
    check("milestone_amount_positive", sql`${t.amountCents} > 0`),
  ],
);

/** A seller's offer to do the project, with Persuna's fit report for the poster. */
export const projectProposals = pgTable(
  "project_proposals",
  {
    id: id(),
    projectId: uuid("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    sellerId: text("seller_id")
      .notNull()
      .references(() => authUsers.id, { onDelete: "cascade" }),
    /** A listing of theirs the work would draw on, if any. */
    listingId: uuid("listing_id").references(() => listings.id, { onDelete: "set null" }),
    message: text("message").notNull(),
    priceCents: integer("price_cents").notNull(),
    days: integer("days").notNull(),
    fit: jsonb("fit").$type<FitReport>(),
    status: proposalStatus("status").notNull().default("pending"),
    createdAt: createdAt(),
  },
  (t) => [
    unique().on(t.projectId, t.sellerId),
    check("proposal_price_positive", sql`${t.priceCents} > 0`),
  ],
);

/** The project's timeline: every step, and every Persuna check, in order. */
export const projectUpdates = pgTable(
  "project_updates",
  {
    id: id(),
    projectId: uuid("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    author: updateAuthor("author").notNull(),
    /** plan, opened, proposal, fit, accepted, funded, delivery, check, changes, approved, dispute, assessment, wrapup, rating, cancelled, resolved. */
    kind: text("kind").notNull(),
    body: text("body").notNull(),
    milestoneId: uuid("milestone_id").references(() => projectMilestones.id, {
      onDelete: "set null",
    }),
    /** Set on updates about one proposal: only the poster and that seller see them. */
    proposalId: uuid("proposal_id").references(() => projectProposals.id, {
      onDelete: "set null",
    }),
    createdAt: createdAt(),
  },
  (t) => [index().on(t.projectId, t.createdAt)],
);

export type Project = typeof projects.$inferSelect;
export type ProjectMilestone = typeof projectMilestones.$inferSelect;
export type ProjectProposal = typeof projectProposals.$inferSelect;
export type ProjectUpdate = typeof projectUpdates.$inferSelect;

/**
 * Work a person shows on their public profile: what it was, what they did,
 * and a link to see it. Written by them; never copied from jobs or projects.
 */
export const portfolioItems = pgTable(
  "portfolio_items",
  {
    id: id(),
    userId: text("user_id")
      .notNull()
      .references(() => authUsers.id, { onDelete: "cascade" }),
    title: text("title").notNull(),
    description: text("description").notNull().default(""),
    /** Where to see the work (https). */
    link: text("link"),
    /** A picture of it (https). */
    imageUrl: text("image_url"),
    /** The skill it shows, if any. */
    skillId: uuid("skill_id").references(() => skills.id, { onDelete: "set null" }),
    position: integer("position").notNull().default(0),
    createdAt: createdAt(),
  },
  (t) => [index().on(t.userId, t.position)],
);
export type PortfolioItem = typeof portfolioItems.$inferSelect;

/* ---------- Teams: a company's roles, its confidential know-how, and onboarding ---------- */

export const orgMemberStatus = pgEnum("org_member_status", ["active", "left"]);
export const orgSkillOrigin = pgEnum("org_skill_origin", ["member", "playbook"]);
export const playbookStatus = pgEnum("playbook_status", ["draft", "published"]);
export const onboardingStatus = pgEnum("onboarding_status", ["active", "completed", "cancelled"]);

/** A company using Persuna together. Everything under it is confidential to its members. */
export const organisations = pgTable("organisations", {
  id: id(),
  name: text("name").notNull(),
  slug: text("slug").notNull().unique(),
  createdBy: text("created_by").references(() => authUsers.id, { onDelete: "set null" }),
  createdAt: createdAt(),
});

/** A job at the company ("Designer"). Its playbook is built from the skills attached to it. */
export const orgRoles = pgTable(
  "org_roles",
  {
    id: id(),
    orgId: uuid("org_id")
      .notNull()
      .references(() => organisations.id, { onDelete: "cascade" }),
    title: text("title").notNull(),
    description: text("description").notNull().default(""),
    createdAt: createdAt(),
  },
  (t) => [unique().on(t.orgId, t.title)],
);

/**
 * A person at the company. Pending invitations live in org_invites; a row
 * here is someone who joined (active) or has since left (kept, so the skills
 * they attached still count as the role's know-how).
 */
export const orgMembers = pgTable(
  "org_members",
  {
    id: id(),
    orgId: uuid("org_id")
      .notNull()
      .references(() => organisations.id, { onDelete: "cascade" }),
    userId: text("user_id")
      .notNull()
      .references(() => authUsers.id, { onDelete: "cascade" }),
    roleId: uuid("role_id").references(() => orgRoles.id, { onDelete: "set null" }),
    admin: boolean("admin").notNull().default(false),
    status: orgMemberStatus("status").notNull().default("active"),
    joinedAt: timestamp("joined_at", { withTimezone: true }).notNull().defaultNow(),
    leftAt: timestamp("left_at", { withTimezone: true }),
  },
  (t) => [unique().on(t.orgId, t.userId), index().on(t.userId), index().on(t.roleId)],
);

/**
 * An invitation to join, for one email address and role. Only the SHA-256 of
 * the token is stored; the link is shown to the admin once.
 */
export const orgInvites = pgTable(
  "org_invites",
  {
    id: id(),
    orgId: uuid("org_id")
      .notNull()
      .references(() => organisations.id, { onDelete: "cascade" }),
    email: text("email").notNull(),
    roleId: uuid("role_id").references(() => orgRoles.id, { onDelete: "set null" }),
    admin: boolean("admin").notNull().default(false),
    /** Start onboarding for the role as soon as they join (a new hire). */
    onboard: boolean("onboard").notNull().default(false),
    tokenHash: text("token_hash").notNull().unique(),
    invitedBy: text("invited_by").references(() => authUsers.id, { onDelete: "set null" }),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    acceptedAt: timestamp("accepted_at", { withTimezone: true }),
    acceptedBy: text("accepted_by").references(() => authUsers.id, { onDelete: "set null" }),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
    createdAt: createdAt(),
  },
  (t) => [index().on(t.orgId), index().on(t.email)],
);

/**
 * "This skill is part of my job at Acme." An attached skill is confidential:
 * it can't be listed on the marketplace or shown on a public profile, and only
 * the company's admins and people in the same role see its method. A skill
 * belongs to at most one role.
 */
export const orgRoleSkills = pgTable(
  "org_role_skills",
  {
    id: id(),
    orgId: uuid("org_id")
      .notNull()
      .references(() => organisations.id, { onDelete: "cascade" }),
    roleId: uuid("role_id")
      .notNull()
      .references(() => orgRoles.id, { onDelete: "cascade" }),
    skillId: uuid("skill_id")
      .notNull()
      .unique()
      .references(() => skills.id, { onDelete: "cascade" }),
    /** The member whose skill it is (a current or former holder of the role). */
    memberId: uuid("member_id").references(() => orgMembers.id, { onDelete: "set null" }),
    /** member: they attached it. playbook: a starter skill Persuna made from the playbook. */
    origin: orgSkillOrigin("origin").notNull().default("member"),
    createdAt: createdAt(),
  },
  (t) => [index().on(t.roleId)],
);

/** How the company works, in the admins' words: values, tools, processes. Confidential. */
export const orgHandbookNotes = pgTable(
  "org_handbook_notes",
  {
    id: id(),
    orgId: uuid("org_id")
      .notNull()
      .references(() => organisations.id, { onDelete: "cascade" }),
    /** values, tools, process or other. */
    kind: text("kind").notNull().default("other"),
    title: text("title").notNull(),
    body: text("body").notNull(),
    position: integer("position").notNull().default(0),
    updatedBy: text("updated_by").references(() => authUsers.id, { onDelete: "set null" }),
    createdAt: createdAt(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index().on(t.orgId, t.position)],
);

/**
 * The role's workflows, step by step, built from the method of its skills and
 * the handbook. Each generation is a new version; admins edit a draft, then
 * publish it to recruits. Method only: no job text.
 */
export const rolePlaybooks = pgTable(
  "role_playbooks",
  {
    id: id(),
    roleId: uuid("role_id")
      .notNull()
      .references(() => orgRoles.id, { onDelete: "cascade" }),
    version: integer("version").notNull(),
    content: jsonb("content").$type<Playbook>().notNull(),
    status: playbookStatus("status").notNull().default("draft"),
    /** The skills whose rule sheets it was built from. */
    sourceSkillIds: uuid("source_skill_ids")
      .array()
      .notNull()
      .default(sql`'{}'::uuid[]`),
    model: text("model").notNull(),
    createdBy: text("created_by").references(() => authUsers.id, { onDelete: "set null" }),
    createdAt: createdAt(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
    publishedAt: timestamp("published_at", { withTimezone: true }),
  },
  (t) => [unique().on(t.roleId, t.version)],
);

/**
 * A new hire working through their role's onboarding: the plan Persuna made
 * from the published playbook, and how far they've got. Their answers are the
 * company's material: they stay here and never go into a skill.
 */
export const onboardings = pgTable(
  "onboardings",
  {
    id: id(),
    orgId: uuid("org_id")
      .notNull()
      .references(() => organisations.id, { onDelete: "cascade" }),
    memberId: uuid("member_id")
      .notNull()
      .references(() => orgMembers.id, { onDelete: "cascade" }),
    roleId: uuid("role_id")
      .notNull()
      .references(() => orgRoles.id, { onDelete: "cascade" }),
    playbookId: uuid("playbook_id").references(() => rolePlaybooks.id, { onDelete: "set null" }),
    plan: jsonb("plan").$type<OnboardingPlan>().notNull(),
    progress: jsonb("progress").$type<OnboardingProgress>().notNull().default({}),
    status: onboardingStatus("status").notNull().default("active"),
    startedBy: text("started_by").references(() => authUsers.id, { onDelete: "set null" }),
    /** When the recruit took the starter skills made from the playbook. */
    starterSkillsAt: timestamp("starter_skills_at", { withTimezone: true }),
    createdAt: createdAt(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
    completedAt: timestamp("completed_at", { withTimezone: true }),
  },
  (t) => [index().on(t.memberId), index().on(t.orgId, t.status)],
);

export type Organisation = typeof organisations.$inferSelect;
export type OrgRole = typeof orgRoles.$inferSelect;
export type OrgMember = typeof orgMembers.$inferSelect;
export type OrgInvite = typeof orgInvites.$inferSelect;
export type OrgRoleSkill = typeof orgRoleSkills.$inferSelect;
export type OrgHandbookNote = typeof orgHandbookNotes.$inferSelect;
export type RolePlaybook = typeof rolePlaybooks.$inferSelect;
export type Onboarding = typeof onboardings.$inferSelect;
