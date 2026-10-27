ALTER TYPE "public"."proposal_source" ADD VALUE 'companion';--> statement-breakpoint
CREATE TABLE "persona_messages" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" text NOT NULL,
	"role" text NOT NULL,
	"kind" text DEFAULT 'chat' NOT NULL,
	"content" text NOT NULL,
	"skill_id" uuid,
	"asked_key" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "persona_notes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" text NOT NULL,
	"title" text NOT NULL,
	"body" text NOT NULL,
	"source" text DEFAULT 'chat' NOT NULL,
	"skill_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "persona_profiles" (
	"user_id" text PRIMARY KEY NOT NULL,
	"name" text DEFAULT 'Persona' NOT NULL,
	"avatar" text DEFAULT '🦉' NOT NULL,
	"memory" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"focus" text,
	"focus_skill_id" uuid,
	"checkin_day" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "persona_messages" ADD CONSTRAINT "persona_messages_user_id_auth_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."auth_user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "persona_messages" ADD CONSTRAINT "persona_messages_skill_id_skills_id_fk" FOREIGN KEY ("skill_id") REFERENCES "public"."skills"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "persona_notes" ADD CONSTRAINT "persona_notes_user_id_auth_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."auth_user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "persona_notes" ADD CONSTRAINT "persona_notes_skill_id_skills_id_fk" FOREIGN KEY ("skill_id") REFERENCES "public"."skills"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "persona_profiles" ADD CONSTRAINT "persona_profiles_user_id_auth_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."auth_user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "persona_profiles" ADD CONSTRAINT "persona_profiles_focus_skill_id_skills_id_fk" FOREIGN KEY ("focus_skill_id") REFERENCES "public"."skills"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "persona_messages_user_id_created_at_index" ON "persona_messages" USING btree ("user_id","created_at");--> statement-breakpoint
CREATE INDEX "persona_notes_user_id_created_at_index" ON "persona_notes" USING btree ("user_id","created_at");