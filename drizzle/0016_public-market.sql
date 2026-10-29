CREATE TYPE "public"."listing_visibility" AS ENUM('public', 'unlisted');--> statement-breakpoint
ALTER TABLE "listings" ADD COLUMN "visibility" "listing_visibility" DEFAULT 'public' NOT NULL;--> statement-breakpoint
ALTER TABLE "listings" ADD COLUMN "paused_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "listings" ADD COLUMN "paused_reason" text;--> statement-breakpoint
ALTER TABLE "transactions" ADD COLUMN "rating" integer;--> statement-breakpoint
ALTER TABLE "transactions" ADD COLUMN "rating_comment" text;--> statement-breakpoint
ALTER TABLE "transactions" ADD CONSTRAINT "txn_rating_range" CHECK ("transactions"."rating" is null or "transactions"."rating" between 1 and 5);