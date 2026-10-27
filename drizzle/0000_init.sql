CREATE TYPE "public"."correction_status" AS ENUM('pending', 'accepted', 'rejected');--> statement-breakpoint
CREATE TYPE "public"."edit_size" AS ENUM('none', 'minor', 'major', 'rejected');--> statement-breakpoint
CREATE TYPE "public"."escrow_status" AS ENUM('held', 'released', 'refunded');--> statement-breakpoint
CREATE TYPE "public"."example_split" AS ENUM('train', 'test');--> statement-breakpoint
CREATE TYPE "public"."job_origin" AS ENUM('owner', 'renter');--> statement-breakpoint
CREATE TYPE "public"."job_status" AS ENUM('review', 'approved', 'rejected');--> statement-breakpoint
CREATE TYPE "public"."owner_type" AS ENUM('freelancer', 'employee', 'organisation');--> statement-breakpoint
CREATE TYPE "public"."run_status" AS ENUM('running', 'complete', 'failed');--> statement-breakpoint
CREATE TYPE "public"."version_source" AS ENUM('extract', 'correction', 'edit');--> statement-breakpoint
CREATE TABLE "corrections" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"skill_id" uuid NOT NULL,
	"test_result_id" uuid,
	"job_id" uuid,
	"from_version_id" uuid NOT NULL,
	"to_version_id" uuid,
	"status" "correction_status" DEFAULT 'pending' NOT NULL,
	"reason" text NOT NULL,
	"explanation" text NOT NULL,
	"edited_output" text,
	"rule_ops" jsonb NOT NULL,
	"proposed_sheet" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"decided_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "eval_runs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"skill_version_id" uuid NOT NULL,
	"status" "run_status" DEFAULT 'running' NOT NULL,
	"mean_score" real,
	"error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"completed_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "examples" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"skill_id" uuid NOT NULL,
	"slug" text NOT NULL,
	"split" "example_split" NOT NULL,
	"input" text NOT NULL,
	"output" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "examples_skill_id_slug_unique" UNIQUE("skill_id","slug")
);
--> statement-breakpoint
CREATE TABLE "jobs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"skill_id" uuid NOT NULL,
	"skill_version_id" uuid NOT NULL,
	"origin" "job_origin" NOT NULL,
	"requester_name" text NOT NULL,
	"input" text NOT NULL,
	"draft" text NOT NULL,
	"final_output" text,
	"status" "job_status" DEFAULT 'review' NOT NULL,
	"edit_size" "edit_size",
	"shot_example_ids" uuid[] DEFAULT '{}'::uuid[] NOT NULL,
	"model" text NOT NULL,
	"prompt_tokens" integer DEFAULT 0 NOT NULL,
	"completion_tokens" integer DEFAULT 0 NOT NULL,
	"rating" integer,
	"rating_comment" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"reviewed_at" timestamp with time zone,
	"expires_at" timestamp with time zone NOT NULL,
	CONSTRAINT "rating_range" CHECK ("jobs"."rating" is null or "jobs"."rating" between 1 and 5)
);
--> statement-breakpoint
CREATE TABLE "listings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"skill_id" uuid NOT NULL,
	"title" text NOT NULL,
	"description" text NOT NULL,
	"price_ngn" integer NOT NULL,
	"turnaround_hours" integer NOT NULL,
	"sample_output" text NOT NULL,
	"owner_type" "owner_type" NOT NULL,
	"ownership_declared_at" timestamp with time zone,
	"active" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "listings_skill_id_unique" UNIQUE("skill_id"),
	CONSTRAINT "price_positive" CHECK ("listings"."price_ngn" > 0)
);
--> statement-breakpoint
CREATE TABLE "skill_versions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"skill_id" uuid NOT NULL,
	"version" integer NOT NULL,
	"sheet" jsonb NOT NULL,
	"source" "version_source" NOT NULL,
	"parent_version_id" uuid,
	"model" text NOT NULL,
	"published_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "skill_versions_skill_id_version_unique" UNIQUE("skill_id","version")
);
--> statement-breakpoint
CREATE TABLE "skills" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"slug" text NOT NULL,
	"name" text NOT NULL,
	"task_description" text NOT NULL,
	"input_type" text NOT NULL,
	"output_type" text NOT NULL,
	"current_version_id" uuid,
	"published_version_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "skills_slug_unique" UNIQUE("slug")
);
--> statement-breakpoint
CREATE TABLE "test_results" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"eval_run_id" uuid NOT NULL,
	"example_id" uuid NOT NULL,
	"draft" text NOT NULL,
	"score" real NOT NULL,
	"breakdown" jsonb NOT NULL,
	"shot_example_ids" uuid[] DEFAULT '{}'::uuid[] NOT NULL,
	"draft_model" text NOT NULL,
	"eval_model" text NOT NULL,
	"prompt_tokens" integer DEFAULT 0 NOT NULL,
	"completion_tokens" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "transactions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"job_id" uuid,
	"listing_id" uuid NOT NULL,
	"renter_name" text NOT NULL,
	"amount_ngn" integer NOT NULL,
	"platform_fee_ngn" integer NOT NULL,
	"owner_share_ngn" integer NOT NULL,
	"status" "escrow_status" DEFAULT 'held' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"settled_at" timestamp with time zone,
	CONSTRAINT "transactions_job_id_unique" UNIQUE("job_id")
);
--> statement-breakpoint
ALTER TABLE "corrections" ADD CONSTRAINT "corrections_skill_id_skills_id_fk" FOREIGN KEY ("skill_id") REFERENCES "public"."skills"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "corrections" ADD CONSTRAINT "corrections_test_result_id_test_results_id_fk" FOREIGN KEY ("test_result_id") REFERENCES "public"."test_results"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "corrections" ADD CONSTRAINT "corrections_job_id_jobs_id_fk" FOREIGN KEY ("job_id") REFERENCES "public"."jobs"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "corrections" ADD CONSTRAINT "corrections_from_version_id_skill_versions_id_fk" FOREIGN KEY ("from_version_id") REFERENCES "public"."skill_versions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "corrections" ADD CONSTRAINT "corrections_to_version_id_skill_versions_id_fk" FOREIGN KEY ("to_version_id") REFERENCES "public"."skill_versions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "eval_runs" ADD CONSTRAINT "eval_runs_skill_version_id_skill_versions_id_fk" FOREIGN KEY ("skill_version_id") REFERENCES "public"."skill_versions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "examples" ADD CONSTRAINT "examples_skill_id_skills_id_fk" FOREIGN KEY ("skill_id") REFERENCES "public"."skills"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "jobs" ADD CONSTRAINT "jobs_skill_id_skills_id_fk" FOREIGN KEY ("skill_id") REFERENCES "public"."skills"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "jobs" ADD CONSTRAINT "jobs_skill_version_id_skill_versions_id_fk" FOREIGN KEY ("skill_version_id") REFERENCES "public"."skill_versions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "listings" ADD CONSTRAINT "listings_skill_id_skills_id_fk" FOREIGN KEY ("skill_id") REFERENCES "public"."skills"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "skill_versions" ADD CONSTRAINT "skill_versions_skill_id_skills_id_fk" FOREIGN KEY ("skill_id") REFERENCES "public"."skills"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "skill_versions" ADD CONSTRAINT "skill_versions_parent_version_id_skill_versions_id_fk" FOREIGN KEY ("parent_version_id") REFERENCES "public"."skill_versions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "skills" ADD CONSTRAINT "skills_current_version_id_skill_versions_id_fk" FOREIGN KEY ("current_version_id") REFERENCES "public"."skill_versions"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "skills" ADD CONSTRAINT "skills_published_version_id_skill_versions_id_fk" FOREIGN KEY ("published_version_id") REFERENCES "public"."skill_versions"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "test_results" ADD CONSTRAINT "test_results_eval_run_id_eval_runs_id_fk" FOREIGN KEY ("eval_run_id") REFERENCES "public"."eval_runs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "test_results" ADD CONSTRAINT "test_results_example_id_examples_id_fk" FOREIGN KEY ("example_id") REFERENCES "public"."examples"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transactions" ADD CONSTRAINT "transactions_job_id_jobs_id_fk" FOREIGN KEY ("job_id") REFERENCES "public"."jobs"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transactions" ADD CONSTRAINT "transactions_listing_id_listings_id_fk" FOREIGN KEY ("listing_id") REFERENCES "public"."listings"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "corrections_skill_id_status_index" ON "corrections" USING btree ("skill_id","status");--> statement-breakpoint
CREATE INDEX "eval_runs_skill_version_id_index" ON "eval_runs" USING btree ("skill_version_id");--> statement-breakpoint
CREATE INDEX "jobs_status_index" ON "jobs" USING btree ("status");--> statement-breakpoint
CREATE INDEX "jobs_expires_at_index" ON "jobs" USING btree ("expires_at");--> statement-breakpoint
CREATE INDEX "test_results_eval_run_id_index" ON "test_results" USING btree ("eval_run_id");