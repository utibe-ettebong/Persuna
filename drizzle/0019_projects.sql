CREATE TYPE "public"."milestone_status" AS ENUM('pending', 'funded', 'submitted', 'changes_requested', 'approved', 'released', 'refunded');--> statement-breakpoint
CREATE TYPE "public"."project_status" AS ENUM('draft', 'open', 'in_progress', 'completed', 'cancelled', 'disputed');--> statement-breakpoint
CREATE TYPE "public"."proposal_status" AS ENUM('pending', 'accepted', 'declined', 'withdrawn');--> statement-breakpoint
CREATE TYPE "public"."project_update_author" AS ENUM('persona', 'poster', 'seller');--> statement-breakpoint
CREATE TABLE "project_milestones" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"project_id" uuid NOT NULL,
	"position" integer NOT NULL,
	"title" text NOT NULL,
	"criteria" text[] DEFAULT '{}'::text[] NOT NULL,
	"amount_cents" integer NOT NULL,
	"status" "milestone_status" DEFAULT 'pending' NOT NULL,
	"delivery" text,
	"check" jsonb,
	"rounds" integer DEFAULT 0 NOT NULL,
	"provider" "payment_provider",
	"payment_reference" text,
	"platform_fee_cents" integer,
	"seller_share_cents" integer,
	"funded_at" timestamp with time zone,
	"submitted_at" timestamp with time zone,
	"settled_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "project_milestones_payment_reference_unique" UNIQUE("payment_reference"),
	CONSTRAINT "project_milestones_project_id_position_unique" UNIQUE("project_id","position"),
	CONSTRAINT "milestone_amount_positive" CHECK ("project_milestones"."amount_cents" > 0)
);
--> statement-breakpoint
CREATE TABLE "project_proposals" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"project_id" uuid NOT NULL,
	"seller_id" text NOT NULL,
	"listing_id" uuid,
	"message" text NOT NULL,
	"price_cents" integer NOT NULL,
	"days" integer NOT NULL,
	"fit" jsonb,
	"status" "proposal_status" DEFAULT 'pending' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "project_proposals_project_id_seller_id_unique" UNIQUE("project_id","seller_id"),
	CONSTRAINT "proposal_price_positive" CHECK ("project_proposals"."price_cents" > 0)
);
--> statement-breakpoint
CREATE TABLE "project_updates" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"project_id" uuid NOT NULL,
	"author" "project_update_author" NOT NULL,
	"kind" text NOT NULL,
	"body" text NOT NULL,
	"milestone_id" uuid,
	"proposal_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "projects" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"poster_id" text NOT NULL,
	"title" text NOT NULL,
	"brief" text NOT NULL,
	"budget_cents" integer NOT NULL,
	"deadline" timestamp with time zone NOT NULL,
	"status" "project_status" DEFAULT 'draft' NOT NULL,
	"chosen_proposal_id" uuid,
	"plan" jsonb,
	"poster_rating" integer,
	"poster_review" text,
	"seller_rating" integer,
	"seller_review" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"completed_at" timestamp with time zone,
	"expires_at" timestamp with time zone,
	"purged_at" timestamp with time zone,
	CONSTRAINT "budget_cents_positive" CHECK ("projects"."budget_cents" > 0),
	CONSTRAINT "project_ratings_range" CHECK (("projects"."poster_rating" is null or "projects"."poster_rating" between 1 and 5) and ("projects"."seller_rating" is null or "projects"."seller_rating" between 1 and 5))
);
--> statement-breakpoint
ALTER TABLE "project_milestones" ADD CONSTRAINT "project_milestones_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_proposals" ADD CONSTRAINT "project_proposals_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_proposals" ADD CONSTRAINT "project_proposals_seller_id_auth_user_id_fk" FOREIGN KEY ("seller_id") REFERENCES "public"."auth_user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_proposals" ADD CONSTRAINT "project_proposals_listing_id_listings_id_fk" FOREIGN KEY ("listing_id") REFERENCES "public"."listings"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_updates" ADD CONSTRAINT "project_updates_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_updates" ADD CONSTRAINT "project_updates_milestone_id_project_milestones_id_fk" FOREIGN KEY ("milestone_id") REFERENCES "public"."project_milestones"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_updates" ADD CONSTRAINT "project_updates_proposal_id_project_proposals_id_fk" FOREIGN KEY ("proposal_id") REFERENCES "public"."project_proposals"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "projects" ADD CONSTRAINT "projects_poster_id_auth_user_id_fk" FOREIGN KEY ("poster_id") REFERENCES "public"."auth_user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "projects" ADD CONSTRAINT "projects_chosen_proposal_id_project_proposals_id_fk" FOREIGN KEY ("chosen_proposal_id") REFERENCES "public"."project_proposals"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "project_updates_project_id_created_at_index" ON "project_updates" USING btree ("project_id","created_at");--> statement-breakpoint
CREATE INDEX "projects_status_created_at_index" ON "projects" USING btree ("status","created_at");--> statement-breakpoint
CREATE INDEX "projects_poster_id_index" ON "projects" USING btree ("poster_id");--> statement-breakpoint
CREATE INDEX "projects_expires_at_index" ON "projects" USING btree ("expires_at");