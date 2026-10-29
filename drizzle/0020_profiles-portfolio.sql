CREATE TABLE "portfolio_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" text NOT NULL,
	"title" text NOT NULL,
	"description" text DEFAULT '' NOT NULL,
	"link" text,
	"image_url" text,
	"skill_id" uuid,
	"position" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "persona_profiles" ADD COLUMN "public_name" text;--> statement-breakpoint
ALTER TABLE "persona_profiles" ADD COLUMN "headline" text;--> statement-breakpoint
ALTER TABLE "persona_profiles" ADD COLUMN "bio" text;--> statement-breakpoint
ALTER TABLE "persona_profiles" ADD COLUMN "location" text;--> statement-breakpoint
ALTER TABLE "persona_profiles" ADD COLUMN "website" text;--> statement-breakpoint
ALTER TABLE "portfolio_items" ADD CONSTRAINT "portfolio_items_user_id_auth_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."auth_user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "portfolio_items" ADD CONSTRAINT "portfolio_items_skill_id_skills_id_fk" FOREIGN KEY ("skill_id") REFERENCES "public"."skills"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "portfolio_items_user_id_position_index" ON "portfolio_items" USING btree ("user_id","position");