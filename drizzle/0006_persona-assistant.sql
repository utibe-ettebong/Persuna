CREATE TABLE "persona_reminders" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" text NOT NULL,
	"text" text NOT NULL,
	"due_at" timestamp with time zone,
	"notified_at" timestamp with time zone,
	"done_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "persona_messages" ADD COLUMN "job_id" uuid;--> statement-breakpoint
ALTER TABLE "persona_profiles" ADD COLUMN "setup_done" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "persona_profiles" ADD COLUMN "handle" text;--> statement-breakpoint
ALTER TABLE "persona_profiles" ADD COLUMN "wrapup_day" text;--> statement-breakpoint
ALTER TABLE "persona_reminders" ADD CONSTRAINT "persona_reminders_user_id_auth_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."auth_user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "persona_reminders_user_id_done_at_index" ON "persona_reminders" USING btree ("user_id","done_at");--> statement-breakpoint
ALTER TABLE "persona_messages" ADD CONSTRAINT "persona_messages_job_id_jobs_id_fk" FOREIGN KEY ("job_id") REFERENCES "public"."jobs"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "persona_profiles" ADD CONSTRAINT "persona_profiles_handle_unique" UNIQUE("handle");