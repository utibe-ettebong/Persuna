CREATE TABLE "job_rounds" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"job_id" uuid NOT NULL,
	"round" integer NOT NULL,
	"output" text NOT NULL,
	"request" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "job_rounds_job_id_round_unique" UNIQUE("job_id","round")
);
--> statement-breakpoint
ALTER TABLE "job_rounds" ADD CONSTRAINT "job_rounds_job_id_jobs_id_fk" FOREIGN KEY ("job_id") REFERENCES "public"."jobs"("id") ON DELETE cascade ON UPDATE no action;