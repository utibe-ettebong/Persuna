CREATE TYPE "public"."episode_status" AS ENUM('recording', 'done', 'extracted', 'failed');--> statement-breakpoint
CREATE TYPE "public"."rule_evidence_source" AS ENUM('episode', 'interview', 'correction');--> statement-breakpoint
ALTER TYPE "public"."proposal_source" ADD VALUE 'episode';--> statement-breakpoint
CREATE TABLE "episode_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"episode_id" uuid NOT NULL,
	"at" timestamp with time zone NOT NULL,
	"app" text NOT NULL,
	"window" text DEFAULT '' NOT NULL,
	"action" text NOT NULL,
	"role" text DEFAULT '' NOT NULL,
	"label" text DEFAULT '' NOT NULL
);
--> statement-breakpoint
CREATE TABLE "episode_frames" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"episode_id" uuid NOT NULL,
	"at" timestamp with time zone NOT NULL,
	"image" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "episodes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" text NOT NULL,
	"skill_id" uuid NOT NULL,
	"status" "episode_status" DEFAULT 'recording' NOT NULL,
	"narration" text DEFAULT '' NOT NULL,
	"apps" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"ended_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "rule_evidence" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"skill_id" uuid NOT NULL,
	"rule_id" text NOT NULL,
	"source" "rule_evidence_source" NOT NULL,
	"source_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "skill_steps" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"skill_id" uuid NOT NULL,
	"seq" integer NOT NULL,
	"app" text DEFAULT '' NOT NULL,
	"action" text NOT NULL,
	"target_role" text DEFAULT '' NOT NULL,
	"target_label" text DEFAULT '' NOT NULL,
	"decision_key" text,
	"branch_label" text,
	"evidence_count" integer DEFAULT 1 NOT NULL,
	"episode_ids" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "episode_events" ADD CONSTRAINT "episode_events_episode_id_episodes_id_fk" FOREIGN KEY ("episode_id") REFERENCES "public"."episodes"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "episode_frames" ADD CONSTRAINT "episode_frames_episode_id_episodes_id_fk" FOREIGN KEY ("episode_id") REFERENCES "public"."episodes"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "episodes" ADD CONSTRAINT "episodes_user_id_auth_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."auth_user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "episodes" ADD CONSTRAINT "episodes_skill_id_skills_id_fk" FOREIGN KEY ("skill_id") REFERENCES "public"."skills"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rule_evidence" ADD CONSTRAINT "rule_evidence_skill_id_skills_id_fk" FOREIGN KEY ("skill_id") REFERENCES "public"."skills"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "skill_steps" ADD CONSTRAINT "skill_steps_skill_id_skills_id_fk" FOREIGN KEY ("skill_id") REFERENCES "public"."skills"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "episode_events_episode_id_at_index" ON "episode_events" USING btree ("episode_id","at");--> statement-breakpoint
CREATE INDEX "episode_frames_episode_id_at_index" ON "episode_frames" USING btree ("episode_id","at");--> statement-breakpoint
CREATE INDEX "episodes_user_id_skill_id_status_index" ON "episodes" USING btree ("user_id","skill_id","status");--> statement-breakpoint
CREATE INDEX "rule_evidence_skill_id_rule_id_index" ON "rule_evidence" USING btree ("skill_id","rule_id");--> statement-breakpoint
CREATE INDEX "rule_evidence_skill_id_source_source_id_index" ON "rule_evidence" USING btree ("skill_id","source","source_id");--> statement-breakpoint
CREATE INDEX "skill_steps_skill_id_seq_index" ON "skill_steps" USING btree ("skill_id","seq");