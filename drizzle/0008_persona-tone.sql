ALTER TABLE "persona_profiles" ADD COLUMN "tone" jsonb DEFAULT '{}'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "persona_profiles" ADD COLUMN "notice_keys" jsonb DEFAULT '[]'::jsonb NOT NULL;