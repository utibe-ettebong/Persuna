ALTER TYPE "public"."job_status" ADD VALUE 'awaiting_approval' BEFORE 'review';--> statement-breakpoint
CREATE TABLE "job_approvals" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"job_id" uuid NOT NULL,
	"tool" text NOT NULL,
	"server" text,
	"args" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"preview" text NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"decided_by" text,
	"decided_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "job_connections" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"job_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"ref" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "job_connections_job_id_kind_ref_unique" UNIQUE("job_id","kind","ref")
);
--> statement-breakpoint
ALTER TABLE "jobs" ADD COLUMN "tool_policy" jsonb;--> statement-breakpoint
ALTER TABLE "jobs" ADD COLUMN "tool_calls" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "job_approvals" ADD CONSTRAINT "job_approvals_job_id_jobs_id_fk" FOREIGN KEY ("job_id") REFERENCES "public"."jobs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "job_connections" ADD CONSTRAINT "job_connections_job_id_jobs_id_fk" FOREIGN KEY ("job_id") REFERENCES "public"."jobs"("id") ON DELETE cascade ON UPDATE no action;